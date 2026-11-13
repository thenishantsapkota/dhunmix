// Two-deck mixer on the Web Audio API.
// Chain per deck: source → gate → trim → low/mid/high EQ → low-pass → high-pass → volume → crossfader → master → limiter.
import { envelope, type Analysis } from '../analysis/features'

const SMOOTH = 0.015 // seconds; time constant for knob changes so they never click
const GATE_FADE = 0.008 // seconds; micro-fade on play/pause/seek to avoid clicks

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Equal-power crossfader: x=0 → only A, x=1 → only B, centre ≈ -3 dB each. */
export function crossfadeGains(x: number): [number, number] {
  const t = (clamp(x, 0, 1) * Math.PI) / 2
  return [Math.cos(t), Math.sin(t)]
}

/** One-knob filter. v<0 sweeps a low-pass down to 100 Hz, v>0 a high-pass up to 8 kHz, 0 is open. */
export function filterFreqs(v: number): { lp: number; hp: number } {
  v = clamp(v, -1, 1)
  if (Math.abs(v) < 0.02) return { lp: 22000, hp: 10 }
  if (v < 0) return { lp: 20000 * Math.pow(100 / 20000, -v), hp: 10 }
  return { lp: 22000, hp: 20 * Math.pow(8000 / 20, v) }
}

/** Inverse of filterFreqs: the knob position that produces these cutoffs (for showing automation on the knob). */
export function filterValue(lp: number, hp: number): number {
  if (hp > 10.5) return clamp(Math.log(hp / 20) / Math.log(8000 / 20), 0, 1)
  if (lp < 19900) return -clamp(Math.log(lp / 20000) / Math.log(100 / 20000), 0, 1)
  return 0
}

export type Band = 'low' | 'mid' | 'high'

export class Deck {
  buffer: AudioBuffer | null = null
  name = ''
  analysis: Analysis | null = null
  trackId: string | null = null
  envelope: number[] = []
  rate = 1
  // The DJ's knob settings. Automix automates around them and puts them back afterwards.
  eqDb: Record<Band, number> = { high: 0, mid: 0, low: 0 }
  filterValue = 0
  volumeValue = 1
  onEnded: (() => void) | null = null

  private src: AudioBufferSourceNode | null = null
  private rolls: AudioBufferSourceNode[] = [] // beat-roll slices currently scheduled
  private holding = false // the DJ is holding the roll button
  private startCtxTime = 0
  private startOffset = 0
  private readonly gate: GainNode
  private readonly trim: GainNode
  private readonly eq: Record<Band, BiquadFilterNode>
  private readonly lp: BiquadFilterNode
  private readonly hp: BiquadFilterNode
  private readonly volume: GainNode
  private readonly echoSend: GainNode
  private readonly echoDelay: DelayNode
  readonly fader: GainNode

  private readonly ctx: AudioContext

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx
    const bq = (type: BiquadFilterType, freq: number) => new BiquadFilterNode(ctx, { type, frequency: freq })
    this.gate = new GainNode(ctx, { gain: 0 })
    this.trim = new GainNode(ctx)
    this.eq = { low: bq('lowshelf', 250), mid: bq('peaking', 1000), high: bq('highshelf', 4000) }
    this.lp = bq('lowpass', 22000)
    this.hp = bq('highpass', 10)
    this.volume = new GainNode(ctx)
    this.fader = new GainNode(ctx)
    this.gate.connect(this.trim).connect(this.eq.low).connect(this.eq.mid).connect(this.eq.high)
      .connect(this.lp).connect(this.hp).connect(this.volume).connect(this.fader).connect(out)

