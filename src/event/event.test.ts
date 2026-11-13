import { describe, expect, it } from 'vitest'
import { gate, rmsDb } from './gate'
import { PRESETS, curveAt } from './presets'

describe('curveAt', () => {
  const curve = [0.2, 0.6, 1]
  it('hits the points and interpolates between them', () => {
    expect(curveAt(curve, 0)).toBe(0.2)
    expect(curveAt(curve, 0.5)).toBe(0.6)
    expect(curveAt(curve, 0.25)).toBeCloseTo(0.4)
    expect(curveAt(curve, 1)).toBe(1)
  })
  it('clamps before the start and after the end of the event', () => {
    expect(curveAt(curve, -1)).toBe(0.2)
    expect(curveAt(curve, 3)).toBe(1)
  })
})

describe('presets', () => {
  it('have 9 curve points in range and weights summing to 1', () => {
    for (const p of Object.values(PRESETS)) {
      expect(p.curve).toHaveLength(9)
      expect(p.curve.every((v) => v >= 0 && v <= 1)).toBe(true)
      expect(p.weights.key + p.weights.bpm + p.weights.energy).toBeCloseTo(1)
    }
  })
  it('wedding peaks late and closes gently', () => {
    const c = PRESETS.wedding.curve
    expect(c.indexOf(Math.max(...c))).toBeGreaterThan(4)
    expect(c[8]).toBeLessThan(Math.max(...c))
  })
})

describe('gate', () => {
  const closed = { open: false, lastAbove: -Infinity }
  it('opens immediately on speech', () => {
    expect(gate(closed, -20, 10).open).toBe(true)
  })
  it('holds through short pauses between words', () => {
    const talking = gate(closed, -20, 10)
    expect(gate(talking, -60, 10.5).open).toBe(true)
    expect(gate(talking, -60, 11).open).toBe(false)
  })
  it('stays closed on room noise below threshold', () => {
    expect(gate(closed, -50, 10).open).toBe(false)
  })
  it('measures RMS in dBFS', () => {
    expect(rmsDb(new Float32Array(100).fill(1))).toBeCloseTo(0)
    expect(rmsDb(new Float32Array(100).fill(0.1))).toBeCloseTo(-20)
  })
})
