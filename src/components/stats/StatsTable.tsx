import type { Tally } from '../../services/stats/statsEngine'
import RateText from './RateText'

export interface StatsTableRow {
  key: string
  label: string
  tally: Tally
}

/** Grafiklerin tablo karşılığı: her değer sayı olarak okunabilir. */
export default function StatsTable({ firstColumn, rows }: { firstColumn: string; rows: StatsTableRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-semibold">{firstColumn}</th>
            <th className="py-2 pr-3 font-semibold">Başarı</th>
            <th className="py-2 pr-3 text-right font-semibold">Kazanan</th>
            <th className="py-2 pr-3 text-right font-semibold">Kaybeden</th>
            <th className="py-2 pr-3 text-right font-semibold">Değerlendirilemedi</th>
            <th className="py-2 text-right font-semibold">Bekliyor</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map(({ key, label, tally }) => (
            <tr key={key} className="border-b border-line last:border-0">
              <th scope="row" className="py-2 pr-3 font-semibold">
                {label}
              </th>
              <td className="py-2 pr-3">
                <RateText tally={tally} />
              </td>
              <td className="py-2 pr-3 text-right">{tally.won}</td>
              <td className="py-2 pr-3 text-right">{tally.lost}</td>
              <td className="py-2 pr-3 text-right text-muted">{tally.void}</td>
              <td className="py-2 text-right text-muted">{tally.pending}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
