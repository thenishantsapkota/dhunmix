// Talks to the YouTube helper running on this laptop (pnpm helper).
export const HELPER_URL = import.meta.env.VITE_HELPER_URL ?? 'http://127.0.0.1:7731'

export type ItemStatus = 'queued' | 'downloading' | 'done' | 'skipped' | 'failed'
export type ImportItem = { index: number; id: string; title: string; status: ItemStatus; file?: string; error?: string }
export type ImportJob = { id: string; title: string; finished: boolean; items: ImportItem[] }
type HelperEvent = ({ type: 'job' } & ImportJob) | { type: 'item'; item: ImportItem } | { type: 'error'; message: string }

export async function helperOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${HELPER_URL}/health`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

export async function startImport(url: string): Promise<string> {
  const res = await fetch(`${HELPER_URL}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const data = (await res.json()) as { id?: string; error?: string }
  if (!res.ok || !data.id) throw new Error(data.error ?? 'The helper refused the link')
  return data.id
}

/** Live progress of an import. Returns a function that stops listening (the download carries on). */
export function follow(id: string, on: { job: (j: ImportJob) => void; item: (i: ImportItem) => void; error: (m: string) => void }) {
  const es = new EventSource(`${HELPER_URL}/jobs/${id}/events`)
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data) as HelperEvent
    if (ev.type === 'job') {
      on.job(ev)
      if (ev.finished) es.close()
    } else if (ev.type === 'item') on.item(ev.item)
    else on.error(ev.message)
  }
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) on.error('Lost contact with the helper. Is it still running?')
  }
  return () => es.close()
}

/** Fetch a downloaded song from the helper as a File the library can analyse. */
export async function fetchSong(path: string): Promise<File> {
  const res = await fetch(`${HELPER_URL}/files?path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error('Could not fetch the downloaded file')
  return new File([await res.blob()], path.split(/[\\/]/).pop()!, { type: 'audio/mp4' })
}
