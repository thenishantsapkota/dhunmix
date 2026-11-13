// Minimal IndexedDB wrapper: one store of tracks (keyed by id) and one key-value store for app state.
import type { Analysis } from '../analysis/features'

export type StoredTrack = { id: string; name: string; size: number; analysis?: Analysis; neverPlay?: boolean }

let opened: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('dhunmix', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('tracks', { keyPath: 'id' })
      req.result.createObjectStore('meta')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return opened
}

async function tx<T>(store: 'tracks' | 'meta', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(store, mode).objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const allTracks = () => tx<StoredTrack[]>('tracks', 'readonly', (s) => s.getAll())
export const putTrack = (t: StoredTrack) => tx('tracks', 'readwrite', (s) => s.put(t))
export const getMeta = <T>(key: string) => tx<T | undefined>('meta', 'readonly', (s) => s.get(key))
export const setMeta = (key: string, value: unknown) => tx('meta', 'readwrite', (s) => s.put(value, key))
