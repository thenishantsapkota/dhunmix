import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'

const flush = () => new Promise((r) => setTimeout(r, 20)) // let the async IndexedDB write land

describe('event store', () => {
  it('survives a reload mid-event: preset, curve, clock and moment songs', async () => {
    const a = await import('./store')
    a.choosePreset('club')
    a.setCurvePoint(2, 0.34)
    a.startClock()
    a.assignMoment('first-dance', 'abc123')
    a.addMoment("Bride's entry")
    await flush()

    vi.resetModules() // simulate a page reload: fresh module state, same IndexedDB
    const b = await import('./store')
    expect(b.getEvent().presetId).toBe('wedding') // defaults before loading
    await b.loadEvent()
    const e = b.getEvent()
    expect(e.presetId).toBe('club')
    expect(e.curve[2]).toBe(0.34)
    expect(e.startedAt).toBeGreaterThan(0)
    expect(e.moments.find((m) => m.id === 'first-dance')?.trackId).toBe('abc123')
    expect(e.moments.some((m) => m.label === "Bride's entry")).toBe(true)
  })

  it('aims for the curve at the elapsed share of the event', async () => {
    const { targetEnergy } = await import('./store')
    const e = { presetId: 'house' as const, songLength: 'short' as const, liveFx: 'lively' as const, beats: 'dhol' as const, hours: 4, curve: [0, 1], startedAt: 0, moments: [] }
    expect(targetEnergy(e, 2 * 3600_000)).toBeCloseTo(0.5)
    expect(targetEnergy({ ...e, startedAt: null }, 99)).toBe(0) // clock not started: start of the curve
  })
})
