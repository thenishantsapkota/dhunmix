// Decides how to get from track A to track B: where, how long, and in what style. Pure.
import { grooveStart, type Analysis } from '../analysis/features'
import { camelotCompat, tempoRatio } from './picker'

export type Style = 'swap' | 'blend' | 'filter' | 'fade' | 'cut' | 'moment' // moment: chosen by the DJ, never by the planner

/**
 * One automated move during a transition. Times are seconds from the transition start.
 * eq: dB offset from the DJ's own knob setting (-40 = kill). filter: knob value, -1 low-pass … 0 open … +1 high-pass.
 * echo: beat-synced echo send, 0-1; its tail keeps ringing after the deck is faded out.
 * roll: beat repeat, slice length in beats going from `from` to `to`, halving along the way (½ → ¼ → ⅛ …).
 */
export type Fx =
  | { deck: 'a' | 'b'; param: 'low' | 'mid' | 'high'; from: number; to: number; at: number; dur: number }
  | { deck: 'a' | 'b'; param: 'filter' | 'echo' | 'roll'; from: number; to: number; at: number; dur: number }

/** Roll steps for a slice that halves from `from` to `to` beats across [at, at + dur]: each halving gets half the time left. */
export function rollSteps(from: number, to: number, at: number, dur: number): [number, number][] {
  const steps: [number, number][] = []
  let t = at
  let left = dur
  for (let slice = from; slice >= to - 1e-9; slice /= 2) {
    steps.push([t, slice])
    const share = slice / 2 < to - 1e-9 ? left : left / 2
    t += share
    left -= share
  }
  steps.push([at + dur, 0])
  return steps
}

export type Plan = {
  style: Style
  aStart: number // A's track time (s) where the transition begins, on one of A's beats
  beats: number // transition length in beats
  duration: number // transition length in seconds of real time
  bOffset: number // B's track time (s) to start from, on one of B's beats
  bDelay: number // seconds after aStart before B starts (cut: B lands as A ends)
  rateB: number // B's playback rate during the transition (1 = untouched)
  reason: string
  xfade: { at: number; dur: number } // crossfader move, seconds from the transition start
  fx: Fx[] // filter / EQ / echo moves that make the transition sound mixed, not just faded
  echoTime: number // seconds between echo repeats (3/4 of a beat)
}

export const STYLE_LABEL: Record<Style, string> = { swap: 'Swap on the one', blend: 'Long blend', filter: 'Filter blend', fade: 'Quick fade', cut: 'Cut on the beat', moment: 'Fade out, clean start' }

export const MOMENT_FADE_S = 6

/** Plain-language list of the moves in a plan, for the co-pilot panel. */
export function describeFx(fx: Fx[]): string {
  const words = fx.map((f) =>
    f.param === 'low' ? 'Bass swap'
      : f.param === 'mid' ? 'Vocal dip'
      : f.param === 'high' ? (f.deck === 'a' ? 'Highs roll off' : 'Highs ease in')
      : f.param === 'echo' ? 'Echo out'
      : f.param === 'roll' ? 'Beat roll'
      : f.deck === 'b' ? 'Filter opens'
      : f.to > 0 ? 'High-pass lift' : 'Low-pass fade')
  return [...new Set(words)].join(' · ')
}

const KILL = -40 // EQ offset that always reaches the -26 dB kill, whatever the knob is at

/** A moment song starts from its very beginning after the current song sinks away through a low-pass, untouched in tempo. */
export function momentPlan(aPosition: number): Plan {
  const d = MOMENT_FADE_S
  return {
    style: 'moment', aStart: aPosition, beats: 0, duration: d, bOffset: 0, bDelay: d, rateB: 1, reason: 'Moment',
    xfade: { at: 0, dur: d }, echoTime: 0.375,
    fx: [{ deck: 'a', param: 'filter', from: 0, to: -0.85, at: 0, dur: d }],
  }
}

/**
 * The DJ moves for each style. `rising`: B brings more energy than A, so A lifts away (high-pass) and
 * B opens up; otherwise A settles down (low-pass). One move per deck and control, never two on the same knob.
 */
/** Beats after a cut's riser during which B opens up under A's echo tail (quick sets use half). */
export const CUT_LAND_BEATS = 8

