import { ArrowClockwise, CheckCircle, CircleDashed, DownloadSimple, SkipForward, Warning, X } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { addFile, addToCrate } from '../library/store'
import { cleanTitle } from '../library/title'
import { fetchSong, follow, helperOnline, startImport, type ImportItem, type ImportJob } from '../youtube/client'

type Props = { open: boolean; onClose: () => void }

const ICON: Record<ImportItem['status'], React.ReactNode> = {
  queued: <CircleDashed size={16} className="text-ink-500" />,
  downloading: <DownloadSimple size={16} className="animate-pulse text-marigold" />,
  done: <CheckCircle size={16} weight="fill" className="text-marigold" />,
  skipped: <SkipForward size={16} className="text-ink-400" />,
  failed: <Warning size={16} className="text-danger" />,
}

/**
 * One link in, a whole playlist out. Stays mounted while closed so an import keeps going
 * (and keeps feeding the library) while the DJ does other things.
 */
export function YouTubeImport({ open, onClose }: Props) {
  const [online, setOnline] = useState<boolean | null>(null)
  const [link, setLink] = useState('')
  const [job, setJob] = useState<ImportJob | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ingested = useRef(new Set<string>())
  const chain = useRef<Promise<void>>(Promise.resolve())
  const stop = useRef<(() => void) | null>(null)

  const check = () => { setOnline(null); helperOnline().then(setOnline) }
  useEffect(() => { if (open) helperOnline().then(setOnline) }, [open])
  useEffect(() => () => stop.current?.(), [])

  // Each finished (or already-downloaded) song goes into the library and the playlist's crate, one at a time.
  const ingest = (crate: string, item: ImportItem) => {
    if (!item.file || ingested.current.has(item.file)) return
    ingested.current.add(item.file)
    chain.current = chain.current.then(async () => {
      try {
        await addToCrate(crate, await addFile(await fetchSong(item.file!)))
      } catch {
        setError(`Couldn't add "${cleanTitle(item.title).title}" to the library.`)
      }
    })
  }

  const begin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const id = await startImport(link)
      setLink('')
      ingested.current = new Set()
      stop.current?.()
      let title = ''
      stop.current = follow(id, {
        job: (j) => {
          title = j.title
          setJob(j)
          j.items.forEach((i) => (i.status === 'done' || i.status === 'skipped') && ingest(title, i))
        },
        item: (item) => {
          setJob((j) => (j ? { ...j, items: j.items.map((i) => (i.id === item.id ? item : i)) } : j))
          if (item.status === 'done') ingest(title, item)
        },
        error: setError,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      if (!(await helperOnline())) setOnline(false)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const count = (s: ImportItem['status']) => job?.items.filter((i) => i.status === s).length ?? 0
  const finished = count('done') + count('skipped') + count('failed')
  const total = job?.items.length ?? 0

  return (
    <div className="flex flex-col gap-3 border-b border-white/5 bg-ink-850 p-4">
      <div className="flex items-center gap-2">
        <h3 className="mr-auto font-medium">Import from YouTube</h3>
        <button onClick={onClose} aria-label="Close YouTube import" className="grid size-8 place-items-center rounded-lg text-ink-400 transition hover:bg-ink-800 hover:text-ink-100">
          <X size={16} />
        </button>
      </div>

      {online === false ? (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-ink-200">The download helper isn't running on this device.</p>
          <ol className="list-decimal space-y-1 pl-5 text-ink-400">
            <li>Install the tools once: <code className="rounded bg-ink-950 px-1.5 py-0.5 font-mono text-xs text-ink-200">brew install yt-dlp ffmpeg</code></li>
            <li>In the Dhunmix folder run <code className="rounded bg-ink-950 px-1.5 py-0.5 font-mono text-xs text-ink-200">pnpm helper</code> and leave it open.</li>
          </ol>
          <p className="text-xs text-ink-500">Phones can't download. Import on your laptop, then export the analysis to the phone.</p>
          <button onClick={check} className="inline-flex h-9 w-fit items-center gap-2 rounded-control border border-ink-700 px-3 text-sm transition hover:bg-ink-800">
            <ArrowClockwise size={14} /> Check again
          </button>
        </div>
      ) : (
        <form onSubmit={begin} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-ink-400">Playlist or video link</span>
            <input
              type="url"
              required
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://www.youtube.com/playlist?list=…"
              className="h-10 rounded-control border border-ink-700 bg-ink-950 px-3 text-sm placeholder:text-ink-500 focus:border-marigold focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={busy || online === null}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-control bg-marigold px-4 text-sm font-semibold text-ink-950 transition active:scale-98 disabled:opacity-40"
          >
            <DownloadSimple size={16} weight="bold" /> Import
          </button>
        </form>
      )}
      <p className="text-xs text-ink-500">Downloads go to your music folder for your own use. Downloading from YouTube is against YouTube's terms.</p>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {job && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-3 text-sm">
            <span className="truncate font-medium">{job.title || 'Reading playlist…'}</span>
            {total > 0 && <span className="ml-auto shrink-0 font-mono text-ink-400 tabular-nums" role="status">{finished} / {total}</span>}
          </div>
          {total > 0 && (
            <span className="block h-0.5 overflow-hidden rounded bg-ink-800" aria-hidden>
              <span className="block h-full origin-left bg-marigold transition-transform duration-500" style={{ transform: `scaleX(${finished / total})` }} />
            </span>
          )}
          {job.finished && (
            <p className="text-sm text-ink-200">
              {count('done')} downloaded, {count('skipped')} already in your folder{count('failed') > 0 && `, ${count('failed')} unavailable`}. They're in the crate "{job.title}".
            </p>
          )}
          <ul className="max-h-list overflow-y-auto">
            {job.items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-1.5 text-sm">
                <span className="shrink-0" aria-label={i.status}>{ICON[i.status]}</span>
                <span className="min-w-0 flex-1 truncate">{cleanTitle(i.title).title}</span>
                <span className={`shrink-0 truncate text-xs ${i.status === 'failed' ? 'max-w-56 text-danger' : 'text-ink-500'}`} title={i.error}>
                  {i.status === 'failed' ? i.error : i.status === 'skipped' ? 'Already downloaded' : i.status === 'downloading' ? 'Downloading' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
