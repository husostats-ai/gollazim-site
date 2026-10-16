import { useState } from 'react'
import { getCategory } from '../../config/categories'
import { BASELINE_COMPUTED_AT, BASELINE_SOURCE, formatBaseline, LEAGUE_BASELINES } from '../../config/leagueBaselines'
import { MAIN_CATEGORY_IDS } from '../../config/mainCategories'
import { LEAGUE_CATEGORY_MIN_N, type CategoryCell, type GroupCategoryRow, type LeagueCategoryStats } from '../../services/stats/leagueCategoryStats'
import { formatDay, formatPoints, formatRate } from '../../utils/format'
import LowSampleBadge from './LowSampleBadge'

/** Lig tablosunda ilk açılışta görünen lig sayısı; kalanı "Tümünü göster" ile açılır (hesap hepsini kapsar) */
export const LEAGUE_CATEGORY_VISIBLE_ROWS = 15

function Cell({ cell, testId }: { cell: CategoryCell; testId?: string }) {
  if (cell.decided === 0) return <span className="text-muted">—</span>
  return (
    <span className="flex flex-col gap-0.5" data-testid={testId}>
      {cell.lowSample || !cell.interval ? (
        <LowSampleBadge />
      ) : (
        <span>
          <span className="font-bold">{formatRate(cell.rate)}</span>{' '}
          <span className="text-xs whitespace-nowrap text-muted">
            [{formatRate(cell.interval.low)} – {formatRate(cell.interval.high)}]
          </span>
        </span>
      )}
      <span className="text-xs whitespace-nowrap text-muted">
        {cell.decided} / {cell.won} · {cell.matches} maç
      </span>
    </span>
  )
}

const gap = (cell: CategoryCell): string => (cell.baselineGap === null ? '—' : `${formatPoints(cell.baselineGap)} puan`)

const th = 'py-2 pr-3 font-semibold'
/** Lig adı sütunu kaydırmada sabit kalır; dar ekranda veri sütunlarına yer kalsın diye daraltılır */
const leagueColumn = 'sticky left-0 z-10 w-32 max-w-32 bg-navy-700 text-xs break-words sm:w-auto sm:max-w-none sm:text-sm'

function GroupRow({ row }: { row: GroupCategoryRow }) {
  return (
    <tr className="border-b border-line align-top last:border-0" data-testid={`league-category-group-${row.id}`}>
      <th scope="row" className="py-2 pr-3 font-semibold">
        {row.id === 'all' || row.id === 'unknown' ? (
          row.label
        ) : (
          <details>
            <summary className="cursor-pointer">
              {row.label} <span className="text-xs font-normal text-muted">({row.leagues.length} lig)</span>
            </summary>
            <ul className="mt-1 text-xs font-normal text-muted">
              {row.leagues.length === 0 ? <li>—</li> : row.leagues.map((l) => <li key={l.name}>{`${l.name} (${l.decided})`}</li>)}
            </ul>
          </details>
        )}
      </th>
      <td className="py-2 pr-3 text-right">{row.decided}</td>
      <td className="py-2 pr-3 text-right">{row.matches}</td>
      {MAIN_CATEGORY_IDS.map((id) => (
        <td key={id} className="py-2 pr-3">
          <Cell cell={row.cells[id]} />
        </td>
      ))}
    </tr>
  )
}

