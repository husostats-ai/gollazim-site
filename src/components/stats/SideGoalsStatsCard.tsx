import { getCategory } from '../../config/categories'
import type { SideGoalsStats } from '../../services/stats/statsEngine'
import { formatNumber, formatRate } from '../../utils/format'
import RateBars from './RateBars'
import RateText from './RateText'

const CONFLICT_LABELS = { clear: 'Çelişkisiz öneriler', conflict: 'Çelişkili öneriler' } as const

/** Tahmin ile gerçekleşen arasındaki fark, işaretli yüzde puanı */
const gapText = (predicted: number | null, actual: number | null): string => {
  if (predicted === null || actual === null) return '—'
  const gap = Math.round((actual - predicted) * 10) / 10
  return `${gap > 0 ? '+' : ''}${formatNumber(gap)} puan`
}

export default function SideGoalsStatsCard({ stats }: { stats: SideGoalsStats }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <h3 className="text-sm font-extrabold tracking-wide">ÇELİŞKİYE GÖRE BAŞARI</h3>
        <p className="mt-1 mb-3 text-xs text-muted">
          Çelişkili: dondurma anında ana hesap ile xG hesabı arasında 15 puandan fazla fark vardı.
        </p>
        <RateBars rows={stats.byConflict.map((b) => ({ ...b, label: CONFLICT_LABELS[b.key] }))} />
      </div>

      <div className="min-w-0">
        <h3 className="text-sm font-extrabold tracking-wide">KALİBRASYON</h3>
        <p className="mt-1 mb-3 text-xs text-muted">
          Ortalama tahmin, sonuçlanmış önerilerin ana yüzdelerinin ortalamasıdır. Gerçekleşen başarı tahmine yakınsa
          model iyi kalibre demektir.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-left text-sm" data-testid="calibration-table">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-semibold">Liste</th>
                <th className="py-2 pr-3 text-right font-semibold">Ort. tahmin</th>
                <th className="py-2 pr-3 font-semibold">Gerçekleşen</th>
                <th className="py-2 text-right font-semibold">Fark</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {stats.calibration.map(({ key, predicted, tally }) => (
                <tr key={key} className="border-b border-line last:border-0">
                  <th scope="row" className="py-2 pr-3 font-semibold">
                    {key === 'all' ? 'Tüm Taraf & Gol' : getCategory(key).label}
                  </th>
                  <td className="py-2 pr-3 text-right">{formatRate(predicted)}</td>
                  <td className="py-2 pr-3">
                    <RateText tally={tally} />
                  </td>
                  <td className="py-2 text-right text-muted">{gapText(predicted, tally.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
