import { describe, expect, it } from 'vitest'
import type { Analysis } from '../analysis/features'
import { bpmCloseness, camelotCompat, pickOpener, rankNext, tempoRatio } from './picker'
import { describeFx, momentPlan, planTransition, rollSteps, transitionFx, type Style } from './planner'

const track = (bpm: number, camelot: string, o: Partial<Analysis> = {}): Analysis => {
  const duration = o.duration ?? 240
  const beats = Array.from({ length: Math.floor((duration * bpm) / 60) }, (_, i) => Math.round(((i * 60) / bpm) * 1000) / 1000)
  return {
    v: 1, duration, bpm, beats, key: 'A', scale: camelot.endsWith('A') ? 'minor' : 'major', keyStrength: 0.9, camelot,
    loudnessDb: -12, gainDb: -2, onsetRate: 3, brightness: 0.05, energyRaw: 0.5,
    stability: Array(Math.ceil(beats.length / 128)).fill(1), introEnd: 16, outroStart: duration - 16, envelope: [], ...o,
  }
}

describe('camelotCompat', () => {
  it('scores the harmonic-mixing moves', () => {
    expect(camelotCompat('8A', '8A')).toBe(1)
    expect(camelotCompat('8A', '9A')).toBe(0.8)
    expect(camelotCompat('12A', '1A')).toBe(0.8) // wraps round the wheel
    expect(camelotCompat('8A', '8B')).toBe(0.8)
    expect(camelotCompat('8A', '10A')).toBe(0.5)
    expect(camelotCompat('8A', '3B')).toBe(0.1)
  })
})

describe('tempo', () => {
  it('counts half and double time as a match', () => {
    expect(tempoRatio(140, 70)).toBe(1)
    expect(tempoRatio(128, 126)).toBeCloseTo(0.984, 3)
    expect(bpmCloseness(128, 128)).toBe(1)
    expect(bpmCloseness(128, 100)).toBeLessThan(0.3)
  })
})

describe('rankNext', () => {
  const cur = track(128, '8A')
  const pool = [
    { id: 'clash', analysis: track(128, '3B'), energy: 0.5 },
    { id: 'perfect', analysis: track(127, '9A'), energy: 0.55 },
    { id: 'slow', analysis: track(92, '8A'), energy: 0.5 },
    { id: 'played', analysis: track(128, '8A'), energy: 0.5 },
  ]
  it('prefers matching key, tempo and energy, and never repeats', () => {
    const ranked = rankNext(cur, pool, new Set(['played']), 0.5).map((c) => c.id)
    expect(ranked[0]).toBe('perfect')
    expect(ranked).not.toContain('played')
  })
  it('prefers a smooth tempo-matched mix over a matching key that would force a cut', () => {
    // Real case: Radha (137.4, 7B) -> Badri (128.0, 7A, relative key, 7 % apart = cut) vs High Heels (136.1, 2A, 1 % apart).
    const radha = track(137.4, '7B')
    const ranked = rankNext(radha, [
      { id: 'badri', analysis: track(128.0, '7A'), energy: 0.6 },
      { id: 'highHeels', analysis: track(136.1, '2A'), energy: 0.6 },
    ], new Set(), 0.6, { key: 0.3, bpm: 0.35, energy: 0.35 })
    expect(ranked[0].id).toBe('highHeels')
  })
  it('weighs key less when key detection is unsure', () => {
    const unsure = { ...pool[0], analysis: { ...pool[0].analysis, keyStrength: 0.4 } }
    const sure = rankNext(cur, [pool[0], pool[2]], new Set(), 0.5)[0].id
    const lenient = rankNext(cur, [unsure, pool[2]], new Set(), 0.5)[0].id
    expect(sure).toBe('clash') // same tempo still wins over a 28 % tempo gap
    expect(lenient).toBe('clash')
  })
  it('opens the set near warm-up energy', () => {
    expect(pickOpener([{ ...pool[0], energy: 0.9 }, { ...pool[1], energy: 0.35 }])?.id).toBe('perfect')
  })
})