/**
 * The moves for one transition. The bass crossover takes a quarter of the transition (max 2 bars): gradual,
 * but short enough that quick sets keep their flow. `land`: beats a cut's incoming song takes to open up.
 */
export function transitionFx(style: Style, beat: number, beats: number, rising: boolean, land = CUT_LAND_BEATS, keyClash = false): Pick<Plan, 'xfade' | 'fx'> {
  const L = beats * beat
  const half = L / 2
  const swapBeats = Math.min(8, Math.max(2, beats / 4))
  const swapAt = Math.max(0, half - (swapBeats / 2) * beat)
  const swap = Math.min(swapBeats * beat, L - swapAt)
  const bassSwap = [
    { deck: 'b', param: 'low', from: KILL, to: 0, at: swapAt, dur: swap },
    { deck: 'a', param: 'low', from: 0, to: KILL, at: swapAt, dur: swap },
  ] as const
  switch (style) {
    case 'blend':
      return {
        xfade: { at: 0, dur: L },
        fx: [
          ...bassSwap,
          { deck: 'a', param: 'mid', from: 0, to: -6, at: half, dur: half }, // make room for B's vocals
          { deck: 'a', param: 'high', from: 0, to: -12, at: L * 0.6, dur: L * 0.4 },
          rising
            ? { deck: 'b', param: 'filter', from: -0.45, to: 0, at: 0, dur: L * 0.6 } // B opens up as it arrives
            : { deck: 'b', param: 'high', from: -8, to: 0, at: 0, dur: L * 0.6 },
        ],
      }
    case 'filter':
      return {
        xfade: { at: 0, dur: L },
        fx: [
          ...bassSwap,
          { deck: 'a', param: 'filter', from: 0, to: 0.7, at: 0, dur: L }, // thins A out so clashing notes vanish
          { deck: 'b', param: 'filter', from: -0.6, to: 0, at: 0, dur: L * 0.8 },
        ],
      }
    case 'fade':
      return {
        xfade: { at: 0, dur: L },
        fx: [
          ...bassSwap, // never two full basslines at once, but no sudden hole either
          rising
            ? { deck: 'a', param: 'filter', from: 0, to: 0.4, at: 0, dur: L }
            : { deck: 'a', param: 'filter', from: 0, to: -0.45, at: 0, dur: L },
          { deck: 'a', param: 'high', from: 0, to: -8, at: half, dur: half }, // A recedes rather than stops
          { deck: 'b', param: 'high', from: -6, to: 0, at: 0, dur: half }, // B's highs ease in instead of arriving all at once
        ],
      }
    case 'swap': {
      // One-bar lead-in, bass swap on the "1": B arrives under A without its bass (so the ear hears it coming),
      // then on the downbeat B's bass drops in and A is gone. Quick like a mashup switch, not a jump cut.
      const one = L - 0.02
      return {
        xfade: { at: 0, dur: L },
        fx: [
          { deck: 'b', param: 'low', from: KILL, to: 0, at: one, dur: 0.02 }, // B's bass lands on the one
          { deck: 'a', param: 'low', from: 0, to: KILL, at: one, dur: 0.02 },
          ...(keyClash
            ? ([
                { deck: 'a', param: 'filter', from: 0, to: 0.3, at: 0, dur: L }, // thin A so clashing notes fade first
                { deck: 'b', param: 'filter', from: -0.4, to: 0, at: 0, dur: L },
              ] as const)
            : ([{ deck: 'b', param: 'high', from: -6, to: 0, at: 0, dur: L }] as const)),
        ],
      }
    }
    case 'cut': {
      // Echo out, filter in: A rises through the high-pass while its echo builds, then leaves on the beat;
      // B lands muffled and without bass, and opens up over a bar under A's echo tail.
      const opening = land * beat
      return {
        xfade: { at: L - beat, dur: beat },
        fx: [
          { deck: 'a', param: 'filter', from: 0, to: 0.6, at: 0, dur: L },
          { deck: 'a', param: 'roll', from: 0.5, to: 0.125, at: L / 2, dur: L / 2 }, // last bar stutters faster and faster
          { deck: 'a', param: 'echo', from: 0, to: 0.6, at: L / 2, dur: L / 2 },
          ...(land > 0
            ? [
                { deck: 'b', param: 'filter', from: -0.7, to: 0, at: L, dur: opening },
                { deck: 'b', param: 'low', from: KILL, to: 0, at: L, dur: opening },
              ] as const
            : []), // quick sets: B lands at full, straight on the beat
        ],
      }
    }
    case 'moment':
      return { xfade: { at: 0, dur: L }, fx: [] }
  }
}

