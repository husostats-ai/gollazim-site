import { getCategory } from '../../config/categories'
import type { MarketStats } from '../../services/stats/marketStats'
import { formatRate } from '../../utils/format'
import RateText from './RateText'

/** Hazır yüzde, piyasa yüzdesi ve gerçekleşen başarı; yalnızca rakamlar. */
export default function MarketStatsCard({ stats, limit }: { stats: MarketStats; limit: number }) {
  return (
    <div className="min-w-0">
      <p className="mb-3 text-xs text-muted">
        Ortalamalar, piyasa yüzdesi olan ve sonuçlanmış öneriler üzerindendir. Çelişkili: hazır yüzde ile piyasa
        yüzdesi arasında en az {limit} puan fark var.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm" data-testid="market-calibration-table">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-semibold">Kategori</th>
              <th className="py-2 pr-3 text-right font-semibold">Hazır ort.</th>
              <th className="py-2 pr-3 text-right font-semibold">Piyasa ort.</th>
              <th className="py-2 pr-3 font-semibold">Gerçekleşen</th>
              <th className="py-2 pr-3 font-semibold">Çelişkisiz</th>
              <th className="py-2 pr-3 font-semibold">Çelişkili</th>
              <th className="py-2 text-right font-semibold">Oran yok</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {stats.rows.map(({ key, ready, market, tally, clear, conflict, noOdds }) => (
              <tr key={key} className="border-b border-line last:border-0" data-row={key}>
                <th scope="row" className="py-2 pr-3 font-semibold">
                  {key === 'all' ? 'Hepsi birlikte' : getCategory(key).label}
                </th>
                <td className="py-2 pr-3 text-right">{formatRate(ready)}</td>
                <td className="py-2 pr-3 text-right">{formatRate(market)}</td>
                <td className="py-2 pr-3">
                  <RateText tally={tally} />
                </td>
                <td className="py-2 pr-3">
                  <RateText tally={clear} />
                </td>
                <td className="py-2 pr-3">
                  <RateText tally={conflict} />
                </td>
                <td className="py-2 text-right text-muted">{noOdds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {stats.backfilled > 0 && (
        <p className="mt-2 text-xs text-muted" data-testid="market-backfilled">
          {stats.backfilled} önerinin piyasa yüzdesi dondurma anında kaydedilmemişti; maç kaydındaki oranlardan ve
          güncel sınırdan ({limit} puan) sonradan hesaplandı.
        </p>
      )}
      {stats.unknown > 0 && (
        <p className="mt-2 text-xs text-muted" data-testid="market-unknown">
          {stats.unknown} önerinin piyasa yüzdesi kayıtlı değil ve maç kaydı silindiği için hesaplanamıyor; bu tabloya
          girmez.
        </p>
      )}
    </div>
  )
}
