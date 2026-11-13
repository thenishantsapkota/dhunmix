// Decodes files on the main thread (decodeAudioData is off-thread internally) and fans analysis out to workers.
import { SAMPLE_RATE, type Analysis } from './features'
import type { AnalyzeRequest, AnalyzeResponse } from './worker'

// Each worker holds a ~50 MB signal while busy, so keep the pool small on phones.
const SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1, /Android|Mobi/.test(navigator.userAgent) ? 2 : 4))

type Job = { id: string; file: File; resolve: (a: Analysis) => void; reject: (e: Error) => void }

const queue: Job[] = []
const idle: Worker[] = []
let created = 0
// OfflineAudioContext at 44.1 kHz resamples every file to the rate essentia expects.
const decoder = new OfflineAudioContext(1, 1, SAMPLE_RATE)

async function toMono(file: File): Promise<Float32Array> {
  const buf = await decoder.decodeAudioData(await file.arrayBuffer())
  const mono = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c)
    for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buf.numberOfChannels
  }
  return mono
}

function getWorker(): Worker | null {
  if (idle.length) return idle.pop()!
  if (created >= SIZE) return null
  created++
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
}

function pump() {
  while (queue.length) {
    const worker = getWorker()
    if (!worker) return
    const job = queue.shift()!
    run(worker, job)
  }
}

async function run(worker: Worker, job: Job) {
  try {
    const signal = await toMono(job.file)
    const res = await new Promise<AnalyzeResponse>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<AnalyzeResponse>) => resolve(e.data)
      worker.onerror = (e) => reject(new Error(e.message || 'Analysis worker crashed'))
      worker.postMessage({ id: job.id, signal } satisfies AnalyzeRequest, [signal.buffer])
    })
    if (res.analysis) job.resolve(res.analysis)
    else job.reject(new Error(res.error ?? 'Analysis failed'))
  } catch (err) {
    job.reject(err instanceof Error ? err : new Error(String(err)))
  } finally {
    idle.push(worker)
    pump()
  }
}

export function analyze(id: string, file: File): Promise<Analysis> {
  return new Promise((resolve, reject) => {
    queue.push({ id, file, resolve, reject })
    pump()
  })
}