const MAX_STRETCH = 0.06 // beyond ±6 % tempo change, pitch shift becomes obvious
const STEADY = 0.6

const nearestIndex = (beats: number[], t: number) => {
  let best = 0
  for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - t) < Math.abs(beats[best] - t)) best = i
  return best
}
const stabilityAt = (a: Analysis, beatIndex: number) => a.stability[Math.min(a.stability.length - 1, Math.floor(beatIndex / 128))] ?? 0

/** Mean loudness (0-1, from the overview envelope) between two track times. */
function energyBetween(a: Analysis, t0: number, t1: number): number {
  const n = a.envelope.length
  if (!n || t1 <= t0) return 0
  const i0 = Math.max(0, Math.floor((t0 / a.duration) * n))
  const i1 = Math.min(n, Math.max(i0 + 1, Math.ceil((t1 / a.duration) * n)))
  let sum = 0
  for (let i = i0; i < i1; i++) sum += a.envelope[i]
  return sum / (i1 - i0)
}

/** How long each song plays before automix moves on. A real DJ plays the hook, not the whole record. */
export type Pace = { playedFrom: number; maxPlay: number } // track seconds; maxPlay = Infinity plays to the outro

const MIN_PLAY = 20 // never leave a song before it has properly arrived

/**
 * Beat index where A should be fully mixed out, when the DJ's pace says leave early.
 * Picks the 4-bar phrase boundary near the target where the energy drops most:
 * that's usually the end of a chorus, so the song leaves after its hook, not mid-line.
 */
function paceEndIndex(a: Analysis, beatLen: number, iIntro: number, pace: Pace, iNatural: number): number {
  const target = pace.playedFrom + pace.maxPlay
  if (!Number.isFinite(target) || target >= a.beats[iNatural] - 16 * beatLen) return iNatural
  const earliest = pace.playedFrom + MIN_PLAY
  const iTarget = nearestIndex(a.beats, Math.max(target, earliest))
  const reach = pace.maxPlay < 60 ? 16 : 32 // short plays: stay within a phrase of the target so 30 s means ~30 s
  const window = reach * beatLen
  let best = -1
  let bestScore = -Infinity
  for (let i = Math.max(0, iTarget - reach); i <= Math.min(iNatural, iTarget + reach); i++) {
    if ((i - iIntro) % 16 !== 0 || a.beats[i] < earliest) continue
    const t = a.beats[i]
    const drop = energyBetween(a, t - 8 * beatLen, t) - energyBetween(a, t, t + 8 * beatLen)
    const nearness = 1 - Math.abs(t - target) / window // prefer the target when energy gives no hint
    const score = drop + 0.15 * nearness
    if (score > bestScore) { bestScore = score; best = i }
  }
  return best >= 0 ? best : iNatural
}

/**
 * @param rateA A's current playback rate
 * @param from  "Mix now": start at the first beat after this A time instead of the planned phrase
 * @param pace  where A started playing and how long the DJ wants each song (default: play to the outro)
 */
