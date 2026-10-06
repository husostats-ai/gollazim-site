import { useMemo, useState } from 'react'
import { buildScoreStats } from '../../services/stats/scoreStats'
import { inScope, scopeBounds, type SummaryScope } from '../../services/stats/statsSummary'
import { useApp } from '../../state/AppContext'
import type { AiVerdict, Match, MatchResult } from '../../types'
import { formatNumber, formatRate } from '../../utils/format'
import LowSampleBadge from './LowSampleBadge'

const SCOPES: { kind: 'all' | 'last7' | 'last30'; label: string }[] = [
  { kind: 'all', label: 'Tümü' },
  { kind: 'last7', label: 'Son 7 gün' },
  { kind: 'last30', label: 'Son 30 gün' },
]

/** Skor tahminleri deneyi: yalnızca rakamlar; yorum içermez. */
export default function ScoreStatsCard({ matches, results, verdicts }: { matches: Match[]; results: MatchResult[]; verdicts: AiVerdict[] }) {
  const { today } = useApp()
  const [kind, setKind] = useState<(typeof SCOPES)[number]['kind']>('all')
  const stats = useMemo(() => {
    const bounds = scopeBounds({ kind } as SummaryScope, today)
    return buildScoreStats({ matches: matches.filter((m) => inScope(m.date, bounds)), results, verdicts })
  }, [kind, today, matches, results, verdicts])

  return (
    <div className="min-w-0" data-testid="score-stats">
      <div className="mb-3 inline-flex max-w-full flex-wrap rounded-xl border border-navy-600 bg-navy-800 p-0.5" role="group" aria-label="Kapsam">
        {SCOPES.map((scope) => (
          <button
            key={scope.kind}
            type="button"
            aria-pressed={kind === scope.kind}
            onClick={() => setKind(scope.kind)}
            data-testid={`score-scope-${scope.kind}`}
            className={`rounded-[10px] px-3 py-1.5 text-xs font-bold transition-colors ${
              kind === scope.kind ? 'bg-brand text-navy-950' : 'text-muted hover:text-white'
            }`}
          >
            {scope.label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm" data-testid="score-stats-table">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-semibold">Kaynak</th>
              <th className="py-2 pr-3 text-right font-semibold">Tam skor</th>
              <th className="py-2 pr-3 text-right font-semibold">Sonuç (1/X/2)</th>
              <th className="py-2 pr-3 text-right font-semibold">Toplam gol ort. hata</th>
              <th className="py-2 font-semibold">n</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {stats.rows.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0" data-row={row.id}>
                <th scope="row" className="py-2 pr-3 font-semibold">
                  {row.label}
                </th>
                <td className="py-2 pr-3 text-right">{formatRate(row.exact)}</td>
                <td className="py-2 pr-3 text-right">{formatRate(row.outcome)}</td>
                <td className="py-2 pr-3 text-right">{row.totalGoalsError === null ? '—' : formatNumber(row.totalGoalsError)}</td>
                <td className="py-2">
                  <span className="inline-flex flex-wrap items-center gap-1.5 whitespace-nowrap">
                    {row.n} maç{row.n > 0 && row.lowSample && <LowSampleBadge />}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted" data-testid="score-stats-note">
        Kapsamda skoru girilmiş {stats.scored} maç. Yalnızca skoru girilmiş ve o kaynağın tahmini olan maçlar sayılır. Model:
        maç ilk “Tamamlandı” kaydedilirken alınan en olası skor. Referanslar skoru girilmiş tüm maçlarda ölçülür.
        {stats.late > 0 && ` ${stats.late} yapay zekâ tahmini maç başladıktan sonra kaydedildiği için sayılmadı.`}
      </p>
    </div>
  )
}
