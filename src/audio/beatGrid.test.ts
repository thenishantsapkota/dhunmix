import { describe, expect, it } from 'vitest'
import { PATTERNS, hitsBetween, styleFor } from './beatGrid'

const grid = (bpm: number, n: number) => Array.from({ length: n }, (_, i) => (i * 60) / bpm)

describe('hitsBetween', () => {
  const beats = grid(120, 32) // 0.5 s per beat
  it('puts a house kick on every beat and claps on 2 and 4', () => {
    const hits = hitsBetween(beats, 0, PATTERNS.house, -1, 1.99)
    expect(hits.filter((h) => h.voice === 'kick').map((h) => h.t)).toEqual([0, 0.5, 1, 1.5])
    expect(hits.filter((h) => h.voice === 'clap').map((h) => h.t)).toEqual([0.5, 1.5])
  })
  it('aligns the bar to the downbeat after the intro', () => {
    // Intro ends on beat 3: the dhol's big "DHA" (step 0) must land there, not on beat 0.
    const first = hitsBetween(beats, 3, PATTERNS.dhol, -1, 3).filter((h) => h.voice === 'dagga' && h.velocity === 1)
    expect(first.map((h) => h.t)).toEqual([1.5])
  })
  it('follows tempo drift: sixteenths sit between the detected beats', () => {
    const drifting = [0, 0.5, 1.02, 1.56, 2.1, 2.62]
    const hats = hitsBetween(drifting, 0, PATTERNS.house, -1, 2).filter((h) => h.voice === 'openHat').map((h) => h.t)
    expect(hats[0]).toBeCloseTo(0.25)
    expect(hats[1]).toBeCloseTo(0.76) // halfway between 0.5 and 1.02
  })
  it('never schedules a hit twice across consecutive windows', () => {
    const a = hitsBetween(beats, 0, PATTERNS.house, 0, 1)
    const b = hitsBetween(beats, 0, PATTERNS.house, 1, 2)
    const times = [...a, ...b].map((h) => `${h.voice}@${h.t}`)
    expect(new Set(times).size).toBe(times.length)
  })
})

describe('styleFor', () => {
  it('keeps dinner quiet with percussion only', () => {
    expect(styleFor('house', 0.25)).toBe('hats')
    expect(styleFor('dhol', 0.6)).toBe('dhol')
    expect(styleFor('off', 0.9)).toBe('off')
  })
})
