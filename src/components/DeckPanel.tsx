import { Pause, Play, Repeat, SkipBack } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useReducer } from 'react'
import type { Band, Deck, Mixer } from '../audio/mixer'
import { cleanTitle } from '../library/title'
import { Knob } from '../ui/Knob'
import { Waveform } from '../ui/Waveform'

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const db = (v: number) => (Math.abs(v) < 0.25 ? '0 dB' : v <= -25.5 ? 'kill' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`)

type Props = {
  deck: Deck
  letter: 'A' | 'B'
  mixer: Mixer
  loading: boolean
  badge?: 'On air' | 'Up next' | 'Mixing in'
  onTakeOver: () => void // play/pause by hand hands control back to the DJ
}

export function DeckPanel({ deck, letter, mixer, loading, badge, onTakeOver }: Props) {
  const color = letter === 'A' ? 'var(--color-marigold)' : 'var(--color-deck-b)'
  const [, tick] = useReducer((n: number) => n + 1, 0)
  // Settings live on the deck so automix (tempo glide, restored EQ) and the UI always agree.
  const tempo = Math.round((deck.rate - 1) * 1000) / 10

  // ~30 fps so the knobs visibly turn while automix works them; the waveform animates itself.
  useEffect(() => {
    let frame = 0
    let last = 0
    const loop = (t: number) => {
      if (t - last > 33) { last = t; tick() }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [])
  const live = deck.live // what the controls are doing right now, automation included

  const getPosition = useCallback(() => deck.position, [deck])
  // Seeking doesn't stop automix: it re-plans the transition from the new position.
  const seek = useCallback((s: number) => { deck.seek(s); tick() }, [deck])
  const a = deck.analysis
  const markers = useMemo(() => (a ? [a.introEnd, a.outroStart] : []), [a])
  const { title, sub } = cleanTitle(deck.name)
  const hasTrack = !!deck.buffer

  return (
    <section aria-label={`Deck ${letter}`} className="flex min-w-0 flex-col gap-4 rounded-panel border border-white/5 bg-ink-900 p-4 sm:p-5">
      <header className="flex items-start gap-3">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-control font-mono text-sm font-semibold text-ink-950"
          style={{ background: color }}
        >
          {letter}
        </span>
        <div className="min-w-0 flex-1">
          {badge && (
            <p className={`mb-1 text-2xs font-semibold tracking-wider ${badge === 'Up next' ? 'text-ink-400' : 'text-marigold'}`}>{badge.toUpperCase()}</p>
          )}
          {loading ? (
            <div className="space-y-2 pt-1" aria-label="Loading track">
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-ink-700" />
              <div className="h-2.5 w-1/2 animate-pulse rounded bg-ink-800" />
            </div>
          ) : hasTrack ? (
            <>
              <p className="truncate font-medium leading-tight">{title}</p>
              <p className="truncate text-sm text-ink-400">{sub || ' '}</p>
            </>
          ) : (
            <>
              <p className="font-medium leading-tight text-ink-400">Empty deck</p>
              <p className="text-sm text-ink-500">Load a track from the library</p>
            </>
          )}
        </div>
        <dl className="flex shrink-0 gap-4 text-right">
          <div>
            <dt className="text-2xs tracking-wider text-ink-500">BPM</dt>
            <dd className="font-mono text-lg leading-tight tabular-nums">{a ? deck.bpm.toFixed(1) : '--'}</dd>
          </div>
          <div>
            <dt className="text-2xs tracking-wider text-ink-500">KEY</dt>
            <dd className="font-mono text-lg leading-tight" title={a ? `${a.key} ${a.scale}` : undefined}>{a?.camelot ?? '--'}</dd>
          </div>
        </dl>
      </header>

      <div>
        <Waveform envelope={deck.envelope} duration={deck.duration} getPosition={getPosition} onSeek={seek} color={color} markers={markers} />
        <div className="mt-1.5 flex justify-between font-mono text-xs text-ink-400 tabular-nums">
          <span>{fmt(deck.position)}</span>
          <span>-{fmt(Math.max(0, deck.duration - deck.position))}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex items-center gap-3">
          <button
            disabled={!hasTrack}
            aria-label={deck.playing ? 'Pause' : 'Play'}
            onClick={async () => {
              await mixer.resume()
              onTakeOver()
              if (deck.playing) deck.pause()
              else deck.play()
              tick()
            }}
            className="grid size-14 place-items-center rounded-full text-ink-950 shadow-key transition active:scale-95 disabled:opacity-30"
            style={{ background: color }}
          >
            {deck.playing ? <Pause size={24} weight="fill" /> : <Play size={24} weight="fill" />}
          </button>
          <button
            disabled={!hasTrack}
            aria-label="Cue: back to start"
            onClick={() => seek(0)}
            className="grid size-11 place-items-center rounded-full border border-ink-700 text-ink-200 transition hover:bg-ink-800 active:scale-95 disabled:opacity-30"
          >
            <SkipBack size={18} weight="fill" />
          </button>
          <button
            disabled={!deck.playing}
            aria-label="Hold to roll the beat"
            title="Hold to repeat the beat (¼-beat roll). Let go and the song carries on in time."
            onPointerDown={() => deck.startRoll(0.25)}
            onPointerUp={() => deck.stopRoll()}
            onPointerLeave={() => deck.stopRoll()}
            onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); deck.startRoll(0.25) } }}
            onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') deck.stopRoll() }}
            className="grid size-11 touch-none place-items-center rounded-full border border-ink-700 text-ink-200 transition select-none hover:bg-ink-800 active:scale-95 active:border-marigold active:text-marigold disabled:opacity-30"
          >
            <Repeat size={18} weight="bold" />
          </button>
        </div>

        <div className="flex gap-2">
          {(['high', 'mid', 'low'] as Band[]).map((b) => (
            <Knob key={b} label={b === 'high' ? 'HI' : b.toUpperCase()} value={Math.round(live.eq[b] * 2) / 2} min={-26} max={6} defaultValue={0} format={db} color={color}
              onChange={(v) => { deck.setEq(b, v); tick() }} />
          ))}
          <Knob label="FILTER" value={Math.round(live.filter * 100) / 100} min={-1} max={1} defaultValue={0} color={color}
            format={(v) => (Math.abs(v) < 0.02 ? 'open' : v < 0 ? 'LP' : 'HP')}
            onChange={(v) => { deck.setFilter(v); tick() }} />
        </div>

        <label className="ml-auto flex h-24 items-center gap-1" title="Channel volume">
          <span className="sr-only">Volume</span>
          <input type="range" className="fader fader-v" min={0} max={1} step={0.01} value={deck.volumeValue}
            onChange={(e) => { deck.setVolume(+e.target.value); tick() }} />
        </label>
      </div>

      <label className="flex items-center gap-3">
        <span className="w-12 text-2xs tracking-wider text-ink-500">TEMPO</span>
        <input type="range" className="fader" min={-8} max={8} step={0.05} value={tempo}
          onDoubleClick={() => { deck.setRate(1); tick() }}
          onChange={(e) => { deck.setRate(1 + +e.target.value / 100); tick() }} />
        <span className="w-14 text-right font-mono text-xs text-ink-400 tabular-nums">{tempo > 0 ? '+' : ''}{tempo.toFixed(1)}%</span>
      </label>
    </section>
  )
}