/** Lig × ana kategori ve sabit grup × ana kategori tabloları; kapsam (tümü / paylaşılan) önerilere önceden uygulanır */
export default function LeagueCategoryCard({ stats }: { stats: LeagueCategoryStats }) {
  const [showAll, setShowAll] = useState(false)
  const labels = MAIN_CATEGORY_IDS.map((id) => getCategory(id).label)
  if (stats.total.decided === 0) return <p className="text-sm text-muted">Bu kapsamda ana kategorilerde sonuçlanmış öneri yok.</p>
  const visible = showAll ? stats.leagues : stats.leagues.slice(0, LEAGUE_CATEGORY_VISIBLE_ROWS)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted" data-testid="league-category-total">
        <span className="font-bold text-white">{stats.total.decided}</span> sonuçlanmış öneri ·{' '}
        <span className="font-bold text-white">{stats.total.matches}</span> benzersiz maç · {stats.leagues.length} lig
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th className={th}>Grup</th>
              <th className={`${th} text-right`}>Sonuçlanan</th>
              <th className={`${th} text-right`}>Maç</th>
              {labels.map((label) => (
                <th key={label} className={th}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {[...stats.groups, ...(stats.unknown ? [stats.unknown] : []), stats.total].map((row) => (
              <GroupRow key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm" data-testid="league-category-leagues">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th className={`${th} ${leagueColumn}`}>Lig</th>
              <th className={`${th} text-right`}>Sonuçlanan</th>
              <th className={`${th} text-right`}>Maç</th>
              {labels.map((label) => (
                <th key={label} className={th}>
                  {label}
                </th>
              ))}
              <th className={`${th} text-right`}>Taban KG VAR</th>
              <th className={`${th} text-right`}>Taban 2.5 ÜST</th>
              <th className={`${th} text-right`}>Fark KG VAR</th>
              <th className={`${th} text-right`}>Fark 2.5 ÜST</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {visible.map((l) => (
              <tr key={l.name} className="border-b border-line align-top last:border-0">
                <th scope="row" className={`py-2 pr-3 font-semibold ${leagueColumn}`}>
                  {l.name}
                </th>
                <td className="py-2 pr-3 text-right">{l.decided}</td>
                <td className="py-2 pr-3 text-right">{l.matches}</td>
                {MAIN_CATEGORY_IDS.map((id) => (
                  <td key={id} className="py-2 pr-3">
                    <Cell cell={l.cells[id]} />
                  </td>
                ))}
                <td className="py-2 pr-3 text-right text-muted">{l.baseline ? formatBaseline(l.baseline.btts) : '—'}</td>
                <td className="py-2 pr-3 text-right text-muted">{l.baseline ? formatBaseline(l.baseline.over25) : '—'}</td>
                <td className="py-2 pr-3 text-right">{gap(l.cells.btts)}</td>
                <td className="py-2 pr-3 text-right">{gap(l.cells.over25)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {stats.leagues.length > LEAGUE_CATEGORY_VISIBLE_ROWS && (
          <button
            type="button"
            className="mt-2 text-xs font-bold text-brand"
            onClick={() => setShowAll((v) => !v)}
            data-testid="league-category-toggle"
          >
            {showAll ? 'Daha az göster' : `Tümünü göster (${stats.leagues.length} lig)`}
          </button>
        )}
      </div>

      <p className="text-xs text-muted">
        Hücre: başarı [Wilson %95] ve sonuçlanan / tutan · benzersiz maç. n &lt; {LEAGUE_CATEGORY_MIN_N} hücrelerde yüzde, aralık
        ve taban farkı yazılmaz. Çok sayıda lig ve kategori karşılaştırıldığı için en iyi/en kötü görünen hücreler şansa bağlı
        olabilir; n&lt;50 satırlardan sonuç çıkarılmamalı. Aynı maçın önerileri bağımsız değildir. Gruplar sabit listedir;
        listede olmayan lig “Diğer yetişkin ligler”dedir. Taban: ligin geçmiş sezonlardaki KG VAR / 2.5 ÜST oranı (
        {BASELINE_SOURCE}; hesap: {formatDay(BASELINE_COMPUTED_AT)}; sezonlar:{' '}
        {LEAGUE_BASELINES.map((b) => `${b.league} ${b.seasons}`).join(', ')}). Fark = bizim − taban, yalnızca n ≥{' '}
        {LEAGUE_CATEGORY_MIN_N} olan KG VAR ve 2.5 ÜST hücrelerinde. İY 0.5 ÜST için taban yok. Hücre sayımı:{' '}
        {stats.cellCounts.cells} lig hücresi, sonuçlanmış önerisi olan {stats.cellCounts.withData}, n ≥ {LEAGUE_CATEGORY_MIN_N}{' '}
        olan {stats.cellCounts.comparable}, taban farkı yazılan {stats.cellCounts.baselineGaps}.
      </p>
    </div>
  )
}
