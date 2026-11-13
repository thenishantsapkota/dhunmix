// Runs the set: keeps the next track loaded on the idle deck, schedules each transition on the
// audio clock, and steps aside the moment the DJ touches the decks or crossfader.
import { useSyncExternalStore } from 'react'
import type { Deck, Mixer } from '../audio/mixer'
import { grooveStart } from '../analysis/features'
import { getTracks, type Track } from '../library/store'
import type { BeatGuide } from '../audio/beats'
import { DEFAULT_WEIGHTS, pickOpener, rankNext, type Candidate, type Weights } from './picker'
import { MOVE_LABEL, planMoves, type LiveFx } from './performance'
import { momentPlan, planTransition, rollSteps, type Pace, type Plan } from './planner'

export type AutomixStatus = 'off' | 'playing' | 'mixing' | 'ending'

export type AutomixState = {
  on: boolean
  status: AutomixStatus
  live: 0 | 1
  next: Track | null
  alternatives: Track[]
  plan: Plan | null
  secondsToMix: number | null
  message: string
  move: { label: string; until: number } | null // live move in progress (until: audio-clock time it ends)
}

const TICK_MS = 200
const SCHEDULE_AHEAD = 1 // seconds: hand the transition to the audio clock this far ahead
const GLIDE_BEATS = 32 // after a beat-matched blend, ease the new track back to its own tempo

const side = (deck: 0 | 1) => deck // crossfader: 0 = deck A, 1 = deck B

export type Target = { energy: number; weights: Weights; maxPlay: number; liveFx: LiveFx } // maxPlay: seconds per song, Infinity = whole song

export class Automix {
  private state: AutomixState = { on: false, status: 'off', live: 0, next: null, alternatives: [], plan: null, secondsToMix: null, message: '', move: null }
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private played = new Set<string>()
  private pinned: string | null = null
  private preparing = false
  private mixNowFrom: number | null = null
  private transition: { endCtx: number } | null = null
  private glide: { from: number; startCtx: number; dur: number } | null = null
  private moment: { trackId: string; endsSet: boolean } | null = null
  private lastSong = false
  private firstSong = true // the beat layer waits for the opener's first phrase, then never stops
  private onSwitch: ((at: number, beat: number) => void) | null = null
  /** Called with the audio-clock time of each hard switch and the beat length, for the beat layer's accent. */
  setSwitchHandler(fn: (at: number, beat: number) => void) {
    this.onSwitch = fn
  }
  private readonly mixer: Mixer
  /** Where the picker aims. The event curve replaces the default "hold steady". */
  target: () => Target = () => ({ energy: 0.5, weights: DEFAULT_WEIGHTS, maxPlay: Infinity, liveFx: 'off' })
  private movesDone = new Set<number>() // live moves already scheduled for the song on air
  private liveFrom = 0 // track time where the live song came in: song length counts from here
  private nextFrom = 0

  constructor(mixer: Mixer) {
    this.mixer = mixer
  }

