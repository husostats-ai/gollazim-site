import { useEffect, useRef, useState } from 'react'
import type { Tally } from '../../services/stats/statsEngine'
import { formatRate } from '../../utils/format'
import { CHART } from './chartTheme'

export interface TrendPoint {
  key: string
  label: string
  /** x ekseninde gösterilen kısa ad */
  shortLabel: string
  tally: Tally
}

const HEIGHT = 220
const PAD = { top: 16, right: 16, bottom: 28, left: 40 }
const TICKS = [0, 25, 50, 75, 100]

/** Zaman içinde başarı oranı (tek seri). Az verili dönemler içi boş noktayla çizilir. */
export default function TrendChart({ points }: { points: TrendPoint[] }) {
  const wrapper = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapper.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Oranı olmayan (hiç sonuçlanmamış) dönemler çizilmez, tabloda görünür.
  const plotted = points.filter((p) => p.tally.rate !== null)
  const innerW = width - PAD.left - PAD.right
  const innerH = HEIGHT - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (plotted.length === 1 ? innerW / 2 : (i / (plotted.length - 1)) * innerW)
  const y = (rate: number) => PAD.top + (1 - rate / 100) * innerH
  const path = plotted.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.tally.rate!)}`).join(' ')
  // Etiketler üst üste binmesin diye seyrelt
  const labelEvery = Math.max(1, Math.ceil(plotted.length / Math.max(1, Math.floor(innerW / 64))))
  const slot = plotted.length > 1 ? innerW / (plotted.length - 1) : innerW
  const current = active !== null ? plotted[active] : null

  return (
    <div ref={wrapper} className="relative" onMouseLeave={() => setActive(null)}>
      {plotted.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Bu görünümde sonuçlanmış öneri yok.</p>
      ) : (
        <>
          <svg width={width} height={HEIGHT} role="img" aria-label="Zaman içinde başarı oranı grafiği">
            {TICKS.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke={CHART.grid} strokeWidth={1} />
                <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={11} fill={CHART.muted}>
                  %{tick}
                </text>
              </g>
            ))}
            {plotted.length > 1 && (
              <path d={path} fill="none" stroke={CHART.mark} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {plotted.map((p, i) => (
              <g key={p.key}>
                {i % labelEvery === 0 && (
                  <text
                    x={x(i)}
                    y={HEIGHT - 8}
                    textAnchor={plotted.length > 1 && i === plotted.length - 1 ? 'end' : 'middle'}
                    fontSize={11}
                    fill={CHART.muted}
                  >
                    {p.shortLabel}
                  </text>
                )}
                <circle
                  cx={x(i)}
                  cy={y(p.tally.rate!)}
                  r={active === i ? 6 : 4.5}
                  fill={p.tally.lowSample ? CHART.surface : CHART.mark}
                  stroke={p.tally.lowSample ? CHART.mark : CHART.surface}
                  strokeWidth={2}
                  data-testid="trend-point"
                  data-low={p.tally.lowSample}
                />
                {/* Görünmez, geniş dokunma / fare alanı */}
                <rect
                  x={x(i) - Math.max(12, slot / 2)}
                  y={PAD.top}
                  width={Math.max(24, slot)}
                  height={innerH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${p.label}: ${formatRate(p.tally.rate)}, ${p.tally.decided} öneri`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  onClick={() => setActive(i)}
                  style={{ outline: 'none' }}
                />
              </g>
            ))}
          </svg>
          {current && active !== null && (
            <div
              data-testid="trend-tooltip"
              className="pointer-events-none absolute z-10 w-max max-w-[220px] rounded-lg border border-navy-500 bg-navy-900 px-2.5 py-1.5 text-xs shadow-lg"
              style={{
                top: Math.max(0, y(current.tally.rate!) - 64),
                ...(x(active) > width / 2 ? { right: width - x(active) + 10 } : { left: x(active) + 10 }),
              }}
            >
              <p className="font-bold">{current.label}</p>
              <p>
                {formatRate(current.tally.rate)} · {current.tally.decided} öneri
                {current.tally.lowSample && ' · az veri'}
              </p>
              <p className="text-muted">
                Kazanan {current.tally.won} · Kaybeden {current.tally.lost}
              </p>
            </div>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <svg width="12" height="12" aria-hidden="true">
                <circle cx="6" cy="6" r="4" fill={CHART.mark} />
              </svg>
              20 ve üzeri öneri
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg width="12" height="12" aria-hidden="true">
                <circle cx="6" cy="6" r="4" fill={CHART.surface} stroke={CHART.mark} strokeWidth="2" />
              </svg>
              az veri (20'den az öneri)
            </span>
          </p>
        </>
      )}
    </div>
  )
}
