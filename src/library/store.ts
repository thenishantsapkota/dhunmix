// The DJ's library: tracks known to this device, their analysis, and (this session) their files.
import { useSyncExternalStore } from 'react'
import { parseAnalysis, percentileRanks, type Analysis } from '../analysis/features'
import { analyze } from '../analysis/pool'
import { allTracks, getMeta, putTrack, setMeta, type StoredTrack } from './db'

export type TrackState = 'queued' | 'analyzing' | 'ready' | 'error'
/** A named list of songs, e.g. one imported YouTube playlist. */
export type Crate = { name: string; ids: string[] }
export type Track = StoredTrack & { file?: File; state: TrackState; error?: string; energy?: number }

const AUDIO = /\.(mp3|m4a|aac|mp4|wav|flac|ogg|opus|webm)$/i

const tracks = new Map<string, Track>()
const listeners = new Set<() => void>()
let snapshot: Track[] = []
let progress = { done: 0, total: 0 }
let crates: Crate[] = []

function emit() {
  const list = [...tracks.values()]
  // Energy is relative: the same song is "high energy" in a chill library and "mid" in a club one.
  const ready = list.filter((t) => t.analysis)
  const ranks = percentileRanks(ready.map((t) => t.analysis!.energyRaw))
  ready.forEach((t, i) => (t.energy = ranks[i]))
  snapshot = list.map((t) => ({ ...t }))
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l))
export const useTracks = () => useSyncExternalStore(subscribe, () => snapshot)
/** For non-React callers (automix). */
export const getTracks = () => snapshot
export const useProgress = () => useSyncExternalStore(subscribe, () => progress)
export const useCrates = () => useSyncExternalStore(subscribe, () => crates)

export async function addToCrate(name: string, id: string) {
  const crate = crates.find((c) => c.name === name)
  if (crate?.ids.includes(id)) return
  crates = crate ? crates.map((c) => (c === crate ? { ...c, ids: [...c.ids, id] } : c)) : [...crates, { name, ids: [id] }]
  emit()
  await setMeta('crates', crates)
}

/** Add one file and return its library id (for crates). */
export async function addFile(file: File): Promise<string> {
  await addFiles([file])
  return fingerprint(file)
}

/** Stable id from file size + first/last 64 KB: survives renames and copying to another device. */
export async function fingerprint(file: File): Promise<string> {
  const chunk = 64 * 1024
  const parts = [new TextEncoder().encode(String(file.size)), await file.slice(0, chunk).arrayBuffer(), await file.slice(-chunk).arrayBuffer()]
  const hash = await crypto.subtle.digest('SHA-256', await new Blob(parts).arrayBuffer())
  return Array.from(new Uint8Array(hash).slice(0, 10), (b) => b.toString(16).padStart(2, '0')).join('')
}

function setTrack(t: Track) {
  tracks.set(t.id, t)
  emit()
}

async function runAnalysis(t: Track) {
  setTrack({ ...t, state: 'analyzing' })
  try {
    const analysis = await analyze(t.id, t.file!)
    const next: Track = { ...tracks.get(t.id)!, analysis, state: 'ready', error: undefined }
    await putTrack({ id: next.id, name: next.name, size: next.size, analysis, neverPlay: next.neverPlay })
    setTrack(next)
  } catch (err) {
    setTrack({ ...tracks.get(t.id)!, state: 'error', error: err instanceof Error ? err.message : String(err) })
  } finally {
    progress = { ...progress, done: progress.done + 1 }
    if (progress.done >= progress.total) progress = { done: 0, total: 0 }
    emit()
  }
}

export async function addFiles(files: Iterable<File>) {
  const audio = [...files].filter((f) => AUDIO.test(f.name) || f.type.startsWith('audio/'))
  const toAnalyze: Track[] = []
  for (const file of audio) {
    const id = await fingerprint(file)
    const known = tracks.get(id)
    const name = file.name.replace(/\.[^.]+$/, '')
    if (known?.analysis || (known?.file && known.state !== 'error')) {
      tracks.set(id, { ...known, file, name })
      continue
    }
    const t: Track = { id, name, size: file.size, file, state: 'queued' }
    tracks.set(id, t)
    await putTrack({ id, name, size: file.size })
    toAnalyze.push(t)
  }
  progress = { done: progress.done, total: progress.total + toAnalyze.length }
  emit()
  toAnalyze.forEach(runAnalysis)
  return audio.length
}

