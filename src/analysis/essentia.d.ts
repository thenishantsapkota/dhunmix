// essentia.js ships no types for its ES builds. Only what the worker uses is declared.
declare module 'essentia.js/dist/essentia-wasm.es.js' {
  export const EssentiaWASM: { calledRun?: boolean; onRuntimeInitialized?: () => void }
}

declare module 'essentia.js/dist/essentia.js-core.es.js' {
  type Vector = { delete(): void }
  export default class Essentia {
    constructor(wasm: unknown)
    arrayToVector(a: Float32Array): Vector
    vectorToArray(v: Vector): Float32Array
    RhythmExtractor2013(signal: Vector, maxTempo?: number, method?: string, minTempo?: number): { bpm: number; ticks: Vector }
    KeyExtractor(signal: Vector): { key: string; scale: string; strength: number }
    OnsetRate(signal: Vector): { onsetRate: number; onsets: Vector }
  }
}
