import { getCategory, supportsCautious } from '../config/categories'
import { statSummary } from '../services/analysis/summary'
import type { Prediction, SortMode } from '../services/analysis/types'
import { useApp } from '../state/AppContext'
import { formatScore } from '../utils/score'
import CautiousBadge from './CautiousBadge'
import NoteBadges from './NoteBadges'
import OutcomeBadge from './OutcomeBadge'
import ReliabilityBadge from './ReliabilityBadge'
import Stars from './Stars'

interface Props {
  prediction: Prediction
  rank: number
  sortMode: SortMode
}

export default function MatchCard({ prediction, rank, sortMode }: Props) {
  const { match, percent, stars, reliability, cautiousPercent, basis, categoryId, secondPercent, notes } = prediction
  const category = getCategory(categoryId)
  const summary = statSummary(match, categoryId)
  const { pickFor, results } = useApp()
  const pick = pickFor(match.id, categoryId)
  const score = formatScore(results[match.id])

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-navy-700 p-4">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="grid h-6 min-w-6 place-items-center rounded-full bg-navy-600 px-1.5 font-bold text-white">
          {rank}
        </span>
        {match.time && <span className="font-semibold text-white">{match.time}</span>}
        {match.league && <span className="min-w-0 truncate">{match.league}</span>}
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base leading-snug font-extrabold break-words sm:text-lg">
            {match.home} <span className="text-muted">–</span> {match.away}
          </h3>
          <p className="mt-1 text-xs font-bold tracking-wide text-brand">{category.label}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-3xl leading-none font-black text-brand">%{percent}</p>
          {secondPercent != null && (
            <p className="mt-1 text-xs text-muted" data-testid="second-percent">
              xG modeli <span className="font-bold text-white">%{secondPercent}</span>
            </p>
          )}
          <Stars count={stars} className="mt-1.5 block text-sm" />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {pick && <OutcomeBadge outcome={pick.outcome} />}
        {score && <span className="self-center text-xs font-bold">{score}</span>}
        <ReliabilityBadge reliability={reliability} />
        <NoteBadges notes={notes} />
        {sortMode === 'cautious' && supportsCautious(category) && <CautiousBadge value={cautiousPercent} />}
      </div>

      <div className="border-t border-line pt-2.5 text-xs text-muted">
        {summary.length > 0 && (
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            {summary.map((item) => (
              <span key={item.label}>
                {item.label} <span className="font-semibold text-white">{item.value}</span>
              </span>
            ))}
          </p>
        )}
        <p className="mt-1 opacity-80" data-testid="basis">
          Kaynak: {basis}
        </p>
      </div>
    </article>
  )
}