/** The DJ's "never play" flag: automix won't pick the song (a moment can still use it on purpose). Saved. */
export async function setNeverPlay(id: string, neverPlay: boolean) {
  const t = tracks.get(id)
  if (!t) return
  setTrack({ ...t, neverPlay })
  await putTrack({ id, name: t.name, size: t.size, analysis: t.analysis, neverPlay })
}

export function retry(id: string) {
  const t = tracks.get(id)
  if (!t?.file) return
  progress = { done: progress.done, total: progress.total + 1 }
  runAnalysis(t)
}

async function filesIn(dir: FileSystemDirectoryHandle): Promise<File[]> {
  const out: File[] = []
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') out.push(...(await filesIn(entry as FileSystemDirectoryHandle)))
    else if (AUDIO.test(entry.name)) out.push(await (entry as FileSystemFileHandle).getFile())
  }
  return out
}

type PickerWindow = { showDirectoryPicker?: (o?: { mode: 'read' }) => Promise<FileSystemDirectoryHandle> }
type PermissionHandle = FileSystemDirectoryHandle & { requestPermission(o: { mode: 'read' }): Promise<PermissionState> }

export const canPickFolder = () => typeof (window as PickerWindow).showDirectoryPicker === 'function'

/** Chrome/Edge desktop: remember the folder so the next session can reconnect with one tap. */
export async function pickFolder() {
  const dir = await (window as PickerWindow).showDirectoryPicker!({ mode: 'read' })
  await setMeta('folder', dir)
  return addFiles(await filesIn(dir))
}

export async function savedFolderName() {
  return (await getMeta<FileSystemDirectoryHandle>('folder'))?.name
}

/** Must be called from a click: browsers only re-grant folder access on a user gesture. */
export async function reconnectFolder() {
  const dir = await getMeta<PermissionHandle>('folder')
  if (!dir || (await dir.requestPermission({ mode: 'read' })) !== 'granted') return 0
  return addFiles(await filesIn(dir))
}

export async function loadLibrary() {
  crates = (await getMeta<Crate[]>('crates')) ?? []
  for (const t of await allTracks()) {
    if (!tracks.has(t.id)) tracks.set(t.id, { ...t, state: t.analysis ? 'ready' : 'queued' })
  }
  emit()
}

/** Laptop → phone: analysis travels as JSON keyed by fingerprint; audio files stay where they are. */
export function exportAnalysis(): Blob {
  const data = [...tracks.values()].filter((t) => t.analysis).map(({ id, name, size, analysis }) => ({ id, name, size, analysis }))
  return new Blob([JSON.stringify({ app: 'dhunmix', v: 1, tracks: data })], { type: 'application/json' })
}

export async function importAnalysis(file: File): Promise<number> {
  const json = JSON.parse(await file.text()) as { app?: unknown; tracks?: unknown }
  if (json.app !== 'dhunmix' || !Array.isArray(json.tracks)) throw new Error('Not a Dhunmix analysis file')
  let added = 0
  for (const raw of json.tracks as Record<string, unknown>[]) {
    const analysis = parseAnalysis(raw?.analysis)
    const { id, name, size } = raw ?? {}
    if (!analysis || typeof id !== 'string' || !/^[0-9a-f]{20}$/.test(id) || typeof name !== 'string' || typeof size !== 'number') continue
    const known = tracks.get(id)
    if (known?.analysis) continue
    const t: Track = { id, name: name.slice(0, 300), size, analysis, file: known?.file, state: 'ready' }
    tracks.set(id, t)
    await putTrack({ id, name: t.name, size, analysis })
    added++
  }
  emit()
  return added
}

export type { Analysis }
