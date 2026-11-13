// Dhunmix YouTube helper. Runs on the DJ's laptop: pnpm helper [music folder]
// The app sends it one playlist link; it downloads every song's audio (yt-dlp + ffmpeg)
// into the music folder, 3 at a time, and streams progress back so each song is analysed as it lands.
//
// ⚠ Downloading from YouTube goes against YouTube's Terms of Service. The DJ runs this for
// themselves on their own machine; never host it as a service for others.
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { errorLine, folderName, idFromFileName, insideRoot, isVideoId, originAllowed, parseYouTubeUrl, retryable } from './lib.ts'

const PORT = Number(process.env.DHUNMIX_HELPER_PORT ?? 7731)
const ROOT = resolve(process.argv[2] ?? process.env.DHUNMIX_DIR ?? join(homedir(), 'Music', 'Dhunmix'))
const ORIGINS = (process.env.DHUNMIX_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const CONCURRENCY = 3
const RETRY_DELAYS_MS = [2000, 6000] // two retries for temporary YouTube refusals
const MAX_BODY = 4096

type ItemStatus = 'queued' | 'downloading' | 'done' | 'skipped' | 'failed'
type Item = { index: number; id: string; title: string; status: ItemStatus; file?: string; error?: string }
type Job = { id: string; title: string; folder: string; items: Item[]; finished: boolean; listeners: Set<ServerResponse> }

const jobs = new Map<string, Job>()
const servable = new Set<string>() // relative paths this helper downloaded or found; the only files it will serve

const run = (args: string[]) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    execFile('yt-dlp', args, { maxBuffer: 64 << 20 }, (err, stdout, stderr) =>
      done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr }))
  })

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

/** Songs already in the music folder, by video id: re-importing a playlist skips them. */
async function existing(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const f of await walk(ROOT)) {
    const id = idFromFileName(f)
    if (id) map.set(id, relative(ROOT, f))
  }
  return map
}

function send(job: Job, event: object) {
  const line = `data: ${JSON.stringify(event)}\n\n`
  for (const res of job.listeners) res.write(line)
}

const snapshot = (job: Job) => ({ type: 'job', id: job.id, title: job.title, finished: job.finished, items: job.items })

async function download(job: Job, item: Item) {
  item.status = 'downloading'
  send(job, { type: 'item', item })
  const args = [
    '-f', 'bestaudio[ext=m4a]/bestaudio', '-x', '--audio-format', 'm4a',
    '--no-playlist', '--quiet', '--no-warnings', '--no-progress',
    '--no-simulate', '--print', 'after_move:filepath',
    '-o', join(ROOT, job.folder, '%(title)s [%(id)s].%(ext)s'),
    `https://www.youtube.com/watch?v=${item.id}`,
  ]
  let result = await run(args)
  for (const delay of RETRY_DELAYS_MS) {
    if (result.code === 0 || !retryable(errorLine(result.stderr))) break
    await new Promise((r) => setTimeout(r, delay))
    result = await run(args)
  }
  const { code, stdout, stderr } = result
  const path = stdout.trim().split('\n').pop()
  if (code === 0 && path) {
    item.file = relative(ROOT, path)
    servable.add(item.file)
    item.status = 'done'
  } else {
    item.status = 'failed'
    item.error = errorLine(stderr)
  }
  send(job, { type: 'item', item })
}

async function runJob(job: Job, url: string, limit: number | undefined) {
  const listArgs = ['--flat-playlist', '-J', '--no-warnings', ...(limit ? ['--playlist-end', String(limit)] : []), url]
  const { code, stdout, stderr } = await run(listArgs)
  if (code !== 0) {
    send(job, { type: 'error', message: errorLine(stderr) })
    job.finished = true
    return send(job, snapshot(job))
  }
  const info = JSON.parse(stdout) as { id?: string; title?: string; entries?: { id?: string; title?: string }[] }
  const entries = info.entries ?? [{ id: info.id, title: info.title }]
  job.title = info.entries ? info.title ?? 'YouTube playlist' : 'YouTube singles'
  job.folder = folderName(job.title)
  await mkdir(join(ROOT, job.folder), { recursive: true })

  const have = await existing()
  job.items = entries
    .filter((e) => isVideoId(e.id))
    .map((e, i) => {
      const file = have.get(e.id!)
      if (file) servable.add(file)
      return { index: i + 1, id: e.id!, title: e.title ?? e.id!, status: file ? 'skipped' : 'queued', file } satisfies Item
    })
  send(job, snapshot(job))

  const queue = job.items.filter((i) => i.status === 'queued')
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) await download(job, item)
  }))
  job.finished = true
  send(job, snapshot(job))
}

