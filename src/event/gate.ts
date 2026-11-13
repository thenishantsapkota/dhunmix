// Voice gate for mic ducking: duck as soon as the MC speaks, hold through short pauses between words.

export type GateConfig = { thresholdDb: number; holdS: number }
export type GateState = { open: boolean; lastAbove: number }

export const GATE_DEFAULT: GateConfig = { thresholdDb: -35, holdS: 0.8 }

export function gate(state: GateState, levelDb: number, now: number, cfg: GateConfig = GATE_DEFAULT): GateState {
  if (levelDb >= cfg.thresholdDb) return { open: true, lastAbove: now }
  if (state.open && now - state.lastAbove < cfg.holdS) return state
  return { open: false, lastAbove: state.lastAbove }
}

/** RMS level of a block of samples, in dBFS. */
export function rmsDb(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return 10 * Math.log10(sum / Math.max(1, samples.length) + 1e-12)
}
