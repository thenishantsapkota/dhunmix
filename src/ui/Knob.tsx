import { useRef } from 'react'

type Props = {
  label: string
  value: number
  min: number
  max: number
  defaultValue: number
  onChange: (v: number) => void
  format: (v: number) => string
  color?: string
}

const START = 135 // degrees; the arc spans 270° like a hardware pot
const SWEEP = 270

function point(deg: number, r: number) {
  const rad = (deg * Math.PI) / 180
  return [24 + r * Math.cos(rad), 24 + r * Math.sin(rad)]
}

function arc(from: number, to: number, r: number) {
  const [x1, y1] = point(from, r)
  const [x2, y2] = point(to, r)
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`
}

/** Rotary knob: drag up/down, arrow keys, double-click to reset. Exposed to assistive tech as a slider. */
export function Knob({ label, value, min, max, defaultValue, onChange, format, color = 'var(--color-marigold)' }: Props) {
  const drag = useRef<{ y: number; v: number } | null>(null)
  const span = max - min
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  // Default sits at 12 o'clock even when the range is lopsided (EQ: -26 kill … +6 boost), like hardware.
  const angle = (v: number) =>
    v <= defaultValue
      ? START + ((v - min) / (defaultValue - min || 1)) * (SWEEP / 2)
      : START + SWEEP / 2 + ((v - defaultValue) / (max - defaultValue || 1)) * (SWEEP / 2)
  const a0 = angle(defaultValue)
  const a = angle(value)

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        className="size-12 touch-none rounded-full"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { y: e.clientY, v: value }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const fine = e.shiftKey ? 0.25 : 1
          onChange(clamp(drag.current.v + ((drag.current.y - e.clientY) / 160) * span * fine))
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => onChange(defaultValue)}
        onKeyDown={(e) => {
          const step = span / 40
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(clamp(value + step))
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(clamp(value - step))
          else if (e.key === 'Home' || e.key === 'Delete') onChange(defaultValue)
          else return
          e.preventDefault()
        }}
      >
        <svg viewBox="0 0 48 48" className="size-12" aria-hidden>
          <path d={arc(START, START + SWEEP, 20)} fill="none" stroke="var(--color-ink-700)" strokeWidth="3" strokeLinecap="round" />
          {Math.abs(a - a0) > 0.5 && (
            <path d={arc(Math.min(a, a0), Math.max(a, a0), 20)} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
          )}
          <circle cx="24" cy="24" r="14" fill="var(--color-ink-800)" stroke="var(--color-ink-700)" />
          <line x1={point(a, 6)[0]} y1={point(a, 6)[1]} x2={point(a, 12)[0]} y2={point(a, 12)[1]} stroke="var(--color-ink-100)" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <span className="text-2xs font-medium tracking-wider text-ink-400">{label}</span>
      <span className="font-mono text-2xs text-ink-500 tabular-nums">{format(value)}</span>
    </div>
  )
}
