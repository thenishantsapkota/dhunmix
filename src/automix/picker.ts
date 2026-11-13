// Chooses what plays next. Pure: no audio, no DOM.
import type { Analysis } from '../analysis/features'

export type Candidate = { id: string; analysis: Analysis; energy: number } // energy: 0-1 rank in the library

const parseCamelot = (c: string) => ({ n: parseInt(c), mode: c.slice(-1) })

/** Harmonic compatibility on the Camelot wheel: 1 = same key, 0.8 = neighbour/relative, 0.5 = energy boost, else 0.1. */
export function camelotCompat(a: string, b: string): number {
  const x = parseCamelot(a)
  const y = parseCamelot(b)
  if (!x.n || !y.n) return 0.5 // unknown key: neutral
  const step = (y.n - x.n + 12) % 12
  if (x.mode === y.mode) {
    if (step === 0) return 1
    if (step === 1 || step === 11) return 0.8
    if (step === 2) return 0.5 // +2: the classic "energy boost" mix
    return 0.1
  }
  return step === 0 ? 0.8 : 0.1 // relative major/minor
}

/** Closest tempo ratio counting half/double time. 1.03 = candidate must run 3 % slower to match. */
export function tempoRatio(curBpm: number, candBpm: number): number {
  return [1, 2, 0.5].map((m) => (candBpm * m) / curBpm).reduce((best, r) => (Math.abs(Math.log(r)) < Math.abs(Math.log(best)) ? r : best))
}

/**
 * Within ±6 % the mix can be tempo-matched (smooth); beyond it the planner has to cut. So closeness falls off a
 * cliff there: a matching key never outweighs a smooth mix with another song.
 */
export function bpmCloseness(curBpm: number, candBpm: number): number {
  const gap = Math.abs(tempoRatio(curBpm, candBpm) - 1)
  return gap <= 0.06 ? 1 - (gap / 0.06) * 0.3 : Math.max(0, 0.2 - (gap - 0.06) * 2)
}

/** Key detection is unreliable on some songs (non-Western scales): trust the key score only as far as both detections are confident. */
function keyScore(cur: Analysis, cand: Analysis): number {
  const trust = Math.min(1, Math.max(0, (Math.min(cur.keyStrength, cand.keyStrength) - 0.5) / 0.4))
  return trust * camelotCompat(cur.camelot, cand.camelot) + (1 - trust) * 0.6
}

export type Weights = { key: number; bpm: number; energy: number }
export const DEFAULT_WEIGHTS: Weights = { key: 0.3, bpm: 0.35, energy: 0.35 }

export function score(cur: Analysis, cand: Candidate, targetEnergy: number, w = DEFAULT_WEIGHTS): number {
  return w.key * keyScore(cur, cand.analysis) + w.bpm * bpmCloseness(cur.bpm, cand.analysis.bpm) + w.energy * (1 - Math.abs(cand.energy - targetEnergy))
}

/** Best candidates first. Never repeats a played track. */
export function rankNext(cur: Analysis, pool: Candidate[], played: Set<string>, targetEnergy: number, w = DEFAULT_WEIGHTS): Candidate[] {
  return pool
    .filter((c) => !played.has(c.id))
    .map((c) => ({ c, s: score(cur, c, targetEnergy, w) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c)
}

/** First track of a set: the one closest to a warm-up energy. */
export function pickOpener(pool: Candidate[], targetEnergy = 0.4): Candidate | undefined {
  return [...pool].sort((a, b) => Math.abs(a.energy - targetEnergy) - Math.abs(b.energy - targetEnergy))[0]
}