describe('planTransition', () => {
  it('long-blends steady tracks with compatible keys, on a phrase, beat-matched', () => {
    const a = track(128, '8A')
    const b = track(126, '9A')
    const p = planTransition(a, 1, b)
    expect(p.style).toBe('blend')
    expect(p.beats).toBe(64)
    expect(p.rateB).toBeCloseTo(128 / 126, 3)
    expect(a.beats).toContain(p.aStart)
    expect(b.beats).toContain(p.bOffset)
    const iStart = a.beats.indexOf(p.aStart)
    const iIntro = a.beats.reduce((best, t, i) => (Math.abs(t - a.introEnd) < Math.abs(a.beats[best] - a.introEnd) ? i : best), 0)
    expect((iStart - iIntro) % 16).toBe(0)
    expect(p.aStart + p.duration).toBeLessThanOrEqual(a.outroStart + 0.5)
  })
  it('uses a filter blend when keys clash', () => {
    expect(planTransition(track(128, '8A'), 1, track(128, '3B')).style).toBe('filter')
  })
  it('falls back to a quick fade when the tempo drifts (live / film songs)', () => {
    const p = planTransition(track(128, '8A'), 1, track(127, '8A', { stability: [0, 0.2, 0.3] }))
    expect(p.style).toBe('fade')
    expect(p.rateB).toBeCloseTo(1 / tempoRatio(128, 127), 3) // within 2 %: still beat-matched for the short overlap
  })
  it('brings B in from its intro so it builds, with its main part landing mid-fade', () => {
    const b = track(127, '8A', { stability: [0, 0.2, 0.3], introEnd: 30 })
    const p = planTransition(track(128, '8A'), 1, b)
    expect(p.style).toBe('fade')
    expect(p.beats).toBe(32)
    const body = b.beats.reduce((best, t) => (Math.abs(t - 30) < Math.abs(best - 30) ? t : best)) // main part starts on a beat
    expect(body - p.bOffset).toBeCloseTo(16 * (60 / 127), 2) // 16 of B's beats before it
  })
  it('never overlaps unmatched beats: 7 % apart cuts instead of fading', () => {
    expect(planTransition(track(126, '8A'), 1, track(136, '8A', { stability: [0, 0.2, 0.3] })).style).toBe('cut')
  })
  it('beat-matches quick fades too', () => {
    const p = planTransition(track(128, '8A'), 1, track(124, '8A', { stability: [0, 0.2, 0.3] }))
    expect(p.style).toBe('fade')
    expect(p.rateB).toBeCloseTo(128 / 124, 3)
  })
  it('cuts on the beat when tempos are far apart, B landing as A leaves', () => {
    const p = planTransition(track(128, '8A'), 1, track(96, '8A'))
    expect(p.style).toBe('cut')
    expect(p.rateB).toBe(1)
    expect(p.bDelay).toBeCloseTo(8 * (60 / 128))
  })
  it('accounts for the tempo fader on A', () => {
    expect(planTransition(track(125, '8A'), 128 / 125, track(128, '8A')).rateB).toBe(1)
  })
  it('mixes now from the next beat when skipping', () => {
    const p = planTransition(track(128, '8A'), 1, track(128, '8A'), 60.1)
    expect(p.aStart).toBeGreaterThanOrEqual(60.1)
    expect(p.aStart - 60.1).toBeLessThan(60 / 128)
  })
})

describe('transition fx', () => {
  const beat = 0.5
  const styles: [Style, number][] = [['swap', 4], ['blend', 64], ['filter', 32], ['fade', 32], ['cut', 8]]

  it('never automates the same knob twice, and every move fits inside the transition', () => {
    for (const [style, beats] of styles) {
      for (const rising of [true, false]) {
        const { fx, xfade } = transitionFx(style, beat, beats, rising)
        const keys = fx.map((f) => `${f.deck}.${f.param}`)
        expect(new Set(keys).size).toBe(keys.length)
        const length = (beats + (style === 'cut' ? 8 : 0)) * beat // a cut lasts until B has opened up
        for (const f of [...fx, xfade]) expect(f.at + f.dur).toBeLessThanOrEqual(length + 1e-9)
      }
    }
  })
  it('crosses the basslines over two bars around the middle, never a sudden hole', () => {
    const { fx } = transitionFx('blend', beat, 64, false)
    const swap = fx.filter((f) => f.param === 'low')
    expect(swap.map((f) => f.at)).toEqual([14, 14]) // half (16 s) minus 4 beats
    expect(swap.every((f) => f.dur === 8 * beat)).toBe(true)
    expect(swap.find((f) => f.deck === 'b')).toMatchObject({ from: -40, to: 0 })
    expect(swap.find((f) => f.deck === 'a')).toMatchObject({ from: 0, to: -40 })
  })
  it('lifts the old song out when energy rises, settles it down when energy falls', () => {
    const up = transitionFx('fade', beat, 32, true).fx.find((f) => f.deck === 'a' && f.param === 'filter')!
    const down = transitionFx('fade', beat, 32, false).fx.find((f) => f.deck === 'a' && f.param === 'filter')!
    expect(up.to).toBeGreaterThan(0) // high-pass
    expect(down.to).toBeLessThan(0) // low-pass
  })
  it('cuts with an echo-out, and B opens up through a filter instead of slamming in', () => {
    const p = planTransition(track(128, '8A'), 1, track(96, '8A'))
    expect(p.fx.some((f) => f.deck === 'a' && f.param === 'echo')).toBe(true)
    expect(p.xfade.at + p.xfade.dur).toBeCloseTo(p.bDelay) // A is gone exactly when B lands
    const opening = p.fx.find((f) => f.deck === 'b' && f.param === 'filter')!
    expect(opening).toMatchObject({ from: -0.7, to: 0 })
    expect(opening.at).toBeCloseTo(p.bDelay)
    expect(p.echoTime).toBeCloseTo(0.75 * (60 / 128))
  })
  it('describes the moves in plain words', () => {
    expect(describeFx(transitionFx('blend', beat, 64, true).fx)).toBe('Bass swap · Vocal dip · Highs roll off · Filter opens')
    expect(describeFx(transitionFx('cut', beat, 8, false).fx)).toBe('High-pass lift · Beat roll · Echo out · Filter opens · Bass swap')
  })
  it('rolls faster and faster: each halving of the slice gets half the remaining time', () => {
    expect(rollSteps(0.5, 0.125, 10, 2)).toEqual([[10, 0.5], [11, 0.25], [11.5, 0.125], [12, 0]])
  })
  it('lets a moment sink away through a low-pass', () => {
    expect(momentPlan(30).fx).toEqual([{ deck: 'a', param: 'filter', from: 0, to: -0.85, at: 0, dur: 6 }])
  })
})

