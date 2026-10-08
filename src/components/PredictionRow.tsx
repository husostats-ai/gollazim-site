import { getCategory, supportsCautious } from '../config/categories'
import { marketNotes } from '../services/analysis/market'
import type { Prediction, SortMode } from '../services/analysis/types'
import { useApp } from '../state/AppContext'
import CautiousBadge from './CautiousBadge'
import HighlightButton from './HighlightButton'
import NoteBadges from './NoteBadges'
import OutcomeBadge from './OutcomeBadge'
import ReliabilityBadge from './ReliabilityBadge'
import Stars from './Stars'

interface Props {
  prediction: Prediction
  sortMode: SortMode
  /** Karışık listelerde (ör. Bol Gol özeti) kategori adını da gösterir */
  showCategory?: boolean
}

/** Ana sayfa özetleri için kısa satır */
export default function PredictionRow({ prediction, sortMode, showCategory }: Props) {
  const { match, percent, stars, reliability, cautiousPercent, categoryId, notes, market } = prediction
  const category = getCategory(categoryId)
  const { pickFor, marketConflictLimit } = useApp()
  const pick = pickFor(match.id, categoryId)
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm leading-snug font-bold break-words">
          {match.home} <span className="text-muted">–</span> {match.away}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          {match.time && <span>{match.time}</span>}
          {showCategory && <span className="font-bold text-brand">{category.label}</span>}
          {pick && <OutcomeBadge outcome={pick.outcome} />}
          <ReliabilityBadge reliability={reliability} compact />
          <NoteBadges notes={notes.filter((n) => n.kind === 'conflict')} />
          <NoteBadges notes={marketNotes(percent, market, marketConflictLimit).filter((n) => n.kind === 'market-conflict')} />
          {sortMode === 'cautious' && supportsCautious(category) && <CautiousBadge value={cautiousPercent} />}
          <HighlightButton prediction={prediction} />
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xl leading-none font-black text-brand">%{percent}</p>
        <Stars count={stars} className="mt-1 block text-xs" />
      </div>
    </li>
  )
}
