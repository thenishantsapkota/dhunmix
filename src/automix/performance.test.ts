import { describe, expect, it } from 'vitest'
import type { Analysis } from '../analysis/features'
import { planMoves } from './performance'

const bpm = 128
const beat = 60 / bpm

/** 240 s song; `loud(t)` shapes the energy envelope. Intro ends at 0 so phrases start at beat 0. */
const song = (loud: (t: number) => number): Analysis => {
  const duration = 240
  return {
    v: 1, duration, bpm, beats: Array.from({ length: Math.floor(duration / beat) }, (_, i) => i * beat),
    key: 'A', scale: 'minor', keyStrength: 0.9, camelot: '8A', loudnessDb: -12, gainDb: -2, onsetRate: 3, brightness: 0.05,
    energyRaw: 0.5, stability: [1], introEnd: 0, outroStart: 230,
    envelope: Array.from({ length: 400 }, (_, i) => loud((i / 400) * duration)),
  }
}

const phrase = 16 * beat
// Verse (quiet) / chorus (loud) alternating every 2 phrases.
const versesAndChoruses = song((t) => (Math.floor(t / (2 * phrase)) % 2 ? 1 : 0.5))

describe('planMoves', () => {
  it('builds into choruses and throws an echo as they end', () => {
    const moves = planMoves(versesAndChoruses, 0, 240, 'lively', 0.7)
    const kinds = moves.map((m) => m.kind)
    expect(kinds).toContain('riser')
    expect(kinds).toContain('echoThrow')
    for (const m of moves.filter((m) => m.kind === 'riser')) {
      const downbeat = m.points[m.points.length - 1][0]
      expect(versesAndChoruses.envelope[Math.floor((downbeat + 1) / 240 * 400)]).toBe(1) // lands as the chorus starts
      expect(m.points[m.points.length - 1][1]).toBe(0) // always returns to normal
    }
  })
  it('alternates risers and beat rolls before big lifts', () => {
    const kinds = planMoves(versesAndChoruses, 0, 240, 'lively', 0.7).map((m) => m.kind).filter((k) => k === 'riser' || k === 'roll')
    expect(kinds.slice(0, 2)).toEqual(['riser', 'roll'])
    const roll = planMoves(versesAndChoruses, 0, 240, 'lively', 0.7).find((m) => m.kind === 'roll')!
    expect(roll.points.map(([, v]) => v)).toEqual([0.5, 0.25, 0.125, 0]) // speeds up, then lets go
  })
  it('stays clear of the transitions at both ends', () => {
    const from = 30
    const until = 150
    for (const m of planMoves(versesAndChoruses, from, until, 'lively', 0.7)) {
      expect(m.at).toBeGreaterThanOrEqual(from + phrase - 8 * beat - 1e-6)
      expect(m.points[m.points.length - 1][0]).toBeLessThanOrEqual(until - phrase + phrase + 1e-6)
    }
  })
  it('leaves room between moves and caps them per song', () => {
    const lively = planMoves(versesAndChoruses, 0, 240, 'lively', 0.7)
    const subtle = planMoves(versesAndChoruses, 0, 240, 'subtle', 0.7)
    expect(lively.length).toBeLessThanOrEqual(5)
    expect(subtle.length).toBeLessThanOrEqual(2)
    const gaps = lively.slice(1).map((m, i) => m.at - lively[i].at)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(phrase)
  })
  it('is gentle when the room is quiet, and silent when off', () => {
    expect(planMoves(versesAndChoruses, 0, 240, 'lively', 0.2).some((m) => m.kind === 'riser')).toBe(false) // dinner: no risers
    expect(planMoves(versesAndChoruses, 0, 240, 'off', 0.9)).toEqual([])
  })
  it('lets a long flat stretch breathe with a low-pass dip', () => {
    const flat = planMoves(song(() => 0.8), 0, 240, 'lively', 0.7)
    expect(flat.map((m) => m.kind)).toContain('lowpassDip')
    expect(planMoves(song(() => 0.8), 0, 240, 'subtle', 0.7)).toEqual([]) // subtle leaves steady songs alone
  })
})
