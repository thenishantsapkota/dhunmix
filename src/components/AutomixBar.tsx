import { FastForward, Shuffle } from '@phosphor-icons/react'
import type { Automix } from '../automix/controller'
import { useAutomix } from '../automix/controller'
import { STYLE_LABEL, describeFx } from '../automix/planner'
import { tempoRatio } from '../automix/picker'
import type { Mixer } from '../audio/mixer'
import { cleanTitle } from '../library/title'

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function AutomixBar({ automix, mixer }: { automix: Automix; mixer: Mixer }) {
  const s = useAutomix(automix)
  const live = mixer.decks[s.live].analysis
  const next = s.next
  const n = next ? cleanTitle(next.name) : null
  const stretch = live && next?.analysis ? (1 / tempoRatio(live.bpm * mixer.decks[s.live].rate, next.analysis.bpm) - 1) * 100 : 0

  return (
    <section aria-label="Automix" className="flex flex-col gap-4 rounded-panel border border-white/5 bg-ink-900 p-4 sm:p-5 md:flex-row md:items-center">
      <div className="flex items-center gap-3 md:w-56 md:shrink-0">
        <button
          role="switch"
          aria-checked={s.on}
          onClick={() => (s.on ? automix.stop() : automix.start())}
          className={`relative h-8 w-14 shrink-0 rounded-full transition ${s.on ? 'bg-marigold' : 'bg-ink-700'}`}
        >
          <span className="sr-only">Automix</span>
          <span className={`absolute top-1 left-1 size-6 rounded-full bg-ink-100 shadow-key transition-transform ${s.on ? 'translate-x-6' : ''}`} />
        </button>
        <div className="min-w-0">
          <p className="font-semibold">Automix</p>
          <p className="line-clamp-2 text-xs text-ink-400" role="status">
            {s.message || (s.on
              ? s.status === 'mixing' ? 'Mixing now'
                : s.move && mixer.ctx.currentTime < s.move.until + 0.5 ? <span className="text-marigold">Live: {s.move.label}</span>
                : s.status === 'ending' ? 'Last song' : 'Picking and mixing for you'
              : 'Off. You are mixing by hand')}
          </p>
        </div>
      </div>

      <div className="min-w-0 flex-1 border-white/5 md:border-l md:pl-5">
        {s.on && next && n ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="min-w-0 flex-1">
              <p className="text-2xs font-semibold tracking-wider text-ink-500">UP NEXT</p>
              <p className="truncate font-medium">{n.title}</p>
              <p className="truncate text-xs text-ink-400">
                <span className="font-mono">{live?.camelot} → {next.analysis?.camelot}</span>
                <span className="mx-2 text-ink-700">|</span>
                <span className="font-mono">{next.analysis?.bpm.toFixed(1)} BPM</span>
                {s.plan && s.plan.rateB !== 1 && <span className="font-mono text-ink-500"> ({stretch > 0 ? '+' : ''}{stretch.toFixed(1)}%)</span>}
              </p>
            </div>
            {s.plan && (
              <div className="text-right" title={s.plan.reason}>
                <p className="text-sm font-medium">{STYLE_LABEL[s.plan.style]}</p>
                {s.plan.fx.length > 0 && <p className="text-xs text-ink-400">{describeFx(s.plan.fx)}</p>}
                <p className="font-mono text-xs text-ink-400 tabular-nums">
                  {s.status === 'mixing' ? 'now' : s.secondsToMix !== null ? `in ${fmt(s.secondsToMix)}` : ''}
                </p>
              </div>
            )}
            <button
              onClick={() => automix.mixNow()}
              disabled={s.status === 'mixing'}
              className="inline-flex h-10 items-center gap-2 rounded-control border border-ink-700 px-3 text-sm transition hover:bg-ink-800 active:scale-98 disabled:opacity-30"
            >
              <FastForward size={16} weight="fill" /> Mix now
            </button>
          </div>
        ) : (
          <p className="text-sm text-ink-500">
            {s.on ? 'Choosing the next track…' : 'Turn on Automix and it picks the next song by key, tempo and energy, then mixes it in on the beat. Touch the crossfader or a play button to take over.'}
          </p>
        )}

        {s.on && s.alternatives.length > 0 && s.status !== 'mixing' && (
          <div className="mt-3 flex items-center gap-2 overflow-x-auto">
            <Shuffle size={14} className="shrink-0 text-ink-500" aria-hidden />
            <span className="shrink-0 text-xs text-ink-500">Or play</span>
            {s.alternatives.map((t) => (
              <button
                key={t.id}
                onClick={() => automix.setNext(t)}
                className="h-8 max-w-48 shrink-0 truncate rounded-full border border-ink-700 px-3 text-xs text-ink-200 transition hover:border-marigold hover:text-marigold"
                title={`${cleanTitle(t.name).title} · ${t.analysis?.bpm.toFixed(0)} BPM · ${t.analysis?.camelot}`}
              >
                {cleanTitle(t.name).title}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