function cors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin
  if (!originAllowed(origin, ORIGINS)) {
    res.writeHead(403).end('Origin not allowed')
    return false
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  return true
}

async function body(req: IncomingMessage): Promise<unknown> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > MAX_BODY) throw new Error('Body too large')
  }
  return JSON.parse(raw || '{}')
}

const json = (res: ServerResponse, status: number, data: unknown) =>
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data))

const server = createServer(async (req, res) => {
  if (!cors(req, res)) return
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'OPTIONS') {
    // Chrome's Private Network Access: a public site may only reach localhost if we opt in.
    return res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
    }).end()
  }

  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, folder: ROOT })

  if (req.method === 'POST' && url.pathname === '/jobs') {
    let input: { url?: unknown; limit?: unknown }
    try {
      input = (await body(req)) as typeof input
    } catch {
      return json(res, 400, { error: 'Invalid request' })
    }
    const source = typeof input.url === 'string' ? parseYouTubeUrl(input.url) : null
    if (!source) return json(res, 400, { error: 'That is not a YouTube video or playlist link.' })
    const limit = Number.isInteger(input.limit) && (input.limit as number) > 0 ? (input.limit as number) : undefined
    const job: Job = { id: randomUUID(), title: '', folder: '', items: [], finished: false, listeners: new Set() }
    jobs.set(job.id, job)
    runJob(job, source.url, limit).catch((err) => {
      send(job, { type: 'error', message: String(err?.message ?? err).slice(0, 160) })
      job.finished = true
      send(job, snapshot(job))
    })
    return json(res, 202, { id: job.id })
  }

  const events = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})\/events$/)
  if (req.method === 'GET' && events) {
    const job = jobs.get(events[1])
    if (!job) return json(res, 404, { error: 'No such import' })
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write(`data: ${JSON.stringify(snapshot(job))}\n\n`) // late joiners get the full picture first
    job.listeners.add(res)
    req.on('close', () => job.listeners.delete(res))
    return
  }

  if (req.method === 'GET' && url.pathname === '/files') {
    const rel = url.searchParams.get('path') ?? ''
    const full = servable.has(rel) ? insideRoot(ROOT, rel) : null
    if (!full) return json(res, 404, { error: 'Not found' })
    res.writeHead(200, { 'Content-Type': 'audio/mp4' })
    return createReadStream(full).on('error', () => res.destroy()).pipe(res)
  }

  json(res, 404, { error: 'Not found' })
})

const check = (cmd: string, args: string[]) => new Promise<boolean>((ok) => spawn(cmd, args).on('error', () => ok(false)).on('exit', (c) => ok(c === 0)))

const [hasYtdlp, hasFfmpeg] = await Promise.all([check('yt-dlp', ['--version']), check('ffmpeg', ['-version'])])
if (!hasYtdlp || !hasFfmpeg) {
  console.error(`Missing ${[!hasYtdlp && 'yt-dlp', !hasFfmpeg && 'ffmpeg'].filter(Boolean).join(' and ')}. On a Mac: brew install yt-dlp ffmpeg`)
  process.exit(1)
}
await mkdir(ROOT, { recursive: true })
// Loopback only: other devices on the venue Wi-Fi can't reach it.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dhunmix helper ready on http://127.0.0.1:${PORT}\nSaving music to ${ROOT}\nLeave this window open while importing.`)
})
