// Analysis worker: receives a mono 44.1 kHz signal, returns an Analysis. One track at a time.
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js'
import Essentia from 'essentia.js/dist/essentia.js-core.es.js'
import {
  SAMPLE_RATE, TARGET_LOUDNESS_DB, camelot, energyRaw, envelope, foldBpm, introOutro, loudnessDb, tempoStability, zeroCrossingRate,
  type Analysis,
} from './features'

const ready = new Promise<Essentia>((resolve) => {
  const init = () => resolve(new Essentia(EssentiaWASM))
  if (EssentiaWASM.calledRun) init()
  else EssentiaWASM.onRuntimeInitialized = init
})

export type AnalyzeRequest = { id: string; signal: Float32Array }
export type AnalyzeResponse = { id: string; analysis?: Analysis; error?: string }

// The app's TS lib is DOM, not WebWorker; type just the two worker globals used here.
const ctx = self as unknown as { postMessage(m: AnalyzeResponse): void; onmessage: ((e: MessageEvent<AnalyzeRequest>) => void) | null }

ctx.onmessage = async (e) => {
  const { id, signal } = e.data
  try {
    const es = await ready
    const vec = es.arrayToVector(signal)
    try {
      // shortcut: 'degara' is ~5x faster than 'multifeature' with equal results on steady beats; switch if the test set shows misses.
      const rhythm = es.RhythmExtractor2013(vec, 208, 'degara', 40)
      const beats = Array.from(es.vectorToArray(rhythm.ticks), (t) => Math.round(t * 1000) / 1000)
      rhythm.ticks.delete()
      const key = es.KeyExtractor(vec)
      const onsets = es.OnsetRate(vec)
      onsets.onsets.delete()

      const loud = loudnessDb(signal)
      const zcr = zeroCrossingRate(signal)
      const scale = key.scale === 'major' ? 'major' : 'minor'
      const analysis: Analysis = {
        v: 1,
        duration: signal.length / SAMPLE_RATE,
        bpm: Math.round(foldBpm(rhythm.bpm) * 100) / 100,
        beats,
        key: key.key,
        scale,
        keyStrength: Math.round(key.strength * 100) / 100,
        camelot: camelot(key.key, scale),
        loudnessDb: Math.round(loud * 10) / 10,
        gainDb: Math.round(Math.max(-12, Math.min(6, TARGET_LOUDNESS_DB - loud)) * 10) / 10,
        onsetRate: Math.round(onsets.onsetRate * 100) / 100,
        brightness: Math.round(zcr * 1000) / 1000,
        energyRaw: energyRaw(loud, onsets.onsetRate, zcr),
        stability: tempoStability(beats),
        ...introOutro(signal, SAMPLE_RATE, beats),
        envelope: envelope(signal),
      }
      ctx.postMessage({ id, analysis })
    } finally {
      vec.delete() // wasm memory is not garbage collected
    }
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
