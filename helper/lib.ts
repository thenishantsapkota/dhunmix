// Pure helpers for the YouTube helper server. Everything here guards a trust boundary:
// the URL the DJ pastes, the browser origin calling us, and file paths we serve.
import { isAbsolute, relative, resolve, sep } from 'node:path'

const HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'])
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const LIST_ID = /^[A-Za-z0-9_-]{10,64}$/

export type Source = { url: string; kind: 'playlist' | 'video' }

/** Accept only YouTube links, and rebuild a canonical URL from the ids so nothing else reaches yt-dlp. */
export function parseYouTubeUrl(raw: string): Source | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) return null
  const list = u.searchParams.get('list')
  // "Mix" lists (RD…) are endless radio, not a playlist the DJ curated.
  if (list && LIST_ID.test(list) && !list.startsWith('RD')) return { url: `https://www.youtube.com/playlist?list=${list}`, kind: 'playlist' }
  const v = u.hostname === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v')
  if (v && VIDEO_ID.test(v)) return { url: `https://www.youtube.com/watch?v=${v}`, kind: 'video' }
  return null
}

export const isVideoId = (id: unknown): id is string => typeof id === 'string' && VIDEO_ID.test(id)

/**
 * Browsers always send Origin on cross-site requests, so this stops any other website the DJ
 * has open from driving downloads. Local dev servers (any localhost port) plus configured origins.
 */
export function originAllowed(origin: string | undefined, extra: string[]): boolean {
  if (!origin) return true // not a browser (curl, scripts on this machine)
  if (extra.includes(origin)) return true
  try {
    const u = new URL(origin)
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

/** A playlist title as a folder name: no path separators or characters filesystems reject. */
export function folderName(title: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what filesystems reject
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80)
  return clean || 'YouTube'
}

/** Resolve a client-supplied relative path inside `root`, or null if it escapes it. */
export function insideRoot(root: string, rel: string): string | null {
  if (!rel || isAbsolute(rel)) return null
  const full = resolve(root, rel)
  const r = relative(root, full)
  return r && !r.startsWith('..') && !isAbsolute(r) && !r.split(sep).includes('..') ? full : null
}

/** The video id yt-dlp put in a file name via the "[%(id)s]" output template. */
export function idFromFileName(name: string): string | null {
  const m = name.match(/\[([A-Za-z0-9_-]{11})\]\.[a-z0-9]+$/i)
  return m ? m[1] : null
}

/** YouTube sometimes refuses a burst of parallel downloads; these errors usually pass on a retry. */
export function retryable(error: string): boolean {
  return /HTTP Error (403|429|5\d\d)|timed out|Connection reset|Read timed out|IncompleteRead/i.test(error)
}

/** yt-dlp's last ERROR line, shortened for the UI. */
export function errorLine(stderr: string): string {
  const line = stderr.split('\n').reverse().find((l) => l.startsWith('ERROR:')) ?? stderr.trim().split('\n').pop() ?? ''
  const msg = line.replace(/^ERROR:\s*(\[[^\]]+\]\s*[A-Za-z0-9_-]+:\s*)?/, '').trim()
  return (msg || 'Download failed').slice(0, 160)
}
