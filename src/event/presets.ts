// Event presets: how energy should move across the night, and what the picker cares about most.
import type { Weights } from '../automix/picker'

export type PresetId = 'wedding' | 'club' | 'corporate' | 'house'

export type Preset = {
  id: PresetId
  name: string
  hint: string
  hours: number // default event length
  curve: number[] // target energy (0-1, library-relative) at evenly spaced points from start to end
  weights: Weights
}

// 9 points = start, every 1/8 of the event, end. Energy is a percentile of the DJ's own library.
export const PRESETS: Record<PresetId, Preset> = {
  wedding: {
    id: 'wedding', name: 'Wedding', hint: 'Dinner, slow build, peak, gentle close', hours: 5,
    curve: [0.25, 0.3, 0.3, 0.45, 0.6, 0.75, 0.9, 0.85, 0.6],
    weights: { key: 0.25, bpm: 0.3, energy: 0.45 }, // the room's mood matters more than perfect harmony
  },
  club: {
    id: 'club', name: 'Club night', hint: 'Warm-up, peaks in waves, closing', hours: 4,
    curve: [0.4, 0.5, 0.7, 0.85, 0.7, 0.9, 0.95, 0.85, 0.6],
    weights: { key: 0.3, bpm: 0.45, energy: 0.25 }, // seamless tempo is what dancers notice
  },
  corporate: {
    id: 'corporate', name: 'Corporate', hint: 'Steady background, never too loud', hours: 3,
    curve: [0.3, 0.35, 0.4, 0.45, 0.45, 0.5, 0.45, 0.4, 0.35],
    weights: { key: 0.35, bpm: 0.25, energy: 0.4 },
  },
  house: {
    id: 'house', name: 'House party', hint: 'Builds up, then holds high', hours: 4,
    curve: [0.4, 0.5, 0.65, 0.8, 0.8, 0.8, 0.8, 0.8, 0.7],
    weights: { key: 0.3, bpm: 0.35, energy: 0.35 },
  },
}

/** Target energy at `progress` (0 = start, 1 = end) by linear interpolation between curve points. */
export function curveAt(curve: number[], progress: number): number {
  if (!curve.length) return 0.5
  const p = Math.min(1, Math.max(0, progress)) * (curve.length - 1)
  const i = Math.floor(p)
  if (i >= curve.length - 1) return curve[curve.length - 1]
  return curve[i] + (curve[i + 1] - curve[i]) * (p - i)
}
