// Live moves while a song plays: what a DJ does between transitions to keep the room up.
// Pure: reads the song's beat grid and energy envelope, returns timed moves.
import type { Analysis } from '../analysis/features'

export type LiveFx = 'off' | 'subtle' | 'lively'
export type MoveKind = 'riser' | 'roll' | 'bassDrop' | 'echoThrow' | 'lowpassDip'
export type Control = 'low' | 'filter' | 'echo' | 'roll'

/** A move draws a shape on one control. Times are track seconds; values as in Fx (eq dB offset, filter knob, echo send, roll slice in beats). */
export type Move = { kind: MoveKind; control: Control; at: number; points: [number, number][] }

export const MOVE_LABEL: Record<MoveKind, string> = {
  riser: 'Filter riser', roll: 'Beat roll', bassDrop: 'Bass drop', echoThrow: 'Echo throw', lowpassDip: 'Low-pass dip',
}

const KILL = -40
const PHRASE = 16 // beats: a 4-bar phrase, where songs change section

function energyBetween(a: Analysis, t0: number, t1: number): number {
  const n = a.envelope.length
  if (!n || t1 <= t0) return 0
  const i0 = Math.max(0, Math.floor((t0 / a.duration) * n))
  const i1 = Math.min(n, Math.max(i0 + 1, Math.ceil((t1 / a.duration) * n)))
  let sum = 0
  for (let i = i0; i < i1; i++) sum += a.envelope[i]
  return sum / (i1 - i0)
}

const nearestIndex = (beats: number[], t: number) => {
  let best = 0
  for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - t) < Math.abs(beats[best] - t)) best = i
  return best
}

/**
 * Moves for the stretch of song between `from` and `until` (track seconds): the live song's own time,
 * after the incoming transition and before the outgoing one. `energy` is where the event curve is now;
 * quiet stretches (dinner) get fewer, gentler moves.
 */
export function planMoves(a: Analysis, from: number, until: number, level: LiveFx, energy: number): Move[] {
  if (level === 'off' || a.beats.length < 64) return []
  const lively = level === 'lively' && energy >= 0.35
  const gapPhrases = lively ? 1 : 2 // phrases of rest after a move
  const maxMoves = lively ? 5 : 2
  const beat = (a.beats[a.beats.length - 1] - a.beats[0]) / (a.beats.length - 1)
  const iIntro = nearestIndex(a.beats, a.introEnd)
  // Leave the first phrase after the mix-in and the 4 bars before the mix-out alone.
  const start = from + PHRASE * beat
  const end = until - PHRASE * beat

  const moves: Move[] = []
  let restUntil = -Infinity
  let flat = 0
  let builds = 0 // big lifts so far: alternate riser and roll so it doesn't get predictable
  for (let i = iIntro + PHRASE; i < a.beats.length && moves.length < maxMoves; i += PHRASE) {
    const P = a.beats[i] // a phrase downbeat
    if (P < start) continue
    if (P > end) break
    if (P < restUntil) continue
    const before = energyBetween(a, P - 8 * beat, P)
    const after = energyBetween(a, P, P + 8 * beat)
    const rise = after - before
    let move: Move | null = null
    if (rise > 0.2 && lively && builds++ % 2 === 1) {
      // Big lift coming: stutter the last bar, ½ → ¼ → ⅛ beat, and drop back in on the "1".
      move = { kind: 'roll', control: 'roll', at: P - 4 * beat, points: [[P - 4 * beat, 0.5], [P - 2 * beat, 0.25], [P - beat, 0.125], [P, 0]] }
    } else if (rise > 0.2 && lively) {
      // Big lift coming (chorus/drop): sweep up for 2 bars, snap open on the "1".
      move = { kind: 'riser', control: 'filter', at: P - 8 * beat, points: [[P - 8 * beat, 0], [P - 0.03, 0.55], [P, 0]] }
    } else if (rise > 0.1) {
      // Smaller lift: take the bass out for the last bar, slam it back on the downbeat.
      move = { kind: 'bassDrop', control: 'low', at: P - 4 * beat, points: [[P - 4 * beat, 0], [P - 4 * beat + 0.03, KILL], [P - 0.02, KILL], [P, 0]] }
    } else if (rise < -0.12) {
      // A loud section ends: throw its last beat into the echo so it tails into the quieter part.
      move = { kind: 'echoThrow', control: 'echo', at: P - beat, points: [[P - beat, 0], [P - beat + 0.02, lively ? 0.7 : 0.5], [P - 0.02, lively ? 0.7 : 0.5], [P, 0]] }
    } else if (lively && ++flat >= 3) {
      // Long flat stretch: close the sound for a phrase and open it back up, so it breathes.
      move = { kind: 'lowpassDip', control: 'filter', at: P, points: [[P, 0], [P + 4 * beat, -0.35], [P + 12 * beat, -0.35], [P + PHRASE * beat - 0.05, 0]] }
    }
    if (!move) continue
    flat = 0
    moves.push(move)
    restUntil = P + (gapPhrases + 1) * PHRASE * beat
  }
  return moves
}
