import { Microphone, MicrophoneSlash, Plus, Sparkle, X } from '@phosphor-icons/react'
import { useEffect, useReducer, useState } from 'react'
import type { Mixer } from '../audio/mixer'
import type { Automix } from '../automix/controller'
import { MicDucker } from '../event/mic'
import { addMoment, assignMoment, removeMoment, useEvent } from '../event/store'
import { useTracks } from '../library/store'
import { SongPicker } from '../ui/SongPicker'

const SPEECH_DB = 18 // music stays audible as a bed under speeches
const TALK_DB = 12

export function MomentsPanel({ mixer, automix }: { mixer: Mixer; automix: Automix }) {
  const e = useEvent()
  const tracks = useTracks()
  const playable = tracks.filter((t) => t.file && t.analysis)
  const [speech, setSpeech] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const [mic] = useState(() => new MicDucker(mixer, tick))
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([])
  const [device, setDevice] = useState('')
  const [micError, setMicError] = useState('')

  useEffect(() => () => mic.stop(), [mic])

  const toggleMic = async () => {
    setMicError('')
    if (mic.running) return mic.stop()
    try {
      await mic.start(device || undefined)
      setInputs(await MicDucker.inputs())
    } catch {
      setMicError('Microphone access was blocked. Allow it in the browser to use auto-ducking.')
    }
  }

  const levelPct = Math.min(100, Math.max(0, ((mic.level + 80) / 80) * 100))
  const thresholdPct = ((mic.config.thresholdDb + 80) / 80) * 100

  return (
    <section aria-label="Moments and voice" className="flex flex-col gap-5 rounded-panel border border-white/5 bg-ink-900 p-4 sm:p-5">
      <div>
        <h2 className="font-semibold">Moments</h2>
        <p className="mt-1 text-xs text-ink-400">Fades the current song out and starts the moment song from its beginning.</p>
        <ul className="mt-3 flex flex-col gap-2">
          {e.moments.map((m) => {
            const t = playable.find((p) => p.id === m.trackId)
            return (
              <li key={m.id} className="flex items-center gap-2">
                <button
                  disabled={!t}
                  onClick={() => t && automix.playMoment(t, !!m.endsSet)}
                  className="inline-flex h-10 w-36 shrink-0 items-center gap-2 rounded-control bg-marigold px-3 text-sm font-semibold text-ink-950 transition active:scale-98 disabled:bg-ink-800 disabled:text-ink-500"
                >
                  <Sparkle size={14} weight="fill" className="shrink-0" />
                  <span className="truncate">{m.label}</span>
                </button>
                <SongPicker label={`Song for ${m.label}`} tracks={tracks} value={m.trackId} onChange={(id) => assignMoment(m.id, id)} />
                <button onClick={() => removeMoment(m.id)} aria-label={`Remove ${m.label}`} className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-500 transition hover:bg-ink-800 hover:text-ink-100">
                  <X size={14} />
                </button>
              </li>
            )
          })}
        </ul>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(ev) => { ev.preventDefault(); if (newLabel.trim()) { addMoment(newLabel.trim()); setNewLabel('') } }}
        >
          <label className="flex-1">
            <span className="sr-only">New moment name</span>
            <input value={newLabel} onChange={(ev) => setNewLabel(ev.target.value)} maxLength={40} placeholder="Add a moment, e.g. Bride's entry"
              className="h-10 w-full rounded-control border border-ink-700 bg-ink-950 px-3 text-sm placeholder:text-ink-500 focus:border-marigold focus:outline-none" />
          </label>
          <button type="submit" aria-label="Add moment" className="grid size-10 place-items-center rounded-control border border-ink-700 transition hover:bg-ink-800">
            <Plus size={16} />
          </button>
        </form>
      </div>

      <div className="border-t border-white/5 pt-4">
        <h2 className="font-semibold">Voice</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            aria-pressed={speech}
            onClick={() => { const on = !speech; setSpeech(on); mixer.duck('speech', on ? SPEECH_DB : null, on ? 1.5 : 2) }}
            className={`h-11 rounded-control border text-sm font-medium transition active:scale-98 ${speech ? 'border-marigold bg-marigold-dim text-marigold' : 'border-ink-700 hover:bg-ink-800'}`}
          >
            {speech ? 'Resume music' : 'Speech'}
          </button>
          <button
            onPointerDown={() => mixer.duck('talk', TALK_DB, 0.15)}
            onPointerUp={() => mixer.duck('talk', null, 0.8)}
            onPointerLeave={() => mixer.duck('talk', null, 0.8)}
            onKeyDown={(ev) => { if (ev.key === ' ' && !ev.repeat) mixer.duck('talk', TALK_DB, 0.15) }}
            onKeyUp={(ev) => { if (ev.key === ' ') mixer.duck('talk', null, 0.8) }}
            className="h-11 touch-none rounded-control border border-ink-700 text-sm font-medium transition select-none hover:bg-ink-800 active:border-marigold active:bg-marigold-dim active:text-marigold"
          >
            Hold to talk
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            role="switch"
            aria-checked={mic.running}
            onClick={toggleMic}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${mic.running ? 'bg-marigold' : 'bg-ink-700'}`}
          >
            <span className="sr-only">Auto-duck when the mic hears speech</span>
            <span className={`absolute top-1 left-1 size-5 rounded-full bg-ink-100 transition-transform ${mic.running ? 'translate-x-5' : ''}`} />
          </button>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              {mic.open ? <Microphone size={14} weight="fill" className="text-marigold" /> : <MicrophoneSlash size={14} className="text-ink-500" />}
              Auto-duck from mic
            </p>
            <p className="text-xs text-ink-500">Lowers the music by {TALK_DB} dB while the MC talks.</p>
          </div>
        </div>
        {micError && <p role="alert" className="mt-2 text-xs text-danger">{micError}</p>}

        {mic.running && (
          <div className="mt-3 flex flex-col gap-3">
            {inputs.length > 1 && (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink-400">Input</span>
                <select value={device} onChange={async (ev) => { setDevice(ev.target.value); await mic.start(ev.target.value || undefined) }}
                  className="h-10 rounded-control border border-ink-700 bg-ink-950 px-2 text-sm focus:border-marigold focus:outline-none">
                  <option value="">Default input</option>
                  {inputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Audio input'}</option>)}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="flex justify-between text-xs text-ink-400">
                <span>Trigger level</span>
                <span className="font-mono">{mic.config.thresholdDb} dB</span>
              </span>
              <span className="relative block h-2 overflow-hidden rounded bg-ink-800" aria-hidden>
                <span className={`block h-full origin-left transition-transform duration-75 ${mic.open ? 'bg-marigold' : 'bg-ink-400'}`} style={{ transform: `scaleX(${levelPct / 100})` }} />
                <span className="absolute inset-y-0 w-0.5 bg-ink-100" style={{ left: `${thresholdPct}%` }} />
              </span>
              <input type="range" className="fader" min={-70} max={-10} step={1} value={mic.config.thresholdDb}
                onChange={(ev) => mic.setThreshold(+ev.target.value)} />
            </label>
            <p className="text-xs text-ink-500">
              Feed the MC mic into this device through an audio interface. A phone's own mic also hears the speakers and will keep ducking; use Hold to talk instead.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
