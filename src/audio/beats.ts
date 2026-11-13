// Beat layer: drums synthesized live and locked to the playing song's own beat grid.
import { PATTERNS, hitsBetween, styleFor, type BeatStyle, type Voice } from './beatGrid'
import type { Deck } from './mixer'

/** Which deck the drums follow right now, and whether they should sit out (cuts, rolls, a song's first phrase). */
export type BeatGuide = { deck: Deck; mute: boolean; energy: number } | null

const LOOKAHEAD_S = 0.15 // schedule this far ahead on the audio clock…
const INTERVAL_MS = 25 // …checking this often, so timers running late never make a hit late

export class BeatLayer {
  guide: () => BeatGuide = () => null
  style: () => BeatStyle = () => 'off'

  private readonly ctx: AudioContext
  private readonly out: GainNode
  private readonly noise: AudioBuffer
  private timer: ReturnType<typeof setInterval> | null = null
  private deck: Deck | null = null
  private until = 0 // track time already scheduled on the followed deck

  constructor(ctx: AudioContext, destination: AudioNode, level = 0.5) {
    this.ctx = ctx
    this.out = new GainNode(ctx, { gain: level }) // sits under the music, not on top of it
    this.out.connect(destination)
    this.noise = new AudioBuffer({ length: ctx.sampleRate, sampleRate: ctx.sampleRate, numberOfChannels: 1 })
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }

  start() {
    this.timer ??= setInterval(() => this.schedule(), INTERVAL_MS)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private schedule() {
    const g = this.guide()
    const style = g ? styleFor(this.style(), g.energy) : 'off'
    if (style === 'off' || !g || g.mute || !g.deck.playing || !g.deck.analysis) {
      this.deck = null // when the drums come back, they start from "now", never replaying the past
      return
    }
    const d = g.deck
    const a = g.deck.analysis
    const now = this.ctx.currentTime
    const pos = d.position
    if (this.deck !== d || pos < this.until - 0.5) this.until = pos // new deck, first run, or a seek backwards
    this.deck = d
    const horizon = pos + LOOKAHEAD_S * d.rate
    const barStart = a.beats.reduce((best, t, i) => (Math.abs(t - a.introEnd) < Math.abs(a.beats[best] - a.introEnd) ? i : best), 0)
    for (const h of hitsBetween(a.beats, barStart, PATTERNS[style], this.until, horizon)) {
      this.hit(h.voice, now + Math.max(0, h.t - pos) / d.rate, h.velocity)
    }
    this.until = horizon
  }

  /**
   * The mark on a hard switch: a noise swish rising through the last beat, then a crash on the "1".
   * Plays whatever the beat style, since it belongs to the transition, not the groove.
   */
  accent(at: number, beat: number) {
    const now = this.ctx.currentTime
    const start = Math.max(now, at - beat)
    const n = new AudioBufferSourceNode(this.ctx, { buffer: this.noise })
    const sweep = new BiquadFilterNode(this.ctx, { type: 'bandpass', frequency: 800, Q: 1.5 })
    sweep.frequency.setValueAtTime(800, start)
    sweep.frequency.exponentialRampToValueAtTime(7000, at)
    const swell = new GainNode(this.ctx, { gain: 0.0001 })
    swell.gain.setValueAtTime(0.0001, start)
    swell.gain.exponentialRampToValueAtTime(0.35, at - 0.01)
    swell.gain.linearRampToValueAtTime(0, at)
    n.connect(sweep).connect(swell).connect(this.out)
    n.start(start, Math.random() * 0.5)
    n.stop(at + 0.02)
    this.burst(at, 'highpass', 4500, 0.45, 1.6) // crash
    this.tone('sine', at, 110, 50, 0.15, 0.6, 0.4) // a kick under the crash so the "1" lands with weight
  }

  // --- drum voices -----------------------------------------------------------
  private env(at: number, peak: number, decay: number) {
    const g = new GainNode(this.ctx, { gain: 0 })
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(peak, at + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    g.connect(this.out)
    return g
  }

  private tone(type: OscillatorType, at: number, from: number, to: number, sweep: number, peak: number, decay: number) {
    const o = new OscillatorNode(this.ctx, { type, frequency: from })
    o.frequency.setValueAtTime(from, at)
    o.frequency.exponentialRampToValueAtTime(to, at + sweep)
    o.connect(this.env(at, peak, decay))
    o.start(at)
    o.stop(at + decay + 0.02)
  }

  private burst(at: number, filter: BiquadFilterType, freq: number, peak: number, decay: number, q = 1) {
    const n = new AudioBufferSourceNode(this.ctx, { buffer: this.noise })
    n.connect(new BiquadFilterNode(this.ctx, { type: filter, frequency: freq, Q: q })).connect(this.env(at, peak, decay))
    n.start(at, Math.random() * 0.5) // a different slice of noise each hit, so repeats don't sound copy-pasted
    n.stop(at + decay + 0.02)
  }

  private hit(voice: Voice, at: number, v: number) {
    switch (voice) {
      case 'kick':
        return this.tone('sine', at, 150, 45, 0.12, v, 0.32)
      case 'clap':
        for (const offset of [0, 0.011, 0.022]) this.burst(at + offset, 'bandpass', 1500, v * 0.5, offset === 0.022 ? 0.16 : 0.012, 1.2)
        return
      case 'hat':
        return this.burst(at, 'highpass', 7500, v * 0.35, 0.05)
      case 'openHat':
        return this.burst(at, 'highpass', 7000, v * 0.3, 0.25)
      case 'dagga': // the dhol's bass side: a deep, slightly pitched thump
        this.tone('sine', at, 120, 72, 0.1, v, 0.42)
        return this.burst(at, 'lowpass', 400, v * 0.25, 0.05)
      case 'tilli': // the stick side: a tight, high crack
        this.tone('triangle', at, 520, 450, 0.05, v * 0.45, 0.12)
        return this.burst(at, 'bandpass', 3200, v * 0.25, 0.04, 2)
    }
  }
}