  // --- React binding -------------------------------------------------------
  subscribe = (l: () => void) => (this.listeners.add(l), () => this.listeners.delete(l))
  getSnapshot = () => this.state
  private set(patch: Partial<AutomixState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  get on() { return this.state.on }
  get liveDeck() { return this.state.live }
  private get idle(): 0 | 1 { return this.state.live === 0 ? 1 : 0 }
  private deck(i: 0 | 1): Deck { return this.mixer.decks[i] }
  private now() { return this.mixer.ctx.currentTime }
  private byId(id: string | null) { return id ? getTracks().find((t) => t.id === id) ?? null : null }

  // --- DJ actions ----------------------------------------------------------
  async start() {
    await this.mixer.resume()
    const [a, b] = this.mixer.decks
    let live: 0 | 1
    if (a.playing || b.playing) {
      // Both playing: the one the crossfader favours is "live".
      live = a.playing && b.playing ? (this.mixer.crossfader <= 0.5 ? 0 : 1) : a.playing ? 0 : 1
    } else if (a.analysis || b.analysis) {
      live = a.analysis ? 0 : 1
      const d = this.deck(live)
      // An unstarted opener is cued where its groove starts, not in a slow intro.
      d.playAt(this.now(), d.position < 1 ? grooveStart(d.analysis!) : d.position)
    } else {
      const opener = pickOpener(this.pool(null), this.target().energy)
      if (!opener) return this.set({ message: 'Add and analyse some music first.' })
      live = 0
      const t = this.byId(opener.id)!
      await a.load(t.file!, t.analysis!, t.name, t.id)
      a.playAt(this.now(), grooveStart(t.analysis!)) // like a DJ cueing the first track at the beat, skipping a slow intro
    }
    if (!this.deck(live).analysis) return this.set({ message: 'The playing track has not been analysed yet.' })
    this.mixer.setCrossfader(side(live))
    this.firstSong = true
    this.liveFrom = this.deck(live).position
    this.movesDone = new Set()
    this.set({ on: true, status: 'playing', live, message: '' })
    this.timer ??= setInterval(() => this.tick(), TICK_MS)
    this.prepareNext()
  }

  stop(message = '') {
    if (this.transition) {
      // Freeze the mix where it is: both decks keep playing, the DJ finishes it by hand.
      this.mixer.setCrossfader(this.mixer.crossfader)
      this.mixer.decks.forEach((d) => d.restore())
      this.transition = null
    }
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.glide = null
    this.mixNowFrom = null
    this.moment = null
    this.lastSong = false
    this.set({ on: false, status: 'off', secondsToMix: null, message })
  }

  /** The DJ grabbed a control: get out of the way. */
  takeOver() {
    if (this.state.on) this.stop("You're in control. Automix is off.")
  }

  /** Start the transition at the next beat instead of waiting for the planned phrase. */
  mixNow() {
    if (this.state.on && !this.transition && this.state.next) this.mixNowFrom = this.deck(this.state.live).position + 0.5
  }

  /**
   * A moment (first dance, cake, last song): the current song fades out and the moment song
   * starts cleanly from its beginning, right away. Works from a standing start too.
   */
  async playMoment(t: Track, endsSet = false) {
    if (!t.file || !t.analysis) return
    await this.mixer.resume()
    const [a, b] = this.mixer.decks
    if (!a.playing && !b.playing) {
      if (this.state.on) this.stop()
      await a.load(t.file, t.analysis, t.name, t.id)
      a.playAt(this.now(), 0)
      this.mixer.setCrossfader(0)
      this.liveFrom = 0
      this.movesDone = new Set()
      this.lastSong = endsSet
      this.set({ on: true, status: endsSet ? 'ending' : 'playing', live: 0, next: null, plan: null, alternatives: [], message: '' })
      this.timer ??= setInterval(() => this.tick(), TICK_MS)
      if (!endsSet) this.prepareNext()
      return
    }
    if (!this.state.on) {
      const live = a.playing && b.playing ? (this.mixer.crossfader <= 0.5 ? 0 : 1) : a.playing ? 0 : 1
      this.set({ on: true, status: 'playing', live, message: '' })
      this.timer ??= setInterval(() => this.tick(), TICK_MS)
    }
    this.moment = { trackId: t.id, endsSet }
    this.pinned = t.id
    if (!this.transition) {
      this.set({ next: null, plan: null })
      this.prepareNext()
    }
  }

  /** The event curve or preset changed: re-pick the next track unless the DJ chose it. */
  replan() {
    if (this.state.on && !this.transition && !this.pinned && !this.lastSong) {
      this.set({ next: null, plan: null })
      this.prepareNext()
    }
  }

  /** Pin what plays next (from the library or the alternatives). */
  setNext(t: Track) {
    this.pinned = t.id
    if (!this.transition) {
      this.set({ next: null, plan: null })
      this.prepareNext()
    }
  }

  // --- internals -----------------------------------------------------------
  /** Live moves on the song on air, handed to the audio clock ~2 s before they start. */
  private perform(live: Deck, now: number) {
    const { liveFx, energy } = this.target()
    if (liveFx === 'off' || !live.analysis) return
    const plan = this.state.plan
    const until = plan && plan.style !== 'moment' ? plan.aStart : live.duration
    const toClock = (t: number) => now + (t - live.position) / live.rate
    for (const m of planMoves(live.analysis, this.liveFrom, until, liveFx, energy)) {
      const key = Math.round(m.at * 1000)
      if (this.movesDone.has(key)) continue
      const lead = (m.at - live.position) / live.rate
      if (lead > 2) continue
      this.movesDone.add(key)
      if (lead < -0.1) continue // already passed (the DJ seeked)
      const points = m.points.map(([t, v]) => [toClock(t), v] as [number, number])
      if (m.control === 'roll') live.roll(points)
      else live.shape(m.control, points, (0.75 * 60) / (live.analysis.bpm * live.rate))
      this.set({ move: { label: MOVE_LABEL[m.kind], until: toClock(m.points[m.points.length - 1][0]) } })
    }
  }

  /**
   * Where the beat layer should follow. Through smooth transitions it follows whichever song the crossfader
   * favours (they're beat-matched, so the groove carries straight across); it sits out cuts, moments,
   * beat rolls, and each song's first phrase, coming in on a downbeat once the song has settled.
   */
  beatGuide(): BeatGuide {
    const s = this.state
    const live = this.deck(s.live)
    if (!s.on || !live.analysis) return null
    const now = this.now()
    const mixing = !!this.transition
    const deck = mixing ? this.deck(this.mixer.crossfader <= 0.5 ? 0 : 1) : live
    const beat = 60 / live.analysis.bpm
    const mute =
      (mixing && (s.plan?.style === 'cut' || s.plan?.style === 'moment')) ||
      (s.move?.label === 'Beat roll' && now < s.move.until) ||
      (!mixing && this.firstSong && live.position < this.liveFrom + 16 * beat)
    return { deck, mute, energy: this.target().energy }
  }

  private pace(): Pace {
    return { playedFrom: this.liveFrom, maxPlay: this.target().maxPlay }
  }

  private pool(excludeId: string | null): Candidate[] {
    return getTracks()
      .filter((t) => t.file && t.analysis && !t.neverPlay && t.id !== excludeId)
      .map((t) => ({ id: t.id, analysis: t.analysis!, energy: t.energy ?? 0.5 }))
  }

  private async prepareNext() {
    if (this.preparing || !this.state.on) return
    if (this.lastSong) return this.set({ next: null, alternatives: [], plan: null, status: 'ending', message: 'Last song. The set ends after this one.' })
    const live = this.deck(this.state.live)
    if (!live.analysis) return
    this.preparing = true
    try {
      const { energy, weights } = this.target()
      const exclude = new Set(this.played)
      if (live.trackId) exclude.add(live.trackId)
      // Rank against the tempo actually playing (with a locked set tempo, that's the set's, not the song's own).
      const playing = { ...live.analysis, bpm: live.analysis.bpm * live.rate }
      const ranked = rankNext(playing, this.pool(live.trackId), exclude, energy, weights)
      // A moment may replay a song (e.g. the couple's song again at the end); a normal pin may not.
      const pinned = this.pinned && (this.moment?.trackId === this.pinned || !exclude.has(this.pinned)) ? this.byId(this.pinned) : null
      const next = pinned?.file && pinned.analysis ? pinned : this.byId(ranked[0]?.id ?? null)
      const alternatives = ranked.filter((c) => c.id !== next?.id).slice(0, 3).map((c) => this.byId(c.id)!).filter(Boolean)
      if (!next) {
        this.set({ next: null, alternatives: [], plan: null, status: 'ending', message: 'No unplayed tracks left. This song will play out.' })
        return
      }
      const idle = this.deck(this.idle)
      if (idle.trackId !== next.id) await idle.load(next.file!, next.analysis!, next.name, next.id)
      if (!idle.playing) idle.setRate(1) // its tempo is set when the transition starts; until then show the real BPM
      const plan = this.moment?.trackId === next.id ? momentPlan(live.position) : planTransition(live.analysis, live.rate, next.analysis!, undefined, this.pace())
      this.set({ next, alternatives, plan, message: '' })
    } catch {
      this.set({ message: "Couldn't load the next track. Trying another." })
      if (this.pinned) this.pinned = null
    } finally {
      this.preparing = false
    }
  }

  private tick() {
    if (!this.state.on) return
    const now = this.now()
    const liveIdx = this.state.live
    const live = this.deck(liveIdx)

    if (this.transition) {
      if (now >= this.transition.endCtx) this.finish()
      else this.set({ secondsToMix: 0 })
      return
    }

    if (this.glide) {
      const t = Math.min(1, (now - this.glide.startCtx) / this.glide.dur)
      live.setRate(this.glide.from + (1 - this.glide.from) * t)
      if (t >= 1) this.glide = null
    }

    if (!live.playing) {
      const ended = live.position >= live.duration - 0.05
      if (ended && this.state.next) {
        // Missed the window (e.g. tab was asleep): bring the next track in straight away.
        const plan = planTransition(live.analysis!, live.rate, this.state.next.analysis!, 0)
        return this.schedule({ ...plan, bDelay: 0, rateB: 1 }, now + 0.05, true)
      }
      return this.stop(ended ? 'The set has ended.' : 'Paused by you. Automix is off.')
    }

    this.perform(live, now)

    const next = this.state.next
    if (!next || this.deck(this.idle).trackId !== next.id) {
      this.prepareNext()
      return this.set({ secondsToMix: null })
    }

    if (this.moment?.trackId === next.id) return this.schedule(momentPlan(live.position), now + 0.05)

    let plan = planTransition(live.analysis!, live.rate, next.analysis!, this.mixNowFrom ?? undefined, this.pace())
    const untilStart = (plan.aStart - live.position) / live.rate
    if (untilStart < -0.25) {
      // The DJ seeked past the planned point: mix from the next beat instead.
      plan = planTransition(live.analysis!, live.rate, next.analysis!, live.position + 0.5)
    }
    const wait = (plan.aStart - live.position) / live.rate
    if (wait <= SCHEDULE_AHEAD) this.schedule(plan, now + Math.max(0.05, wait))
    else this.set({ plan, secondsToMix: wait })
  }

  private schedule(plan: Plan, at: number, liveStopped = false) {
    const fromIdx = this.state.live
    const toIdx = this.idle
    const a = this.deck(fromIdx)
    const b = this.deck(toIdx)

    b.restore()
    b.setRate(plan.rateB)
    b.playAt(at + plan.bDelay, plan.bOffset)
    this.nextFrom = plan.bOffset

    const dur = liveStopped ? 0.05 : plan.duration || 6
    if (plan.style === 'moment') {
      this.lastSong = this.moment?.endsSet ?? false
      this.moment = null
    }
    if (liveStopped) {
      this.mixer.scheduleCrossfade(side(fromIdx), side(toIdx), at, dur)
    } else {
      this.mixer.scheduleCrossfade(side(fromIdx), side(toIdx), at + plan.xfade.at, plan.xfade.dur)
      for (const f of plan.fx) {
        const deck = f.deck === 'a' ? a : b
        if (f.param === 'filter') deck.automateFilter(f.from, f.to, at + f.at, f.dur)
        else if (f.param === 'echo') deck.automateEcho(f.from, f.to, at + f.at, f.dur, plan.echoTime)
        else if (f.param === 'roll') deck.roll(rollSteps(f.from, f.to, at + f.at, f.dur))
        else deck.automateEq(f.param, f.from, f.to, at + f.at, f.dur)
      }
    }

    if ((plan.style === 'swap' || plan.style === 'cut') && !liveStopped && a.analysis) {
      // The accent marks the downbeat where the new song takes over: a cut's B entry, or the end of a swap's lead-in.
      this.onSwitch?.(at + (plan.style === 'swap' ? plan.duration : plan.bDelay), 60 / (a.analysis.bpm * a.rate))
    }
    this.transition = { endCtx: at + Math.max(dur, plan.bDelay) + 0.1 }
    this.mixNowFrom = null
    this.set({ status: 'mixing', plan, secondsToMix: 0 })
  }

  private finish() {
    const old = this.deck(this.state.live)
    if (old.trackId) this.played.add(old.trackId)
    old.pause()
    old.restore()
    const live = this.idle
    const b = this.deck(live)
    this.movesDone = new Set()
    this.liveFrom = this.nextFrom
    if (this.pinned === b.trackId) this.pinned = null
    this.transition = null
    this.firstSong = false
    // Quick sets hold one tempo like a mashup; longer sets ease each song back to its own tempo.
    const lockTempo = this.target().maxPlay < 90
    if (!lockTempo && Math.abs(b.rate - 1) > 0.001 && b.analysis) this.glide = { from: b.rate, startCtx: this.now(), dur: GLIDE_BEATS * (60 / b.analysis.bpm) }
    this.set({ live, status: this.lastSong ? 'ending' : 'playing', next: null, plan: null, alternatives: [], secondsToMix: null })
    this.prepareNext()
  }
}

export function useAutomix(automix: Automix) {
  return useSyncExternalStore(automix.subscribe, automix.getSnapshot)
}