    // Echo: sent before the fader and returned straight to the master, so its tail rings on after
    // the deck is faded out (the classic "echo out"). Each repeat loses bass, so it thins as it fades.
    this.echoSend = new GainNode(ctx, { gain: 0 })
    this.echoDelay = new DelayNode(ctx, { maxDelayTime: 2, delayTime: 0.375 })
    const feedback = new GainNode(ctx, { gain: 0.45 })
    this.volume.connect(this.echoSend).connect(this.echoDelay).connect(out)
    this.echoDelay.connect(bq('highpass', 300)).connect(feedback).connect(this.echoDelay)
  }

  get playing() { return this.src !== null }
  get duration() { return this.buffer?.duration ?? 0 }

  /** Current playhead in seconds of the track (holds still until a scheduled start). */
  get position() {
    if (!this.src) return this.startOffset
    return Math.min(this.duration, this.startOffset + Math.max(0, this.ctx.currentTime - this.startCtxTime) * this.rate)
  }

  /** Load a file. With analysis, the track is also loudness-matched to the rest of the library. */
  async load(file: File, analysis: Analysis | null = null, name = file.name.replace(/\.[^.]+$/, ''), trackId: string | null = null) {
    this.pause()
    this.buffer = await this.ctx.decodeAudioData(await file.arrayBuffer())
    this.name = name
    this.trackId = trackId
    this.analysis = analysis
    this.envelope = analysis?.envelope ?? envelope(this.buffer.getChannelData(0))
    this.trim.gain.setValueAtTime(10 ** ((analysis?.gainDb ?? 0) / 20), this.ctx.currentTime)
    this.startOffset = 0
  }

  /** What the controls are doing right now, automation included: lets the knobs move while automix works. */
  get live(): { eq: Record<Band, number>; filter: number } {
    return {
      eq: { high: this.eq.high.gain.value, mid: this.eq.mid.gain.value, low: this.eq.low.gain.value },
      filter: filterValue(this.lp.frequency.value, this.hp.frequency.value),
    }
  }

  /** Effective tempo after the tempo fader. */
  get bpm() { return this.analysis ? this.analysis.bpm * this.rate : 0 }

  play() {
    this.playAt(this.ctx.currentTime)
  }

  /** Start at an exact audio-clock time, optionally from a given track position: this is how beats line up. */
  playAt(when: number, offset?: number) {
    if (!this.buffer || this.src) return
    if (offset !== undefined) this.startOffset = clamp(offset, 0, this.duration)
    if (this.startOffset >= this.duration) this.startOffset = 0
    const now = Math.max(when, this.ctx.currentTime)
    const src = new AudioBufferSourceNode(this.ctx, { buffer: this.buffer, playbackRate: this.rate })
    src.connect(this.gate)
    src.onended = () => {
      if (this.src !== src) return // stopped by pause/seek, not by reaching the end
      this.src = null
      this.startOffset = this.duration
      this.gate.gain.cancelScheduledValues(this.ctx.currentTime)
      this.gate.gain.value = 0
      this.onEnded?.()
    }
    this.gate.gain.cancelScheduledValues(now)
    this.gate.gain.setValueAtTime(0, now)
    this.gate.gain.linearRampToValueAtTime(1, now + GATE_FADE)
    src.start(now, this.startOffset)
    this.src = src
    this.startCtxTime = now
  }

  pause() {
    if (!this.src) return
    const now = this.ctx.currentTime
    this.rolls.forEach((r) => r.stop(now))
    this.rolls = []
    this.startOffset = this.position
    this.gate.gain.cancelScheduledValues(now)
    this.gate.gain.setValueAtTime(this.gate.gain.value, now)
    this.gate.gain.linearRampToValueAtTime(0, now + GATE_FADE)
    this.src.stop(now + GATE_FADE + 0.002)
    this.src = null
  }

  seek(seconds: number) {
    const wasPlaying = this.playing
    this.pause()
    this.startOffset = clamp(seconds, 0, this.duration)
    if (wasPlaying) this.play()
  }

  /** Playback speed, e.g. 1.04 = +4 %.
   * shortcut: speed also shifts pitch (no key lock); add a time-stretch worklet in the automix step. */
  setRate(rate: number) {
    if (this.src) {
      this.startOffset = this.position
      this.startCtxTime = this.ctx.currentTime
      this.src.playbackRate.setValueAtTime(rate, this.ctx.currentTime)
    }
    this.rate = rate
  }

  /** EQ gain in dB: -26 (kill) … +6. */
  setEq(band: Band, db: number) {
    this.eqDb = { ...this.eqDb, [band]: clamp(db, -26, 6) }
    this.eq[band].gain.setTargetAtTime(this.eqDb[band], this.ctx.currentTime, SMOOTH)
  }

  setFilter(v: number) {
    this.filterValue = clamp(v, -1, 1)
    const { lp, hp } = filterFreqs(v)
    this.lp.frequency.setTargetAtTime(Math.min(lp, this.ctx.sampleRate / 2), this.ctx.currentTime, SMOOTH)
    this.hp.frequency.setTargetAtTime(hp, this.ctx.currentTime, SMOOTH)
  }

  /** Channel volume 0…1. */
  setVolume(v: number) {
    this.volumeValue = clamp(v, 0, 1)
    this.volume.gain.setTargetAtTime(this.volumeValue, this.ctx.currentTime, SMOOTH)
  }

  /** Hold `from` until `at`, then move to `to` by `at + dur`. Exponential suits frequencies (sweeps sound even). */
  private ramp(param: AudioParam, from: number, to: number, at: number, dur: number, exponential = false) {
    const now = this.ctx.currentTime
    param.cancelScheduledValues(now)
    param.setValueAtTime(from, now)
    param.setValueAtTime(from, Math.max(now, at))
    if (exponential) param.exponentialRampToValueAtTime(to, Math.max(now, at) + dur)
    else param.linearRampToValueAtTime(to, Math.max(now, at) + dur)
  }

  /** Automix EQ move, as dB offsets from the DJ's own knob setting (so their EQ choices are kept). */
  automateEq(band: Band, fromOffset: number, toOffset: number, at: number, dur: number) {
    const db = (o: number) => clamp(this.eqDb[band] + o, -26, 6)
    this.ramp(this.eq[band].gain, db(fromOffset), db(toOffset), at, dur)
  }

  /** Automix filter sweep between two knob positions (-1 low-pass … 0 open … +1 high-pass). */
  automateFilter(from: number, to: number, at: number, dur: number) {
    const nyquist = this.ctx.sampleRate / 2
    const a = filterFreqs(from)
    const b = filterFreqs(to)
    this.ramp(this.lp.frequency, Math.min(a.lp, nyquist), Math.min(b.lp, nyquist), at, dur, true)
    this.ramp(this.hp.frequency, a.hp, b.hp, at, dur, true)
  }

  /** Automix echo: open the send to `amount` with repeats every `time` seconds. */
  automateEcho(from: number, to: number, at: number, dur: number, time: number) {
    this.echoDelay.delayTime.setValueAtTime(clamp(time, 0.05, 2), this.ctx.currentTime)
    this.ramp(this.echoSend.gain, from, to, at, dur)
  }

  /**
   * Automix live move: draw a shape on one control. Points are [audio-clock time, value], value as in
   * automateEq/automateFilter/automateEcho; consecutive points ramp, so near-equal times make a snap.
   */
  shape(control: 'low' | 'filter' | 'echo', points: [number, number][], echoTime = 0.375) {
    if (points.length < 2) return
    const now = this.ctx.currentTime
    const draw = (param: AudioParam, map: (v: number) => number, exponential: boolean) => {
      param.cancelScheduledValues(now)
      param.setValueAtTime(map(points[0][1]), now)
      param.setValueAtTime(map(points[0][1]), Math.max(now, points[0][0]))
      for (const [t, v] of points.slice(1)) {
        if (exponential) param.exponentialRampToValueAtTime(map(v), Math.max(now, t))
        else param.linearRampToValueAtTime(map(v), Math.max(now, t))
      }
    }
    if (control === 'low') draw(this.eq.low.gain, (v) => clamp(this.eqDb.low + v, -26, 6), false)
    else if (control === 'echo') {
      this.echoDelay.delayTime.setValueAtTime(clamp(echoTime, 0.05, 2), now)
      draw(this.echoSend.gain, (v) => v, false)
    } else {
      const nyquist = this.ctx.sampleRate / 2
      draw(this.lp.frequency, (v) => Math.min(filterFreqs(v).lp, nyquist), true)
      draw(this.hp.frequency, (v) => filterFreqs(v).hp, true)
    }
  }

  /** Track time at a given audio-clock time (assuming the current rate). */
  private positionAt(ctxTime: number) {
    if (!this.src) return this.startOffset
    return Math.min(this.duration, this.startOffset + Math.max(0, ctxTime - this.startCtxTime) * this.rate)
  }

  /**
   * Beat roll ("repeater"): from steps[0], keep re-playing one slice of the beat, `slice` beats long, retriggering
   * at each step (½ → ¼ → ⅛ … speeds it up). The song keeps running muted underneath, so when the roll ends at the
   * last step it comes back exactly in time ("slip"). Steps are [audio-clock time, slice in beats]; slice 0 ends.
   */
  roll(steps: [number, number][]) {
    if (!this.buffer || !this.src || steps.length < 2) return
    const now = this.ctx.currentTime
    const first = Math.max(now, steps[0][0])
    const end = Math.max(first + 0.02, steps[steps.length - 1][0])
    const beat = this.analysis ? 60 / this.analysis.bpm : 0.5 // seconds of track per beat
    // Loop from the beat the roll starts on, so every repeat starts on a hit.
    let from = this.positionAt(first)
    const beats = this.analysis?.beats
    if (beats?.length) from = beats.reduce((best, b) => (b <= from + 0.01 && b > best ? b : best), beats[0])
    for (let i = 0; i < steps.length - 1; i++) {
      const [t, slice] = steps[i]
      if (slice <= 0) continue
      const r = new AudioBufferSourceNode(this.ctx, {
        buffer: this.buffer, playbackRate: this.rate, loop: true, loopStart: from, loopEnd: Math.min(this.duration, from + slice * beat),
      })
      r.connect(this.trim) // after the gate, so the muted song underneath doesn't silence the roll
      r.start(Math.max(now, t), from)
      r.stop(Math.max(now, steps[i + 1][0]))
      this.rolls.push(r)
      r.onended = () => (this.rolls = this.rolls.filter((x) => x !== r))
    }
    const g = this.gate.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(1, now)
    g.setValueAtTime(1, first)
    g.linearRampToValueAtTime(0, first + 0.004)
    g.setValueAtTime(0, end - 0.004)
    g.linearRampToValueAtTime(1, end)
  }

  /** DJ's hold-to-roll button: repeat `slice` beats until released. */
  startRoll(slice: number) {
    if (!this.src || this.holding) return
    this.holding = true
    const now = this.ctx.currentTime
    this.roll([[now, slice], [now + 600, 0]])
  }

  stopRoll() {
    if (!this.holding) return // e.g. the pointer just left the button
    this.holding = false
    const now = this.ctx.currentTime
    this.rolls.forEach((r) => r.stop(now + 0.004))
    this.rolls = []
    if (!this.src) return
    this.gate.gain.cancelScheduledValues(now)
    this.gate.gain.setValueAtTime(0, now)
    this.gate.gain.linearRampToValueAtTime(1, now + 0.004)
  }

  /** Drop any automix automation and return to the DJ's knob settings. Echo tails already sent keep ringing out. */
  restore() {
    const now = this.ctx.currentTime
    for (const p of [this.eq.low.gain, this.eq.mid.gain, this.eq.high.gain, this.lp.frequency, this.hp.frequency, this.echoSend.gain]) {
      p.cancelScheduledValues(now)
    }
    ;(['low', 'mid', 'high'] as Band[]).forEach((b) => this.setEq(b, this.eqDb[b]))
    this.setFilter(this.filterValue)
    this.echoSend.gain.setTargetAtTime(0, now, SMOOTH)
  }
}