describe('pace: songs leave after their hook, like a real DJ', () => {
  const beatLen = 60 / 128
  it('mixes out around the chosen length instead of at the outro', () => {
    const a = track(128, '8A', { duration: 240, introEnd: 15 })
    const p = planTransition(a, 1, track(127, '9A'), undefined, { playedFrom: 15, maxPlay: 90 })
    const end = p.aStart + p.duration
    expect(end).toBeGreaterThan(15 + 90 - 32 * beatLen)
    expect(end).toBeLessThan(15 + 90 + 32 * beatLen)
  })
  it('picks the phrase where the energy drops (end of a chorus)', () => {
    // Loud chorus until 100 s, quieter verse after: the mix should end right at 100 s.
    const envelope = Array.from({ length: 400 }, (_, i) => ((i / 400) * 240 < 100 ? 1 : 0.4))
    const a = track(128, '8A', { duration: 240, introEnd: 0, envelope })
    const p = planTransition(a, 1, track(127, '9A'), undefined, { playedFrom: 0, maxPlay: 90 })
    expect(Math.abs(p.aStart + p.duration - 100)).toBeLessThan(4 * beatLen * 2)
  })
  it('never leaves a song in its first 20 seconds', () => {
    const p = planTransition(track(128, '8A', { duration: 240 }), 1, track(127, '9A'), undefined, { playedFrom: 10, maxPlay: 10 })
    expect(p.aStart + p.duration).toBeGreaterThanOrEqual(10 + 20 - 1e-6)
  })
  it('keeps 30-second plays to about 30 seconds (within a phrase)', () => {
    const p = planTransition(track(128, '8A', { duration: 240, introEnd: 12 }), 1, track(127, '9A'), undefined, { playedFrom: 12, maxPlay: 30 })
    const played = p.aStart + p.duration - 12
    expect(Math.abs(played - 30)).toBeLessThanOrEqual(16 * beatLen + 1e-6)
  })
  it('swaps in quick sets: B leads in for one bar without bass, then its bass drops on the phrase downbeat', () => {
    const pace = { playedFrom: 0, maxPlay: 45 }
    const a = track(128, '8A', { duration: 240, introEnd: 0 })
    const b = track(127, '9A', { stability: [0, 0.2, 0.3], introEnd: 20 })
    const p = planTransition(a, 1, b, undefined, pace)
    expect(p.style).toBe('swap')
    expect(p.beats).toBe(4) // one bar
    const one = p.aStart + p.duration
    expect(a.beats.indexOf(Math.round(one * 1000) / 1000) % 16).toBe(0) // the one is a phrase downbeat
    expect(p.bDelay).toBe(0) // B enters at the start of the lead-in bar…
    const groove = b.beats.reduce((best, t) => (Math.abs(t - 20) < Math.abs(best - 20) ? t : best))
    expect(groove - p.bOffset).toBeCloseTo(4 * (60 / 127), 2) // …one of its bars before its groove, so the groove lands on the one
    expect(p.xfade).toEqual({ at: 0, dur: p.duration }) // crossfade across the bar, A gone by the one
    const bass = p.fx.filter((f) => f.param === 'low')
    expect(bass.every((f) => Math.abs(f.at + f.dur - p.duration) < 0.01)).toBe(true) // bass swap exactly on the one
    expect(p.rateB).toBeCloseTo(128 / 127, 3) // beat-matched: the groove never breaks
    expect(b.beats).toContain(p.bOffset)
    const clash = planTransition(a, 1, track(127, '3B', { stability: [0, 0.2, 0.3] }), undefined, pace)
    expect(clash.fx.some((f) => f.deck === 'a' && f.param === 'filter')).toBe(true) // clashing keys get filtered apart
    const cut = planTransition(a, 1, track(96, '9A'), undefined, pace)
    expect(cut.style).toBe('cut')
    expect(cut.duration).toBeCloseTo(4 * (60 / 128)) // 1-bar riser, B lands at full
    const end = p.aStart + p.duration
    expect(end).toBeGreaterThan(30)
    expect(end).toBeLessThan(45 + 32 * beatLen)
  })
  it('plays to the outro when the DJ picks full songs', () => {
    const a = track(128, '8A')
    expect(planTransition(a, 1, track(127, '9A'), undefined, { playedFrom: 0, maxPlay: Infinity })).toEqual(planTransition(a, 1, track(127, '9A')))
  })
})
