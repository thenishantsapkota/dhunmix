// The event being played: preset, length, the DJ's reshaped curve, the clock, and its moments.
// Saved on the device so a reload mid-event keeps the clock and the moment songs.
import { useSyncExternalStore } from 'react'
import { getMeta, setMeta } from '../library/db'
import type { BeatStyle } from '../audio/beatGrid'
import type { LiveFx } from '../automix/performance'
import { PRESETS, curveAt, type PresetId } from './presets'

export type Moment = { id: string; label: string; trackId: string | null; endsSet?: boolean }

export type SongLength = 'short' | 'medium' | 'full'
/** Seconds of each song before automix moves on: quick-fire like a party DJ, or longer for dinner sets. */
export const SONG_LENGTH_S: Record<SongLength, number> = { short: 30, medium: 90, full: Infinity }

export type EventState = {
  presetId: PresetId
  songLength: SongLength
  liveFx: LiveFx // filter/EQ/echo moves while songs play
  beats: BeatStyle // drum layer over the songs
  hours: number
  curve: number[]
  startedAt: number | null // epoch ms; null until the event clock starts
  moments: Moment[]
}

const DEFAULT_MOMENTS: Moment[] = [
  { id: 'first-dance', label: 'First dance', trackId: null },
  { id: 'cake', label: 'Cake cutting', trackId: null },
  { id: 'last-song', label: 'Last song', trackId: null, endsSet: true },
]

const fresh = (presetId: PresetId): EventState => ({
  presetId, songLength: 'short', liveFx: 'lively', beats: 'dhol', hours: PRESETS[presetId].hours, curve: [...PRESETS[presetId].curve], startedAt: null, moments: DEFAULT_MOMENTS,
})

let state: EventState = fresh('wedding')
const listeners = new Set<() => void>()

function set(next: EventState) {
  state = next
  listeners.forEach((l) => l())
  setMeta('event', state).catch(() => {}) // best effort: the event still runs if storage is blocked
}

export const getEvent = () => state
export const useEvent = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)

export async function loadEvent() {
  const saved = await getMeta<EventState>('event').catch(() => undefined)
  if (saved && PRESETS[saved.presetId] && Array.isArray(saved.curve) && Array.isArray(saved.moments)) {
    state = {
      ...saved,
      songLength: saved.songLength && saved.songLength in SONG_LENGTH_S ? saved.songLength : 'short',
      liveFx: saved.liveFx === 'off' || saved.liveFx === 'subtle' ? saved.liveFx : 'lively',
      beats: saved.beats && ['off', 'dhol', 'house', 'hats'].includes(saved.beats) ? saved.beats : 'dhol',
    }
    listeners.forEach((l) => l())
  }
}

export const choosePreset = (id: PresetId) => set({ ...fresh(id), startedAt: state.startedAt, moments: state.moments, songLength: state.songLength, liveFx: state.liveFx, beats: state.beats })
export const setLiveFx = (liveFx: LiveFx) => set({ ...state, liveFx })
export const setBeats = (beats: BeatStyle) => set({ ...state, beats })
export const setSongLength = (songLength: SongLength) => set({ ...state, songLength })
export const setHours = (hours: number) => set({ ...state, hours: Math.min(12, Math.max(0.5, hours)) })
export const setCurvePoint = (i: number, v: number) =>
  set({ ...state, curve: state.curve.map((c, j) => (j === i ? Math.round(Math.min(1, Math.max(0, v)) * 100) / 100 : c)) })
export const resetCurve = () => set({ ...state, curve: [...PRESETS[state.presetId].curve] })
export const startClock = () => set({ ...state, startedAt: Date.now() })
export const resetClock = () => set({ ...state, startedAt: null })

export const assignMoment = (id: string, trackId: string | null) =>
  set({ ...state, moments: state.moments.map((m) => (m.id === id ? { ...m, trackId } : m)) })
export const addMoment = (label: string) =>
  set({ ...state, moments: [...state.moments, { id: `m${Date.now()}`, label: label.slice(0, 40), trackId: null }] })
export const removeMoment = (id: string) => set({ ...state, moments: state.moments.filter((m) => m.id !== id) })

/** 0 at the start of the event, 1 at its planned end. Before the clock starts, the event is at its beginning. */
export function progress(e: EventState = state, now = Date.now()) {
  return e.startedAt !== null ? (now - e.startedAt) / (e.hours * 3600_000) : 0
}

export const targetEnergy = (e: EventState = state, now = Date.now()) => curveAt(e.curve, progress(e, now))
