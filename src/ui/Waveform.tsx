import { useEffect, useRef } from 'react'

type Props = {
  envelope: number[]
  duration: number
  getPosition: () => number
  onSeek: (seconds: number) => void
  color: string
  markers?: number[] // seconds, e.g. intro end / outro start
}

/** Overview waveform. Draws on its own animation frame so playback never re-renders React. */
export function Waveform({ envelope, duration, getPosition, onSeek, color, markers = [] }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const g = el.getContext('2d')!
    // Canvas can't read CSS variables, so resolve "var(--x)" once.
    const played = color.startsWith('var(') ? getComputedStyle(el).getPropertyValue(color.slice(4, -1)).trim() : color
    let frame = 0
    let last = -1
    let width = 0

    const draw = () => {
      const pos = duration ? getPosition() / duration : 0
      const w = el.clientWidth
      if (pos !== last || w !== width) {
        last = pos
        width = w
        const dpr = window.devicePixelRatio || 1
        el.width = w * dpr
        el.height = el.clientHeight * dpr
        g.scale(dpr, dpr)
        const h = el.clientHeight
        g.clearRect(0, 0, w, h)
        const bars = Math.min(envelope.length, Math.floor(w / 3))
        const step = envelope.length / bars
        for (let i = 0; i < bars; i++) {
          let v = 0
          for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) v = Math.max(v, envelope[j])
          const bh = Math.max(1.5, v * (h - 4))
          g.fillStyle = i / bars < pos ? played : '#3a3a43'
          g.fillRect(i * 3, (h - bh) / 2, 2, bh)
        }
        g.fillStyle = '#ececf0'
        for (const m of markers) if (duration) g.fillRect((m / duration) * w, 0, 1, 4)
        g.fillRect(pos * w - 1, 0, 2, h)
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [envelope, duration, getPosition, color, markers])

  if (!envelope.length) {
    return <div className="h-16 rounded-control border border-dashed border-ink-700" aria-hidden />
  }

  return (
    <canvas
      ref={canvas}
      className="h-16 w-full cursor-pointer"
      role="slider"
      tabIndex={0}
      aria-label="Track position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(getPosition())}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onSeek(((e.clientX - r.left) / r.width) * duration)
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSeek(getPosition() + 5)
        if (e.key === 'ArrowLeft') onSeek(getPosition() - 5)
      }}
    />
  )
}
