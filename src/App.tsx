import { SpeakerHigh } from '@phosphor-icons/react'
import { useCallback, useEffect, useReducer, useState } from 'react'
import { BeatLayer } from './audio/beats'
import { Mixer } from './audio/mixer'
import { Automix, useAutomix } from './automix/controller'
import { AutomixBar } from './components/AutomixBar'
import { DeckPanel } from './components/DeckPanel'
import { EventPanel } from './components/EventPanel'
import { MomentsPanel } from './components/MomentsPanel'
import { PRESETS } from './event/presets'
import { SONG_LENGTH_S, getEvent, loadEvent, startClock, targetEnergy } from './event/store'
import { Library } from './components/Library'
import { loadLibrary, type Track } from './library/store'

/** Follows automix's scheduled fades, and hands control to the DJ the moment they touch it. */
function Crossfader({ mixer, onTakeOver }: { mixer: Mixer; onTakeOver: () => void }) {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const id = setInterval(tick, 100)
    return () => clearInterval(id)
  }, [])
  const set = (v: number) => { onTakeOver(); mixer.setCrossfader(v); tick() }
  return (
    <div className="mx-auto flex w-full max-w-xl items-center gap-4 rounded-panel border border-white/5 bg-ink-900 px-5 py-3">
      <span className="font-mono text-sm font-semibold text-marigold">A</span>
      <label className="flex-1">
        <span className="sr-only">Crossfader</span>
        <input type="range" className="fader" min={0} max={1} step={0.005} value={mixer.crossfader}
          onChange={(e) => set(+e.target.value)} onDoubleClick={() => set(0.5)} />
      </label>
      <span className="font-mono text-sm font-semibold text-deck-b">B</span>
    </div>
  )
}

export default function App() {
  const [mixer] = useState(() => new Mixer())
  const [automix] = useState(() => {
    const a = new Automix(mixer)
    a.target = () => ({ energy: targetEnergy(), weights: PRESETS[getEvent().presetId].weights, maxPlay: SONG_LENGTH_S[getEvent().songLength], liveFx: getEvent().liveFx })
    return a
  })
  const am = useAutomix(automix)
  const [beats] = useState(() => {
    const layer = new BeatLayer(mixer.ctx, mixer.bus)
    layer.style = () => getEvent().beats
    automix.setSwitchHandler((at, beat) => layer.accent(at, beat))
    layer.guide = () => {
      if (automix.on) return automix.beatGuide()
      // Mixing by hand: follow whichever playing deck the crossfader favours.
      const deck = mixer.decks[mixer.crossfader <= 0.5 ? 0 : 1]
      return deck.playing ? { deck, mute: false, energy: targetEnergy() } : null
    }
    return layer
  })
  useEffect(() => {
    beats.start()
    return () => beats.stop()
  }, [beats])
  const [master, setMaster] = useState(0.9)
  const [loading, setLoading] = useState<[boolean, boolean]>([false, false])
  const [error, setError] = useState('')

  useEffect(() => { loadLibrary(); loadEvent() }, [])
  // The event clock starts with the music.
  useEffect(() => { if (am.on && !getEvent().startedAt) startClock() }, [am.on])
  const replan = useCallback(() => automix.replan(), [automix])
  // Dev-only handle for inspecting timing from the console; stripped from production builds.
  if (import.meta.env.DEV) Object.assign(window, { dhunmix: { mixer, automix } })

  const load = async (t: Track, i: 0 | 1) => {
    if (!t.file) return
    if (automix.on) {
      // Loading onto the idle deck while automix runs means "play this next".
      if (i !== automix.liveDeck) return automix.setNext(t)
      automix.takeOver()
    }
    setError('')
    setLoading((l) => (i === 0 ? [true, l[1]] : [l[0], true]))
    try {
      await mixer.decks[i].load(t.file, t.analysis ?? null, t.name, t.id)
    } catch {
      setError(`Couldn't play "${t.name}". The file may be damaged or in a format this browser can't decode.`)
    } finally {
      setLoading((l) => (i === 0 ? [false, l[1]] : [l[0], false]))
    }
  }

  const badge = (i: 0 | 1) => {
    if (!am.on) return undefined
    if (i === am.live) return 'On air' as const
    if (am.status === 'mixing') return 'Mixing in' as const
    return am.next && mixer.decks[i].trackId === am.next.id ? ('Up next' as const) : undefined
  }
  const takeOver = () => automix.takeOver()

  return (
    <div className="mx-auto flex min-h-dvh max-w-7xl flex-col gap-4 p-4 lg:p-6">
      <header className="flex h-10 items-center gap-4">
        <h1 className="text-lg font-semibold tracking-tight">dhun<span className="text-marigold">mix</span></h1>
        <label className="ml-auto flex w-40 items-center gap-2 text-ink-400" title="Master volume">
          <SpeakerHigh size={18} aria-hidden />
          <span className="sr-only">Master volume</span>
          <input type="range" className="fader" min={0} max={1} step={0.01} value={master}
            onChange={(e) => { setMaster(+e.target.value); mixer.setMaster(+e.target.value) }} />
        </label>
      </header>

      {error && <p role="alert" className="rounded-control border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <DeckPanel deck={mixer.decks[0]} letter="A" mixer={mixer} loading={loading[0]} badge={badge(0)} onTakeOver={takeOver} />
        <DeckPanel deck={mixer.decks[1]} letter="B" mixer={mixer} loading={loading[1]} badge={badge(1)} onTakeOver={takeOver} />
      </div>

      <Crossfader mixer={mixer} onTakeOver={takeOver} />

      <AutomixBar automix={automix} mixer={mixer} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><EventPanel onChange={replan} /></div>
        <MomentsPanel mixer={mixer} automix={automix} />
      </div>

      <Library onLoad={load} onQueue={(t) => automix.setNext(t)} automixOn={am.on} />
    </div>
  )
}
