// Batch analysis in Node for tuning: node --experimental-strip-types scripts/analyze.ts <folder> [expected.csv]
// expected.csv (optional): "file name,bpm" per line; prints accuracy with half/double tempo allowed.
// Needs ffmpeg on PATH to decode.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { camelot, foldBpm, tempoStability } from '../src/analysis/features.ts'

const require = createRequire(import.meta.url)
const { EssentiaWASM, Essentia } = require('essentia.js')
const es = new Essentia(EssentiaWASM)

const [dir, expectedFile] = process.argv.slice(2)
if (!dir) throw new Error('usage: analyze.ts <folder> [expected.csv]')
const expected = new Map<string, number>(
  expectedFile ? readFileSync(expectedFile, 'utf8').trim().split('\n').map((l) => { const i = l.lastIndexOf(','); return [l.slice(0, i), +l.slice(i + 1)] as [string, number] }) : [],
)

const decode = (file: string) => {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
}

let hits = 0
let judged = 0
for (const name of readdirSync(dir).filter((f) => /\.(m4a|mp3|wav|flac)$/i.test(f)).sort()) {
  const sig = decode(join(dir, name))
  const vec = es.arrayToVector(sig)
  let t = Date.now()
  const d = es.RhythmExtractor2013(vec, 208, 'degara', 40)
  const degaraMs = Date.now() - t
  t = Date.now()
  const m = es.RhythmExtractor2013(vec, 208, 'multifeature', 40)
  const multiMs = Date.now() - t
  const k = es.KeyExtractor(vec)
  const beats = Array.from(es.vectorToArray(d.ticks) as Float32Array)
  const stab = tempoStability(beats)
  const bpm = foldBpm(d.bpm)
  const exp = expected.get(name)
  let verdict = ''
  if (exp) {
    judged++
    const ok = [1, 2, 0.5].some((f) => Math.abs(bpm * f - exp) / exp < 0.04)
    if (ok) hits++
    verdict = ok ? ' ok' : ` MISS (expected ${exp})`
  }
  console.log(
    `${name.slice(0, 34).padEnd(34)} degara ${bpm.toFixed(1).padStart(5)} (${degaraMs}ms)  multi ${foldBpm(m.bpm).toFixed(1).padStart(5)} conf ${m.confidence.toFixed(1)} (${multiMs}ms)  ` +
    `key ${camelot(k.key, k.scale).padStart(3)} ${k.key}${k.scale === 'minor' ? 'm' : ''} str ${k.strength.toFixed(2)}  steady ${stab.map((s: number) => s.toFixed(1)).join(' ')}  ${(sig.length / 44100).toFixed(0)}s${verdict}`,
  )
  vec.delete()
}
if (judged) console.log(`\nBPM accuracy: ${hits}/${judged} (${Math.round((hits / judged) * 100)}%)`)
