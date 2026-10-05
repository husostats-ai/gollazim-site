import { getCategory } from '../../config/categories'
import { MODEL_CONFLICT_LIMIT } from '../../services/analysis/goalModel'
import type { GoalModelStats } from '../../services/stats/statsEngine'
import { formatNumber, formatRate } from '../../utils/format'
import RateBars from './RateBars'
import RateText from './RateText'

const CONFLICT_LABELS = { clear: 'Çelişkisiz öneriler', conflict: 'Model çelişkili öneriler' } as const

const gapText = (gap: number | null): string =>
  gap === null ? '—' : `${gap > 0 ? '+' : ''}${formatNumber(gap)} puan`

export default function GoalModelStatsCard({ stats }: { stats: GoalModelStats }) {
  return (
    // Tablo beş sütunlu olduğu için yan yana değil alt alta: yarım genişlikte son sütun kesiliyordu.
    <div className="grid grid-cols-1 gap-6">
      <div>
        <h3 className="text-sm font-extrabold tracking-wide">ÇELİŞKİYE GÖRE BAŞARI</h3>
        <p className="mt-1 mb-3 text-xs text-muted">
          Model çelişkisi: dondurma anında hazır yüzde ile model yüzdesi arasında {MODEL_CONFLICT_LIMIT} puandan fazla
          fark vardı.
        </p>
        <RateBars rows={stats.byConflict.map((b) => ({ ...b, label: CONFLICT_LABELS[b.key] }))} />
      </div>

      <div className="min-w-0">
        <h3 className="text-sm font-extrabold tracking-wide">KALİBRASYON: FOOTYSTATS VE MODEL</h3>
        <p className="mt-1 mb-3 text-xs text-muted">
          Ortalamalar sonuçlanmış öneriler üzerindendir. Gerçekleşen başarıya hangi sütun daha yakınsa o tahmin daha
          isabetlidir. Fark: hazır yüzde eksi model.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm" data-testid="model-calibration-table">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-semibold">Kategori</th>
                <th className="py-2 pr-3 text-right font-semibold">FootyStats ort.</th>
                <th className="py-2 pr-3 text-right font-semibold">Model ort.</th>
                <th className="py-2 pr-3 font-semibold">Gerçekleşen</th>
                <th className="py-2 text-right font-semibold">Ort. fark</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {stats.calibration.map(({ key, ready, model, gap, tally }) => (
                <tr key={key} className="border-b border-line last:border-0">
                  <th scope="row" className="py-2 pr-3 font-semibold">
                    {key === 'all' ? 'Dört kategori birlikte' : getCategory(key).label}
                  </th>
                  <td className="py-2 pr-3 text-right">{formatRate(ready)}</td>
                  <td className="py-2 pr-3 text-right">{formatRate(model)}</td>
                  <td className="py-2 pr-3">
                    <RateText tally={tally} />
                  </td>
                  <td className="py-2 text-right text-muted">{gapText(gap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {stats.withoutModel > 0 && (
          <p className="mt-2 text-xs text-muted" data-testid="without-model">
            Bu kategorilerdeki {stats.withoutModel} önerinin model yüzdesi kayıtlı değil (model eklenmeden önce
            dondurulmuş ya da xG verisi yok); bu tabloya girmez.
          </p>
        )}
      </div>
    </div>
  )
}
