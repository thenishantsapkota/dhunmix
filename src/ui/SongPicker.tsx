import { CaretDown, MagnifyingGlass, X } from '@phosphor-icons/react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Track } from '../library/store'
import { cleanTitle } from '../library/title'

type Props = {
  label: string // accessible name, e.g. "Song for First dance"
  tracks: Track[]
  value: string | null
  onChange: (id: string | null) => void
}

const MAX_RESULTS = 50 // a long event library is ~1000 songs; search narrows it, the list stays light
// "Offline" = analysed earlier but its file isn't connected yet; it can still be assigned and plays once connected.

/** Searchable song chooser. Shows film/artist and BPM/key so same-named songs can be told apart. */
export function SongPicker({ label, tracks, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()

  const chosen = tracks.find((t) => t.id === value)
  const chosenTitle = chosen ? cleanTitle(chosen.name) : null

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tracks.filter((t) => t.analysis && (!q || t.name.toLowerCase().includes(q))).slice(0, MAX_RESULTS)
  }, [tracks, query])

  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  const pick = (t: Track) => {
    onChange(t.id)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={root} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen(!open); setActive(0) }}
        className="flex h-10 w-full items-center gap-2 rounded-control border border-ink-700 bg-ink-950 pr-2 pl-3 text-left transition hover:border-ink-500 focus-visible:border-marigold"
      >
        <span className="min-w-0 flex-1">
          {chosenTitle ? (
            <>
              <span className="block truncate text-sm leading-tight">{chosenTitle.title}</span>
              <span className="block truncate text-2xs text-ink-500">
                {!chosen?.file && 'Offline · '}{chosenTitle.sub || `${chosen?.analysis?.bpm.toFixed(0)} BPM`}
              </span>
            </>
          ) : (
            <span className="text-sm text-ink-500">Choose a song</span>
          )}
        </span>
        <CaretDown size={14} className={`shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div className="absolute top-full right-0 z-20 mt-1 w-full min-w-72 overflow-hidden rounded-control border border-ink-700 bg-ink-850 shadow-pop">
          <div className="relative border-b border-white/5">
            <MagnifyingGlass size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500" aria-hidden />
            <input
              ref={input}
              role="combobox"
              aria-label={`Search ${label.toLowerCase()}`}
              aria-controls={listId}
              aria-expanded
              aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
              value={query}
              placeholder="Search songs, films, artists"
              onChange={(e) => { setQuery(e.target.value); setActive(0) }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') setActive((i) => Math.min(results.length - 1, i + 1))
                else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1))
                else if (e.key === 'Enter' && results[active]) pick(results[active])
                else if (e.key === 'Escape') setOpen(false)
                else return
                e.preventDefault()
              }}
              className="h-10 w-full bg-transparent pr-3 pl-8 text-sm placeholder:text-ink-500 focus:outline-none"
            />
          </div>
          <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto py-1">
            {results.map((t, i) => {
              const { title, sub } = cleanTitle(t.name)
              return (
                <li
                  key={t.id}
                  id={`${listId}-${t.id}`}
                  role="option"
                  aria-selected={t.id === value}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(t)}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${i === active ? 'bg-ink-800' : ''} ${t.file ? '' : 'opacity-50'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${t.id === value ? 'text-marigold' : ''}`}>{title}</span>
                    <span className="block truncate text-xs text-ink-500">{!t.file && 'Offline · '}{sub || ' '}</span>
                  </span>
                  <span className="shrink-0 text-right font-mono text-xs text-ink-400 tabular-nums">
                    {t.analysis?.bpm.toFixed(0)}<span className="ml-2 text-ink-500">{t.analysis?.camelot}</span>
                  </span>
                </li>
              )
            })}
            {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-500">No songs match "{query}"</li>}
          </ul>
          {value && (
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false) }}
              className="flex h-9 w-full items-center gap-2 border-t border-white/5 px-3 text-xs text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
            >
              <X size={12} /> Clear song
            </button>
          )}
        </div>
      )}
    </div>
  )
}
