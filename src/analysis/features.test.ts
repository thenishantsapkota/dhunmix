import { describe, expect, it } from 'vitest'
import { camelot, energyRaw, envelope, foldBpm, grooveStart, introOutro, loudnessDb, parseAnalysis, percentileRanks, tempoStability } from './features'

describe('foldBpm', () => {
  it('folds half and double tempos into 60-180', () => {
    expect(foldBpm(45)).toBe(90)
    expect(foldBpm(240)).toBe(120)
    expect(foldBpm(128)).toBe(128)
    expect(foldBpm(0)).toBe(0)
  })
})

describe('camelot', () => {
  it('maps the anchor keys', () => {
    expect(camelot('C', 'major')).toBe('8B')
    expect(camelot('A', 'minor')).toBe('8A')
    expect(camelot('G', 'major')).toBe('9B')
    expect(camelot('B', 'major')).toBe('1B')
    expect(camelot('Ab', 'minor')).toBe('1A')
    expect(camelot('F#', 'minor')).toBe('11A')
    expect(camelot('E', 'major')).toBe('12B')
  })
  it('treats enharmonic spellings the same', () => {
    expect(camelot('C#', 'minor')).toBe(camelot('Db', 'minor'))
  })
  it('returns ? for unknown keys', () => {
    expect(camelot('H', 'major')).toBe('?')
  })
})

describe('tempoStability', () => {
  const grid = (bpm: number, n: number, jitter = 0, drift = 0) =>
    Array.from({ length: n }, (_, i) => i * (60 / bpm) + drift * Math.sin(i / 20) + (i % 2 ? jitter : -jitter))
  it('scores a machine-steady grid as 1', () => {
    expect(tempoStability(grid(120, 256))).toEqual([1, 1])
  })
  it('scores a drifting live performance low', () => {
    const [s] = tempoStability(grid(100, 128, 0, 0.08))
    expect(s).toBeLessThan(0.3)
  })
  it('tolerates small detector jitter', () => {
    const [s] = tempoStability(grid(120, 128, 0.005))
    expect(s).toBeGreaterThan(0.8)
  })
  it('treats too few beats as unsteady', () => {
    expect(tempoStability([0, 0.5, 1])).toEqual([0])
  })
})

describe('envelope and loudness', () => {
  const sr = 1000
  const sig = new Float32Array(sr * 20)
  // 4 s quiet intro, loud body, 4 s quiet outro
  for (let i = 0; i < sig.length; i++) sig[i] = Math.sin(i) * (i < 4 * sr || i >= 16 * sr ? 0.05 : 0.8)
  it('normalises the envelope to 0-1', () => {
    const env = envelope(sig, 20)
    expect(env).toHaveLength(20)
    expect(Math.max(...env)).toBe(1)
    expect(env[0]).toBeLessThan(0.1)
  })
  it('measures loudness of the body, gating the quiet parts', () => {
    expect(loudnessDb(sig, sr)).toBeCloseTo(20 * Math.log10(0.8 / Math.SQRT2), 0)
  })
  it('finds intro end and outro start, snapped to beats', () => {
    const beats = Array.from({ length: 40 }, (_, i) => i * 0.5)
    expect(introOutro(sig, sr, beats)).toEqual({ introEnd: 4, outroStart: 16 })
  })
})

describe('grooveStart', () => {
  // 40 s free-time alaap (loud-ish, wandering "beats"), then a steady 120 BPM groove at full level.
  const alaap = Array.from({ length: 30 }, (_, i) => i * 1.3 + (i % 3) * 0.4)
  const groove = Array.from({ length: 200 }, (_, i) => 40 + i * 0.5)
  const env = Array.from({ length: 400 }, (_, i) => ((i / 400) * 140 < 40 ? 0.7 : 1))
  const a = { beats: [...alaap, ...groove], envelope: env, duration: 140, introEnd: 3 }
  it('skips a slow free-time intro and starts where the steady beat kicks in', () => {
    expect(grooveStart(a)).toBe(40)
  })
  it('starts right away when the song grooves from the top', () => {
    expect(grooveStart({ ...a, beats: Array.from({ length: 280 }, (_, i) => i * 0.5), envelope: env.map(() => 1) })).toBe(0)
  })
  it('falls back to the end of the intro without a usable beat grid', () => {
    expect(grooveStart({ ...a, beats: [0, 1, 2] })).toBe(3)
  })
})

describe('energy', () => {
  it('rises with loudness and density', () => {
    expect(energyRaw(-8, 6, 0.15)).toBe(1)
    expect(energyRaw(-30, 0.5, 0.02)).toBe(0)
    expect(energyRaw(-12, 4, 0.1)).toBeGreaterThan(energyRaw(-20, 2, 0.05))
  })
  it('ranks within the library', () => {
    expect(percentileRanks([0.2, 0.9, 0.5])).toEqual([0, 1, 0.5])
  })
})

describe('parseAnalysis', () => {
  const good = {
    v: 1, duration: 200, bpm: 120, beats: [0, 0.5], key: 'A', scale: 'minor', keyStrength: 0.7, camelot: '8A',
    loudnessDb: -12, gainDb: -2, onsetRate: 3, brightness: 0.05, energyRaw: 0.6, stability: [1], introEnd: 8, outroStart: 190, envelope: [0, 1],
  }
  it('accepts a valid analysis', () => {
    expect(parseAnalysis(good)).toEqual(good)
  })
  it('rejects wrong shapes from untrusted files', () => {
    expect(parseAnalysis(null)).toBeNull()
    expect(parseAnalysis({ ...good, bpm: 'fast' })).toBeNull()
    expect(parseAnalysis({ ...good, beats: [0, 'x'] })).toBeNull()
    expect(parseAnalysis({ ...good, scale: 'dorian' })).toBeNull()
    expect(parseAnalysis({ ...good, key: '<script>' })).toBeNull()
  })
})