export function planTransition(a: Analysis, rateA: number, b: Analysis, from?: number, pace?: Pace): Plan {
  const bpmA = a.bpm * rateA
  const ratio = tempoRatio(bpmA, b.bpm) // B's bpm / A's effective bpm, half/double counted
  const gap = Math.abs(ratio - 1)
  const keyOk = camelotCompat(a.camelot, b.camelot) >= 0.8 || Math.min(a.keyStrength, b.keyStrength) < 0.5

  // No usable beat grid: plain 6 s fade at the outro, body of B on top.
  if (a.beats.length < 16 || b.beats.length < 16) {
    const aStart = from ?? Math.max(0, a.outroStart - 6)
    return {
      style: 'fade', aStart, beats: 0, duration: 6, bOffset: b.introEnd, bDelay: 0, rateB: 1, reason: 'No reliable beat grid',
      xfade: { at: 0, dur: 6 }, echoTime: 0.375, fx: [{ deck: 'a', param: 'filter', from: 0, to: -0.5, at: 0, dur: 6 }],
    }
  }

  const iIntroA = nearestIndex(a.beats, a.introEnd)
  const iNaturalEnd = nearestIndex(a.beats, a.outroStart)
  const early = pace ? paceEndIndex(a, 60 / (a.bpm * rateA), iIntroA, pace, iNaturalEnd) : iNaturalEnd
  const iEndA = early
  const iBodyB = nearestIndex(b.beats, Math.max(b.introEnd, grooveStart(b))) // B's main part: past any slow free-time intro
  const steadyB = stabilityAt(b, iBodyB)

  let style: Style
  let beats: number
  let reason: string
  // Quick-fire sets (~45 s songs): long overlaps break the flow, so every style gets 4 bars and a short landing.
  const quick = !!pace && pace.maxPlay < 90
  if (gap > MAX_STRETCH) {
    style = 'cut'; beats = quick ? 4 : 8; reason = `Tempos too far apart (${Math.round(gap * 100)}%)`
  } else if (quick) {
    style = 'swap'; beats = 4; reason = 'Quick set: switch on the phrase downbeat'
  } else if (gap <= MAX_STRETCH && stabilityAt(a, Math.max(0, iEndA - 64)) >= STEADY && steadyB >= STEADY && keyOk) {
    style = 'blend'; beats = quick ? 16 : 64; reason = 'Steady beats, compatible keys'
  } else if (gap <= MAX_STRETCH && stabilityAt(a, Math.max(0, iEndA - 32)) >= STEADY && steadyB >= STEADY) {
    style = 'filter'; beats = quick ? 16 : 32; reason = 'Steady beats, keys clash'
  } else {
    style = 'fade'; beats = quick ? 16 : 32; reason = 'Tempo drifts in the overlap'
  }

  let iStart: number
  if (from !== undefined) {
    iStart = a.beats.findIndex((t) => t >= from)
    if (iStart < 0) iStart = a.beats.length - 1
    beats = Math.min(beats, a.beats.length - 1 - iStart)
  } else if (early !== iNaturalEnd) {
    // Leaving early: the end is already on a phrase boundary, so the mix lands exactly there.
    iStart = Math.max(0, iEndA - beats)
  } else if (style === 'swap' || style === 'cut') {
    // The switch itself must fall on a phrase downbeat.
    const iEnd = iEndA - (((iEndA - iIntroA) % 16) + 16) % 16
    iStart = Math.max(0, iEnd - beats)
  } else {
    iStart = Math.max(0, iEndA - beats)
    iStart -= ((iStart - iIntroA) % 16 + 16) % 16 // start on a 4-bar phrase boundary
    iStart = Math.max(0, iStart)
  }

  // Any overlap is beat-matched: two unmatched beats drift apart audibly within a few seconds
  // (measured: 7 % apart drifted 370 ms over an 8-beat fade). Beyond ±6 %, styles above already chose a cut.
  const rateB = style === 'cut' ? 1 : 1 / ratio
  const beatLen = 60 / bpmA
  // B comes in from earlier in its song, so its quieter intro builds under A and its main part lands mid-transition.
  // A swap's lead-in bar is B's bar before its groove starts, so B's groove lands exactly on the one.
  const lead = style === 'blend' || style === 'swap' ? beats : style === 'filter' || style === 'fade' ? beats / 2 : 0
  const iEntryB = Math.max(0, iBodyB - lead)

  const rising = b.energyRaw > a.energyRaw + 0.05
  const land = quick ? 0 : CUT_LAND_BEATS
  return {
    style,
    aStart: a.beats[iStart],
    beats,
    duration: (beats + (style === 'cut' ? land : 0)) * beatLen, // a cut ends once B has opened up
    bOffset: b.beats[iEntryB],
    bDelay: style === 'cut' ? beats * beatLen : 0, // a cut's B starts on the switch; the others overlap
    rateB: Math.round(rateB * 10000) / 10000,
    reason,
    echoTime: beatLen * 0.75,
    ...transitionFx(style, beatLen, beats, rising, land, !keyOk),
  }
}
