import { ArrowCounterClockwise, Play } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { PRESETS, type PresetId } from '../event/presets'
import { choosePreset, progress, resetClock, resetCurve, setCurvePoint, setHours, setBeats, setLiveFx, setSongLength, startClock, targetEnergy, useEvent, type SongLength } from '../event/store'
import type { LiveFx } from '../automix/performance'
import type { BeatStyle } from '../audio/beatGrid'

const hm = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

/** Energy plan for the event. Each point drags up/down; the marker shows where the event is now. */
function CurveEditor({ curve, now }: { curve: number[]; now: number | null }) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<number | null>(null)
  const x = (i: number) => (i / (curve.length - 1)) * 100
  const y = (v: number) => (1 - v) * 100
  const line = curve.map((v, i) => `${x(i)},${y(v)}`).join(' ')

  const valueAt = (clientY: number) => {
    const r = box.current!.getBoundingClientRect()
    return 1 - (clientY - r.top) / r.height
  }

  return (
    <div
      ref={box}
      className="relative h-36 touch-none select-none"
      onPointerMove={(e) => { if (drag.current !== null) setCurvePoint(drag.current, valueAt(e.clientY)) }}
      onPointerUp={() => (drag.current = null)}
      onPointerLeave={() => (drag.current = null)}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2="100" y1={y(g)} y2={y(g)} stroke="var(--color-ink-800)" vectorEffect="non-scaling-stroke" />)}
        <polygon points={`0,100 ${line} 100,100`} fill="var(--color-marigold-dim)" />
        <polyline points={line} fill="none" stroke="var(--color-marigold)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {now !== null && <line x1={now * 100} x2={now * 100} y1="0" y2="100" stroke="var(--color-ink-100)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
      </svg>
      {curve.map((v, i) => (
        <span
          key={i}
          role="slider"
          tabIndex={0}
          aria-label={`Energy at ${Math.round(x(i))}% of the event`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(v * 100)}
          className="absolute size-5 -translate-1/2 cursor-ns-resize rounded-full border-2 border-marigold bg-ink-900 transition-transform hover:scale-125 focus-visible:scale-125"
          style={{ left: `${x(i)}%`, top: `${y(v)}%` }}
          onPointerDown={(e) => { e.currentTarget.parentElement!.setPointerCapture(e.pointerId); drag.current = i }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') setCurvePoint(i, v + 0.05)
            else if (e.key === 'ArrowDown') setCurvePoint(i, v - 0.05)
            else return
            e.preventDefault()
          }}
        />
      ))}
    </div>
  )
}

