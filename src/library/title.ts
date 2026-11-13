// YouTube-style file names ("07 Radha - SOTY ｜ Alia Bhatt ｜ Shreya Ghoshal") → a readable title and a subtitle.

const NOISE = /\b(full (video|song|audio)( song)?|official (music )?video|video song|lyric(al)? video|lyrics?|audio|hd|4k|t-series)\b/gi

export function cleanTitle(fileName: string): { title: string; sub: string } {
  const base = fileName
    .replace(/\.[^.\s]{2,5}$/, '') // extension
    .replace(/^\d{1,3}[\s._-]+/, '') // playlist index
    .replace(/\s*\[[A-Za-z0-9_-]{11}\]$/, '') // "[videoId]" the YouTube helper adds to keep files unique
    .replace(/_/g, ' ')
  const parts = base.split(/\s*[|｜]\s*/).map((p) => p.replace(NOISE, '').replace(/[\s:：-]+$/g, '').replace(/^[\s:：-]+/g, '').replace(/\s{2,}/g, ' ').trim()).filter(Boolean)
  const [head = base, ...rest] = parts
  // "Song - Film" → title "Song", film moves to the subtitle.
  const [title, ...more] = head.split(/\s+-\s+/)
  return { title: title || head, sub: [...more, ...rest].join(' · ') }
}
