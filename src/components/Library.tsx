import { DownloadSimple, FilePlus, Prohibit, FolderOpen, FolderSimpleUser, MagnifyingGlass, Queue, UploadSimple, Warning, YoutubeLogo } from '@phosphor-icons/react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  addFiles, canPickFolder, exportAnalysis, importAnalysis, pickFolder, reconnectFolder, retry, savedFolderName, setNeverPlay, useCrates, useProgress, useTracks, type Track,
} from '../library/store'
import { cleanTitle } from '../library/title'
import { YouTubeImport } from './YouTubeImport'

type SortKey = 'title' | 'bpm' | 'key' | 'energy'
type Props = { onLoad: (t: Track, deck: 0 | 1) => void; onQueue: (t: Track) => void; automixOn: boolean }

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const keyOrder = (c = '') => (parseInt(c) || 99) * 2 + (c.endsWith('B') ? 1 : 0)

const toolButton = 'inline-flex h-10 items-center gap-2 rounded-control border border-ink-700 px-3 text-sm text-ink-200 transition hover:bg-ink-800 active:scale-98'

function EnergyMeter({ value }: { value?: number }) {
  const lit = value === undefined ? 0 : Math.round(value * 4) + 1 // 1-5 segments
  return (
    <span className="flex gap-0.5" role="img" aria-label={value === undefined ? 'Energy unknown' : `Energy ${lit} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-3 w-1.5 rounded-sm ${i <= lit ? 'bg-marigold' : 'bg-ink-700'}`} style={{ opacity: i <= lit ? 0.4 + i * 0.12 : 1 }} />
      ))}
    </span>
  )
}

function Row({ t, onLoad, onQueue, automixOn }: { t: Track } & Props) {
  const { title, sub } = cleanTitle(t.name)
  const a = t.analysis
  const playable = !!t.file
  const busy = playable && (t.state === 'queued' || t.state === 'analyzing')
  const note = t.neverPlay ? `Never played by Automix${sub ? ` · ${sub}` : ''}` : playable ? sub || '\u00a0' : a ? 'File not connected this session' : 'Not analysed yet. Add the file again to analyse it'
  const deckButton = 'grid size-8 place-items-center rounded-lg border border-ink-700 font-mono text-xs transition enabled:hover:border-marigold enabled:hover:text-marigold active:scale-95 disabled:opacity-25'

  return (
    <li className={`grid grid-cols-track items-center gap-3 px-3 py-2 sm:grid-cols-track-wide ${playable ? '' : 'opacity-50'}`} style={{ contentVisibility: 'auto', containIntrinsicSize: '0 52px' }}>
      <div className="flex gap-1.5">
        <button className={deckButton} disabled={!playable} onClick={() => onLoad(t, 0)} aria-label={`Load ${title} on deck A`}>A</button>
        <button className={deckButton} disabled={!playable} onClick={() => onLoad(t, 1)} aria-label={`Load ${title} on deck B`}>B</button>
        <button className={deckButton} disabled={!playable || !a || !automixOn} onClick={() => onQueue(t)}
          aria-label={`Play ${title} next`} title={automixOn ? 'Play next' : 'Turn on Automix to queue'}>
          <Queue size={14} />
        </button>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-ink-500">{note}</p>
      </div>
      {busy ? (
        <>
          <span className="h-3 w-10 animate-pulse justify-self-end rounded bg-ink-700" aria-label="Analysing" />
          <span className="h-3 w-7 animate-pulse justify-self-end rounded bg-ink-700" />
          <span className="hidden h-3 w-12 animate-pulse rounded bg-ink-700 sm:block" />
          <span className="hidden sm:block" />
        </>
      ) : (
        <>
          <span className="text-right font-mono text-sm tabular-nums">{a ? a.bpm.toFixed(1) : '--'}</span>
          <span className="text-right font-mono text-sm" title={a ? `${a.key} ${a.scale}, confidence ${Math.round(a.keyStrength * 100)}%` : undefined}>
            <span className={a && a.keyStrength < 0.5 ? 'text-ink-500' : ''}>{a?.camelot ?? '--'}</span>
          </span>
          <span className="hidden sm:block"><EnergyMeter value={t.energy} /></span>
          <span className="hidden text-right font-mono text-xs text-ink-400 tabular-nums sm:block">{a ? fmt(a.duration) : ''}</span>
        </>
      )}
      <span className="hidden sm:block">
        {t.state === 'error' ? (
          <button onClick={() => retry(t.id)} title={`Analysis failed: ${t.error}. Retry`} aria-label={`Retry analysing ${title}`} className="text-danger">
            <Warning size={18} />
          </button>
        ) : (
          <button
            onClick={() => setNeverPlay(t.id, !t.neverPlay)}
            aria-pressed={!!t.neverPlay}
            aria-label={`Never play ${title}`}
            title={t.neverPlay ? 'Never played by Automix. Click to allow again' : 'Never let Automix play this'}
            className={`transition ${t.neverPlay ? 'text-danger' : 'text-ink-700 hover:text-ink-400'}`}
          >
            <Prohibit size={18} />
          </button>
        )}
      </span>
    </li>
  )
}

