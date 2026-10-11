import type { Tally } from '../../services/stats/statsEngine'
import { CHART } from './chartTheme'
import RateText from './RateText'

export interface RateBarRow {
  key: string
  label: string
  tally: Tally
  /** Oranın yanında gösterilen ek bilgi (ör. karşılaştırma farkı) */
  extra?: string
  /** Bir önceki satırın eşi: araya daha az boşluk girer, çubuk soluk çizilir */
  paired?: boolean
}

const HATCH = `repeating-linear-gradient(45deg, ${CHART.mark} 0 3px, ${CHART.surface} 3px 6px)`

const detail = (t: Tally) =>
  `Kazanan ${t.won} · Kaybeden ${t.lost} · Değerlendirilemedi ${t.void} · Bekliyor ${t.pending}`

/**
 * Yatay çubuklar: her satır bir grubun başarı oranı. Değer çubuğun yanında
 * yazıyla da verilir; az verili gruplar çizgili dolguyla ayrılır.
 */
export default function RateBars({ rows }: { rows: RateBarRow[] }) {
  return (
    <ul className="space-y-3">
      {rows.map(({ key, label, tally, extra, paired }) => (
        <li key={key} title={`${label}: ${detail(tally)}`} tabIndex={0} className={`group rounded-lg outline-none ${paired ? '!mt-1.5' : ''}`} data-testid="rate-row" data-key={key}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="font-semibold">{label}</span>
            <span className="inline-flex flex-wrap items-baseline justify-end gap-x-2">
              <RateText tally={tally} />
              {extra && (
                <span className="text-xs font-semibold whitespace-nowrap text-muted" data-testid="rate-extra">
                  {extra}
                </span>
              )}
            </span>
          </div>
          <div className="mt-1 h-3.5 w-full rounded-r bg-navy-800" role="presentation">
            {tally.rate !== null && tally.rate > 0 && (
              <div
                className={`h-full rounded-r ${paired ? 'opacity-50' : ''}`}
                data-testid="rate-bar"
                style={{
                  width: `${tally.rate}%`,
                  background: tally.lowSample ? HATCH : CHART.mark,
                }}
              />
            )}
          </div>
          <p className="mt-1 hidden text-xs text-muted group-hover:block group-focus:block">{detail(tally)}</p>
        </li>
      ))}
    </ul>
  )
}