type Fade = { from: number; to: number; at: number; dur: number }

export class Mixer {
  readonly ctx = new AudioContext({ latencyHint: 'playback' }) // bigger buffer = fewer dropouts on Android
  readonly decks: [Deck, Deck]
  private readonly master: GainNode
  private readonly ducker: GainNode
  private readonly ducks = new Map<string, number>() // reason → attenuation in dB
  private xfade = 0.5
  private fade: Fade | null = null

  constructor() {
    // Brick-wall-ish limiter so two loud tracks overlapping never clip the speakers.
    const limiter = new DynamicsCompressorNode(this.ctx, { threshold: -1, knee: 0, ratio: 20, attack: 0.003, release: 0.1 })
    this.master = new GainNode(this.ctx, { gain: 0.9 })
    this.ducker = new GainNode(this.ctx)
    this.master.connect(this.ducker).connect(limiter).connect(this.ctx.destination)
    this.decks = [new Deck(this.ctx, this.master), new Deck(this.ctx, this.master)]
    this.setCrossfader(0.5)
  }

  /** The master bus, before ducking and the limiter: where extra layers (the beat layer) join the mix. */
  get bus(): AudioNode { return this.master }

  /** Browsers start audio suspended until a user gesture. */
  resume() { return this.ctx.state === 'running' ? Promise.resolve() : this.ctx.resume() }