export function Library({ onLoad, onQueue, automixOn }: Props) {
  const tracks = useTracks()
  const progress = useProgress()
  const crates = useCrates()
  const [crate, setCrate] = useState<string | null>(null)
  const [youtube, setYoutube] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'title', dir: 1 })
  const [savedFolder, setSavedFolder] = useState<string>()
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>()
  const [dragging, setDragging] = useState(false)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const q = useDeferredValue(query.trim().toLowerCase())

  useEffect(() => { savedFolderName().then(setSavedFolder) }, [])

  const visible = useMemo(() => {
    const inCrate = crate ? new Set(crates.find((c) => c.name === crate)?.ids) : null
    const list = tracks.filter((t) => (!q || t.name.toLowerCase().includes(q)) && (!inCrate || inCrate.has(t.id)))
    const val = (t: Track): string | number =>
      sort.key === 'title' ? cleanTitle(t.name).title.toLowerCase()
        : sort.key === 'bpm' ? t.analysis?.bpm ?? 999
        : sort.key === 'key' ? keyOrder(t.analysis?.camelot)
        : t.energy ?? -1
    return list.sort((x, y) => (val(x) < val(y) ? -1 : val(x) > val(y) ? 1 : 0) * sort.dir)
  }, [tracks, q, sort, crate, crates])

  const connected = tracks.some((t) => t.file)

  const run = async (job: () => Promise<number>, verb: string) => {
    try {
      const n = await job()
      setNotice({ text: `${verb} ${n} ${n === 1 ? 'track' : 'tracks'}` })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return // picker cancelled
      setNotice({ text: err instanceof Error ? err.message : 'Something went wrong', error: true })
    }
  }

  const header = (key: SortKey, label: string, cls = '') => (
    <button
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 }))}
      className={`text-2xs tracking-wider transition hover:text-ink-100 ${sort.key === key ? 'text-ink-100' : 'text-ink-500'} ${cls}`}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      {label}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </button>
  )

  return (
    <section
      aria-label="Library"
      className={`flex min-h-0 flex-col rounded-panel border bg-ink-900 transition ${dragging ? 'border-marigold' : 'border-white/5'}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); run(() => addFiles(e.dataTransfer.files), 'Added') }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/5 p-3 sm:p-4">
        <h2 className="mr-2 font-semibold">Library <span className="font-mono text-sm font-normal text-ink-500">{tracks.length}</span></h2>
        <label className="relative order-last w-full sm:order-none sm:ml-auto sm:w-64">
          <span className="sr-only">Search library</span>
          <MagnifyingGlass size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search songs, films, artists"
            className="h-10 w-full rounded-control border border-ink-700 bg-ink-950 pr-3 pl-9 text-sm placeholder:text-ink-500 focus:border-marigold focus:outline-none"
          />
        </label>
        {savedFolder && !connected && (
          <button className={`${toolButton} border-marigold/60 text-marigold`} onClick={() => run(reconnectFolder, 'Reconnected')}>
            <FolderSimpleUser size={18} /> Reconnect {savedFolder}
          </button>
        )}
        <button className={toolButton} onClick={() => (canPickFolder() ? run(pickFolder, 'Found') : folderInput.current?.click())}>
          <FolderOpen size={18} /> Add folder
        </button>
        <button className={toolButton} onClick={() => filesInput.current?.click()}>
          <FilePlus size={18} /> Add files
        </button>
        <button className={`${toolButton} ${youtube ? 'border-marigold text-marigold' : ''}`} aria-expanded={youtube} onClick={() => setYoutube(!youtube)}>
          <YoutubeLogo size={18} /> YouTube
        </button>
        <button className={toolButton} onClick={() => importInput.current?.click()} title="Import analysis from another device" aria-label="Import analysis">
          <UploadSimple size={18} />
        </button>
        <button
          className={toolButton}
          disabled={!tracks.some((t) => t.analysis)}
          title="Export analysis to move it to another device"
          aria-label="Export analysis"
          onClick={() => {
            const url = URL.createObjectURL(exportAnalysis())
            Object.assign(document.createElement('a'), { href: url, download: 'dhunmix-analysis.json' }).click()
            URL.revokeObjectURL(url)
          }}
        >
          <DownloadSimple size={18} />
        </button>
        <input ref={filesInput} type="file" multiple accept="audio/*" hidden onChange={(e) => { run(() => addFiles(e.target.files ?? []), 'Added'); e.target.value = '' }} />
        {/* webkitdirectory: folder picking on browsers without showDirectoryPicker (Android Chrome). */}
        <input ref={folderInput} type="file" multiple hidden {...{ webkitdirectory: '' }} onChange={(e) => { run(() => addFiles(e.target.files ?? []), 'Found'); e.target.value = '' }} />
        <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => importAnalysis(f), 'Imported analysis for'); e.target.value = '' }} />
      </div>

      <YouTubeImport open={youtube} onClose={() => setYoutube(false)} />

      {crates.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-b border-white/5 px-3 py-2 sm:px-4" role="group" aria-label="Crates">
          {[null, ...crates.map((c) => c.name)].map((name) => (
            <button
              key={name ?? 'all'}
              aria-pressed={crate === name}
              onClick={() => setCrate(name)}
              className={`h-8 shrink-0 rounded-full border px-3 text-xs transition ${crate === name ? 'border-marigold bg-marigold-dim text-marigold' : 'border-ink-700 text-ink-400 hover:text-ink-100'}`}
            >
              {name ?? 'All songs'}
              {name && <span className="ml-1.5 font-mono text-ink-500">{crates.find((c) => c.name === name)?.ids.length}</span>}
            </button>
          ))}
        </div>
      )}

      {(progress.total > 0 || notice) && (
        <div className="flex items-center gap-3 border-b border-white/5 px-4 py-2 text-xs" role="status">
          {progress.total > 0 ? (
            <>
              <span className="text-ink-200">Analysing <span className="font-mono">{progress.done} / {progress.total}</span></span>
              <span className="h-0.5 flex-1 overflow-hidden rounded bg-ink-800">
                <span className="block h-full origin-left bg-marigold transition-transform duration-500" style={{ transform: `scaleX(${progress.done / progress.total})` }} />
              </span>
            </>
          ) : (
            <span className={notice?.error ? 'text-danger' : 'text-ink-400'}>{notice?.text}</span>
          )}
        </div>
      )}

      {tracks.length === 0 ? (
        <div className="grid flex-1 place-items-center px-6 py-16 text-center">
          <div className="max-w-sm">
            <p className="text-lg font-medium">Bring your music</p>
            <p className="mt-2 text-sm text-ink-400">
              Add a folder or drop files here. Each song is analysed once for tempo, key and energy, right on this device.
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button className="inline-flex h-11 items-center gap-2 rounded-control bg-marigold px-4 text-sm font-semibold text-ink-950 transition active:scale-98"
                onClick={() => (canPickFolder() ? run(pickFolder, 'Found') : folderInput.current?.click())}>
                <FolderOpen size={18} weight="bold" /> Add folder
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-track gap-3 px-3 pt-3 pb-1 sm:grid-cols-track-wide">
            <span />
            {header('title', 'TITLE', 'text-left')}
            {header('bpm', 'BPM', 'text-right')}
            {header('key', 'KEY', 'text-right')}
            {header('energy', 'ENERGY', 'hidden text-left sm:block')}
            <span className="hidden text-right text-2xs tracking-wider text-ink-500 sm:block">TIME</span>
          </div>
          <ul className="max-h-list overflow-y-auto pb-2">
            {visible.map((t) => <Row key={t.id} t={t} onLoad={onLoad} onQueue={onQueue} automixOn={automixOn} />)}
            {visible.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-500">No songs match "{query}"</li>}
          </ul>
        </>
      )}
    </section>
  )
}
