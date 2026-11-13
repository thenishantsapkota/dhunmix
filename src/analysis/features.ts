// Pure audio-feature helpers. No DOM, no essentia: runs in the worker and in tests.

export const SAMPLE_RATE = 44100 // essentia's rhythm extractor assumes 44.1 kHz

export type Analysis = {
  v: 1
  duration: number
  bpm: number // folded into 60-180
  beats: number[] // seconds, every detected beat (tempo may drift, so no fixed grid)
  key: string // e.g. "A"
  scale: 'major' | 'minor'
  keyStrength: number // 0-1, low on non-Western scales: weigh key less
  camelot: string // e.g. "8A"
  loudnessDb: number // gated RMS dB (approximates LUFS, no K-weighting)
  gainDb: number // trim to bring the track to the shared target loudness
  onsetRate: number // onsets per second
  brightness: number // zero-crossing rate, a cheap proxy for spectral brightness
  energyRaw: number // 0-1 absolute; the UI ranks it against the library
  stability: number[] // per 32-bar section, 0 (drifting) to 1 (machine-steady)
  introEnd: number // seconds, snapped to a beat
  outroStart: number // seconds, snapped to a beat
  envelope: number[] // ~400 points, 0-1, for the overview waveform
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d

/** Beat trackers often report half or double the felt tempo. Fold into a DJ-usable range. */
export function foldBpm(bpm: number, lo = 60, hi = 180): number {
  if (!(bpm > 0)) return 0
  while (bpm < lo) bpm *= 2
  while (bpm > hi) bpm /= 2
  return bpm
}

const PITCH: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
}

/** Key → Camelot wheel code. C major = 8B, A minor = 8A; each step clockwise is a fifth up. */
export function camelot(key: string, scale: 'major' | 'minor'): string {
  const p = PITCH[key]
  if (p === undefined) return '?'
  const major = scale === 'major' ? p : (p + 3) % 12 // relative major of a minor key
  const n = (((major * 7) % 12) + 7) % 12 + 1
  return `${n}${scale === 'major' ? 'B' : 'A'}`
}

/** RMS per bucket, normalised to the loudest bucket. */
export function envelope(signal: Float32Array, points = 400): number[] {
  const size = Math.max(1, Math.floor(signal.length / points))
  const out: number[] = []
  let max = 0
  for (let b = 0; b < points && b * size < signal.length; b++) {
    let sum = 0
    const end = Math.min(signal.length, (b + 1) * size)
    for (let i = b * size; i < end; i++) sum += signal[i] * signal[i]
    const rms = Math.sqrt(sum / (end - b * size))
    out.push(rms)
    if (rms > max) max = rms
  }
  return out.map((v) => (max ? round(v / max) : 0))
}

/** RMS dB per block of `seconds`. */
function blockDb(signal: Float32Array, sr: number, seconds: number): number[] {
  const size = Math.round(sr * seconds)
  const out: number[] = []
  for (let s = 0; s + size <= signal.length; s += size) {
    let sum = 0
    for (let i = s; i < s + size; i++) sum += signal[i] * signal[i]
    out.push(10 * Math.log10(sum / size + 1e-12))
  }
  return out
}

/** Gated loudness like EBU R128's two gates (absolute -70, relative -10), without K-weighting. */
export function loudnessDb(signal: Float32Array, sr = SAMPLE_RATE): number {
  const blocks = blockDb(signal, sr, 0.4).filter((db) => db > -70)
  if (!blocks.length) return -70
  const meanDb = (dbs: number[]) => 10 * Math.log10(dbs.reduce((a, db) => a + 10 ** (db / 10), 0) / dbs.length)
  const gated = blocks.filter((db) => db > meanDb(blocks) - 10)
  return meanDb(gated.length ? gated : blocks)
}

export function zeroCrossingRate(signal: Float32Array): number {
  let z = 0
  for (let i = 1; i < signal.length; i++) if ((signal[i - 1] >= 0) !== (signal[i] >= 0)) z++
  return signal.length > 1 ? z / (signal.length - 1) : 0
}

/** Absolute energy score from loudness, rhythmic density and brightness. */
export function energyRaw(loud: number, onsetRate: number, zcr: number): number {
  const n = (v: number, lo: number, hi: number) => clamp((v - lo) / (hi - lo), 0, 1)
  return round(0.5 * n(loud, -30, -8) + 0.3 * n(onsetRate, 0.5, 6) + 0.2 * n(zcr, 0.02, 0.15))
}

/**
 * Tempo steadiness per section of `beatsPerSection` beats (32 bars of 4/4 = 128).
 * Fits a straight line to beat times; RMS deviation from it is the drift.
 * 0 ms → 1 (quantised/electronic), 40 ms or more → 0 (live, drifting).
 */
