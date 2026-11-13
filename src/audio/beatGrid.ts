// Beat layer timing and patterns. Pure: which drum hits fall where on a song's own beat grid.

export type BeatStyle = 'off' | 'dhol' | 'house' | 'hats'
export type Voice = 'kick' | 'clap' | 'hat' | 'openHat' | 'dagga' | 'tilli'

/** Steps 0-15 of one 4/4 bar (sixteenth notes) where each voice hits, with a velocity 0-1. */
export type Pattern = Partial<Record<Voice, [number, number][]>>

const every = (steps: number[], v: number): [number, number][] => steps.map((s) => [s, v])

export const PATTERNS: Record<Exclude<BeatStyle, 'off'>, Pattern> = {
  // Bhangra chaal: the dhol's bass side (dagga) on the swung "DHA ... DHA", the stick side (tilli) filling between.
  dhol: {
    dagga: [[0, 1], [6, 0.8], [8, 0.9], [14, 0.7]],
    tilli: [[2, 0.6], [3, 0.4], [4, 0.7], [10, 0.6], [11, 0.4], [12, 0.7], [15, 0.4]],
  },
  house: {
    kick: every([0, 4, 8, 12], 1),
    clap: every([4, 12], 0.8),
    openHat: every([2, 6, 10, 14], 0.5),
    hat: every([1, 3, 5, 7, 9, 11, 13, 15], 0.25),
  },
  hats: {
    hat: [[0, 0.35], [2, 0.25], [4, 0.35], [6, 0.25], [8, 0.35], [10, 0.25], [12, 0.35], [14, 0.25]],
    openHat: every([6, 14], 0.3),
  },
}

export type Hit = { voice: Voice; t: number; velocity: number }

/**
 * Hits between track times t0 (exclusive) and t1 (inclusive) on a song's beat grid. Sixteenths are
 * interpolated between detected beats, so the groove follows the song even where its tempo drifts.
 * `barStart` is a beat index on a downbeat (the end of the intro), so step 0 lands on the "1".
 */
export function hitsBetween(beats: number[], barStart: number, pattern: Pattern, t0: number, t1: number): Hit[] {
  const hits: Hit[] = []
  for (let i = 0; i < beats.length - 1; i++) {
    const b = beats[i]
    const next = beats[i + 1]
    if (next <= t0) continue
    if (b > t1) break
    const beatInBar = (((i - barStart) % 4) + 4) % 4
    for (let k = 0; k < 4; k++) {
      const t = b + ((next - b) * k) / 4
      if (t <= t0 || t > t1) continue
      const step = beatInBar * 4 + k
      for (const [voice, steps] of Object.entries(pattern) as [Voice, [number, number][]][]) {
        for (const [s, velocity] of steps) if (s === step) hits.push({ voice, t, velocity })
      }
    }
  }
  return hits
}

/** Quiet stretches of the event (dinner) get percussion only, whatever style is chosen. */
export function styleFor(style: BeatStyle, energy: number): BeatStyle {
  return style !== 'off' && energy < 0.35 ? 'hats' : style
}