export function EventPanel({ onChange }: { onChange: () => void }) {
  const e = useEvent()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000) // clock shows minutes; the curve marker moves slowly
    return () => clearInterval(id)
  }, [])
  useEffect(onChange, [e.presetId, e.curve, e.hours, e.startedAt, e.songLength, onChange])

  const p = e.startedAt ? Math.min(1, progress(e, now)) : null
  const elapsed = e.startedAt ? now - e.startedAt : 0

  return (
    <section aria-label="Event" className="flex flex-col gap-4 rounded-panel border border-white/5 bg-ink-900 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto font-semibold">Event</h2>
        <div role="radiogroup" aria-label="Event type" className="flex flex-wrap gap-1 rounded-control bg-ink-950 p-1">
          {(Object.keys(PRESETS) as PresetId[]).map((id) => (
            <button
              key={id}
              role="radio"
              aria-checked={e.presetId === id}
              title={PRESETS[id].hint}
              onClick={() => choosePreset(id)}
              className={`h-8 rounded-lg px-3 text-sm transition ${e.presetId === id ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}
            >
              {PRESETS[id].name}
            </button>
          ))}
        </div>
      </div>

      <CurveEditor curve={e.curve} now={p} />
      <div className="-mt-2 flex justify-between font-mono text-2xs text-ink-500">
        <span>START</span>
        <span>{e.hours / 2}H</span>
        <span>END {e.hours}H</span>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">Length (hours)</span>
          <input
            type="number"
            min={0.5}
            max={12}
            step={0.5}
            value={e.hours}
            onChange={(ev) => setHours(+ev.target.value || e.hours)}
            className="h-10 w-24 rounded-control border border-ink-700 bg-ink-950 px-3 font-mono text-sm focus:border-marigold focus:outline-none"
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-ink-400" id="song-length-label">Each song plays</span>
          <div role="radiogroup" aria-labelledby="song-length-label" className="flex h-10 items-center gap-1 rounded-control bg-ink-950 p-1">
            {([['short', '~0:30'], ['medium', '~1:30'], ['full', 'Full']] as [SongLength, string][]).map(([id, label]) => (
              <button
                key={id}
                role="radio"
                aria-checked={e.songLength === id}
                onClick={() => setSongLength(id)}
                className={`h-8 rounded-lg px-3 font-mono text-xs transition ${e.songLength === id ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-ink-400" id="live-fx-label">Live FX</span>
          <div role="radiogroup" aria-labelledby="live-fx-label" className="flex h-10 items-center gap-1 rounded-control bg-ink-950 p-1">
            {([['off', 'Off'], ['subtle', 'Subtle'], ['lively', 'Lively']] as [LiveFx, string][]).map(([id, label]) => (
              <button
                key={id}
                role="radio"
                aria-checked={e.liveFx === id}
                title={id === 'lively' ? 'Filter risers, bass drops, echo throws and dips while songs play' : id === 'subtle' ? 'A couple of bass drops and echo throws per song' : 'Songs play untouched between transitions'}
                onClick={() => setLiveFx(id)}
                className={`h-8 rounded-lg px-3 text-xs transition ${e.liveFx === id ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-ink-400" id="beats-label">Beats</span>
          <div role="radiogroup" aria-labelledby="beats-label" className="flex h-10 items-center gap-1 rounded-control bg-ink-950 p-1">
            {([['off', 'Off'], ['dhol', 'Dhol'], ['house', 'House'], ['hats', 'Hats']] as [BeatStyle, string][]).map(([id, label]) => (
              <button
                key={id}
                role="radio"
                aria-checked={e.beats === id}
                title={id === 'dhol' ? 'Bhangra dhol groove locked to the song' : id === 'house' ? 'Four-on-the-floor kick, claps and hats' : id === 'hats' ? 'Light hi-hats only' : 'No extra drums'}
                onClick={() => setBeats(id)}
                className={`h-8 rounded-lg px-3 text-xs transition ${e.beats === id ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">Event clock</span>
          {e.startedAt ? (
            <div className="flex h-10 items-center gap-3">
              <span className="font-mono text-sm tabular-nums">{hm(elapsed)} <span className="text-ink-500">of {hm(e.hours * 3600_000)}</span></span>
              <button onClick={resetClock} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-ink-400 transition hover:bg-ink-800 hover:text-ink-100">
                <ArrowCounterClockwise size={14} /> Restart
              </button>
            </div>
          ) : (
            <button onClick={startClock} className="inline-flex h-10 items-center gap-2 rounded-control border border-ink-700 px-3 text-sm transition hover:bg-ink-800 active:scale-98">
              <Play size={14} weight="fill" /> Start now
            </button>
          )}
        </div>
        <p className="ml-auto text-sm text-ink-400">
          Aiming for energy <span className="font-mono text-ink-100">{Math.round(targetEnergy(e, now) * 100)}</span>
          <button onClick={resetCurve} className="ml-3 text-xs text-ink-500 underline-offset-2 hover:text-ink-200 hover:underline">Reset curve</button>
        </p>
      </div>
      {!e.startedAt && <p className="text-xs text-ink-500">The clock starts by itself when you turn on Automix.</p>}
    </section>
  )
}