export function tempoStability(beats: number[], beatsPerSection = 128): number[] {
  const out: number[] = []
  for (let s = 0; s < beats.length; s += beatsPerSection) {
    const seg = beats.slice(s, s + beatsPerSection)
    if (seg.length < 8) {
      if (!out.length) out.push(0) // too few beats to judge: treat as unsteady
      break
    }
    const n = seg.length
    const meanX = (n - 1) / 2
    const meanY = seg.reduce((a, b) => a + b, 0) / n
    let sxy = 0
    let sxx = 0
    seg.forEach((y, x) => { sxy += (x - meanX) * (y - meanY); sxx += (x - meanX) ** 2 })
    const slope = sxy / sxx
    const rms = Math.sqrt(seg.reduce((a, y, x) => a + (y - (meanY + slope * (x - meanX))) ** 2, 0) / n)
    out.push(round(clamp(1 - rms / 0.04, 0, 1), 2))
  }
  return out
}

const nearestBeat = (t: number, beats: number[]) =>
  beats.length ? beats.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best), beats[0]) : t

/** Intro ends when the track first reaches its body loudness; outro starts after it last does. */
export function introOutro(signal: Float32Array, sr: number, beats: number[]): { introEnd: number; outroStart: number } {
  const db = blockDb(signal, sr, 1)
  const duration = signal.length / sr
  if (db.length < 4) return { introEnd: 0, outroStart: duration }
  const sorted = [...db].sort((a, b) => a - b)
  const body = sorted[Math.floor(sorted.length * 0.6)] - 3 // within 3 dB of a typical loud second
  const first = db.findIndex((v) => v >= body)
  const last = db.length - 1 - [...db].reverse().findIndex((v) => v >= body)
  return { introEnd: round(nearestBeat(first, beats), 2), outroStart: round(nearestBeat(last + 1, beats), 2) }
}

/**
 * Where the groove starts: the first 16-beat stretch with a steady beat at the song's main loudness.
 * Film songs often open with a slow, free-time alaap or dialogue that is loud but has no beat; a DJ skips it.
 * Falls back to the end of the intro.
 */
export function grooveStart(a: Pick<Analysis, 'beats' | 'envelope' | 'duration' | 'introEnd'>): number {
  const { beats, envelope, duration } = a
  if (beats.length < 32 || !envelope.length) return a.introEnd
  const sorted = [...envelope].sort((x, y) => x - y)
  const body = sorted[Math.floor(sorted.length * 0.75)] * 0.6 // well into the song's normal loudness
  const energy = (t0: number, t1: number) => {
    const i0 = Math.floor((t0 / duration) * envelope.length)
    const i1 = Math.max(i0 + 1, Math.ceil((t1 / duration) * envelope.length))
    let sum = 0
    for (let i = i0; i < Math.min(i1, envelope.length); i++) sum += envelope[i]
    return sum / Math.max(1, Math.min(i1, envelope.length) - i0)
  }
  for (let i = 0; i + 16 < beats.length; i++) {
    const gaps = beats.slice(i + 1, i + 17).map((t, k) => t - beats[i + k])
    const mean = gaps.reduce((x, y) => x + y, 0) / gaps.length
    const spread = Math.sqrt(gaps.reduce((x, g) => x + (g - mean) ** 2, 0) / gaps.length) / mean
    if (spread < 0.06 && energy(beats[i], beats[i + 16]) >= body) return beats[i]
  }
  return a.introEnd
}

/** Percentile rank of each value (0-1) within its list: energy relative to the DJ's library. */
export function percentileRanks(values: number[]): number[] {
  if (values.length < 2) return values.map(() => 0.5)
  const sorted = [...values].sort((a, b) => a - b)
  return values.map((v) => sorted.indexOf(v) / (sorted.length - 1))
}

export const TARGET_LOUDNESS_DB = -14

/** Validate untrusted JSON (an imported analysis file). Returns null if the shape is wrong. */
export function parseAnalysis(x: unknown): Analysis | null {
  if (!x || typeof x !== 'object') return null
  const a = x as Record<string, unknown>
  const num = (k: string) => typeof a[k] === 'number' && Number.isFinite(a[k])
  const nums = (k: string) => Array.isArray(a[k]) && (a[k] as unknown[]).every((v) => typeof v === 'number' && Number.isFinite(v))
  const ok =
    a.v === 1 &&
    ['duration', 'bpm', 'keyStrength', 'loudnessDb', 'gainDb', 'onsetRate', 'brightness', 'energyRaw', 'introEnd', 'outroStart'].every(num) &&
    ['beats', 'stability', 'envelope'].every(nums) &&
    typeof a.key === 'string' && a.key.length <= 3 &&
    (a.scale === 'major' || a.scale === 'minor') &&
    typeof a.camelot === 'string' && a.camelot.length <= 3
  return ok ? (a as unknown as Analysis) : null
}
