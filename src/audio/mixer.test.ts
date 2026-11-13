import { describe, expect, it } from 'vitest'
import { crossfadeGains, filterFreqs, filterValue } from './mixer'

describe('crossfadeGains', () => {
  it('is fully A at 0 and fully B at 1', () => {
    expect(crossfadeGains(0)).toEqual([1, 0])
    const [a, b] = crossfadeGains(1)
    expect(a).toBeCloseTo(0)
    expect(b).toBeCloseTo(1)
  })
  it('keeps constant power across the fade (no volume dip in the middle)', () => {
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const [a, b] = crossfadeGains(x)
      expect(a * a + b * b).toBeCloseTo(1)
    }
  })
  it('clamps out-of-range input', () => {
    expect(crossfadeGains(-2)).toEqual(crossfadeGains(0))
    expect(crossfadeGains(5)).toEqual(crossfadeGains(1))
  })
})

describe('filterValue', () => {
  it('reads the knob position back from the cutoffs', () => {
    for (const v of [-1, -0.6, -0.2, 0, 0.3, 0.75, 1]) {
      const { lp, hp } = filterFreqs(v)
      expect(filterValue(Math.min(lp, 22050), hp)).toBeCloseTo(v, 2)
    }
  })
})

describe('filterFreqs', () => {
  it('is open at centre', () => {
    expect(filterFreqs(0)).toEqual({ lp: 22000, hp: 10 })
  })
  it('sweeps low-pass down when turned left', () => {
    expect(filterFreqs(-0.5).lp).toBeLessThan(filterFreqs(-0.2).lp)
    expect(filterFreqs(-1).lp).toBeCloseTo(100)
  })
  it('sweeps high-pass up when turned right', () => {
    expect(filterFreqs(0.5).hp).toBeGreaterThan(filterFreqs(0.2).hp)
    expect(filterFreqs(1).hp).toBeCloseTo(8000)
  })
})