  /** Crossfader position now, including a running automix fade. */
  get crossfader() {
    const f = this.fade
    if (!f) return this.xfade
    const t = clamp((this.ctx.currentTime - f.at) / f.dur, 0, 1)
    return f.from + (f.to - f.from) * t
  }

  setCrossfader(x: number) {
    const now = this.ctx.currentTime
    this.fade = null
    this.xfade = clamp(x, 0, 1)
    const [a, b] = crossfadeGains(this.xfade)
    for (const [d, g] of [[this.decks[0], a], [this.decks[1], b]] as const) {
      d.fader.gain.cancelScheduledValues(now)
      d.fader.gain.setTargetAtTime(g, now, SMOOTH)
    }
  }

  /** Automix: equal-power crossfade from `from` to `to`, scheduled on the audio clock. */
  scheduleCrossfade(from: number, to: number, at: number, dur: number) {
    const steps = 64
    const curves = [new Float32Array(steps), new Float32Array(steps)]
    for (let i = 0; i < steps; i++) {
      const [a, b] = crossfadeGains(from + ((to - from) * i) / (steps - 1))
      curves[0][i] = a
      curves[1][i] = b
    }
    const start = Math.max(at, this.ctx.currentTime)
    this.decks.forEach((d, i) => {
      d.fader.gain.cancelScheduledValues(this.ctx.currentTime)
      d.fader.gain.setValueAtTime(crossfadeGains(from)[i], this.ctx.currentTime)
      d.fader.gain.setValueCurveAtTime(curves[i], start, Math.max(0.01, dur))
    })
    this.fade = { from, to, at: start, dur: Math.max(0.01, dur) }
    this.xfade = to
  }

  /**
   * Lower the whole mix for a reason ("speech", "mic", "talk") or lift that reason with `db = null`.
   * Several reasons can be active; the deepest one wins.
   */
  duck(reason: string, db: number | null, seconds: number) {
    if (db === null) this.ducks.delete(reason)
    else this.ducks.set(reason, db)
    const depth = Math.max(0, ...this.ducks.values())
    // Time constant ≈ a third of the fade, so it's ~95 % there after `seconds`.
    this.ducker.gain.setTargetAtTime(10 ** (-depth / 20), this.ctx.currentTime, Math.max(0.01, seconds / 3))
  }

  get ducking() { return this.ducks.size > 0 }

  setMaster(v: number) {
    this.master.gain.setTargetAtTime(clamp(v, 0, 1), this.ctx.currentTime, SMOOTH)
  }
}
