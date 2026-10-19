import type { SpreadPoint } from './view'
import { spreadText } from './view'

// Karttaki yüzdelerin (Model, Piyasa, Geçmiş) 0–100 çubuğunda yan yana gösterimi. Yalnızca kartta
// zaten yazan değerleri çizer; renkler düz onaltılık değerlerdir (Chrome < 111).
const DOT: Record<SpreadPoint['kind'], string> = {
  model: 'bg-[#60a5fa]',
  market: 'bg-[#e2e8f0]',
  history: 'bg-brand',
}

/** Bu puandan yakın noktalar üst üste binmesin diye dikeyde hafif kaydırılır */
const NEAR = 4

/** Çubuk ve fark satırı yalnızca en az iki değer varken çizilir; tek değer kartta zaten yazar */
export default function MemberSpread({ points }: { points: SpreadPoint[] }) {
  if (points.length < 2) return null
  const values = points.map((p) => p.value)
  const low = Math.min(...values)
  const high = Math.max(...values)
  // Değere göre sırala; bir öncekine çok yakın olan nokta yukarı / aşağı kayar.
  const sorted = [...points].sort((a, b) => a.value - b.value)
  const shift = new Map<SpreadPoint['kind'], number>()
  sorted.forEach((p, i) => {
    const prev = i > 0 ? sorted[i - 1] : null
    if (!prev || p.value - prev.value >= NEAR) return void shift.set(p.kind, 0)
    // Yakın çift zıt yönlere ayrılır: biri yukarı, biri aşağı.
    if (shift.get(prev.kind) === 0) shift.set(prev.kind, 5)
    shift.set(p.kind, -(shift.get(prev.kind) ?? 5))
  })
  const text = spreadText(points)
  return (
    <div className="flex flex-col gap-1.5" data-testid="member-spread" data-points={points.length}>
      <div className="relative mx-1.5 h-5" aria-hidden="true">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-navy-600" />
        <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/25" style={{ left: `${low}%`, width: `${high - low}%` }} />
        {points.map((p) => (
          <span
            key={p.kind}
            className={`absolute top-1/2 h-2.5 w-2.5 rounded-full ring-2 ring-navy-700 ${DOT[p.kind]}`}
            style={{ left: `${p.value}%`, transform: `translate(-50%, calc(-50% + ${shift.get(p.kind)}px))` }}
            data-testid="member-spread-dot"
            data-kind={p.kind}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        {points.map((p) => (
          <span key={p.kind} className="inline-flex items-center gap-1 whitespace-nowrap" data-testid="member-spread-label" data-kind={p.kind}>
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[p.kind]}`} />
            {p.label} <span className="font-bold text-white">%{p.value}</span>
          </span>
        ))}
        {text && (
          <span className="ml-auto whitespace-nowrap" data-testid="member-spread-gap">
            {text}
          </span>
        )}
      </div>
    </div>
  )
}
