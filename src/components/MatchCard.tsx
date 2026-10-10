import { getCategory, supportsCautious } from '../config/categories'
import { marketNotes } from '../services/analysis/market'
import { statSummary } from '../services/analysis/summary'
import { matchStandings, playedHint } from '../services/league/standing'
import type { Prediction, SortMode } from '../services/analysis/types'
import { useApp } from '../state/AppContext'
import type { SharedPick } from '../types'
import { formatScore } from '../utils/score'
import AiVerdictBadges from './ai/AiVerdictBadges'
import CautiousBadge from './CautiousBadge'
import HighlightButton from './HighlightButton'
import NoteBadges from './NoteBadges'
import OutcomeBadge from './OutcomeBadge'
import ReliabilityBadge from './ReliabilityBadge'
import ScoreOdds from './ScoreOdds'
import SharedBadge from './SharedBadge'
import Stars from './Stars'
import StreakButton from './StreakButton'

interface Props {
  prediction: Prediction
  rank: number
  sortMode: SortMode
  /** Verilirse kartta "Görsele ekle" kutusu görünür; yalnızca Story görselini etkiler */
  storySelection?: { checked: boolean; onToggle: () => void }
  /** Maçın bu kategorideki geçerli paylaşım kaydı (varsa) ve çıkarma işlemi */
  shared?: { record: SharedPick; onRemove: () => void }
}

export default function MatchCard({ prediction, rank, sortMode, storySelection, shared }: Props) {
  const { match, percent, stars, reliability, cautiousPercent, basis, categoryId, secondPercent, secondLabel, notes, market } =
    prediction
  const category = getCategory(categoryId)
  const summary = statSummary(match, categoryId)
  const { pickFor, results, marketConflictLimit, matches, leagueTables, teamAliases } = useApp()
  // Lig tablosu yalnızca gösterilir; tablo yoksa kartta hiçbir şey değişmez.
  const standings = matchStandings(match, matches, leagueTables, teamAliases, new Date())
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
        {storySelection && (
          // Negatif kenar boşluğu dokunma alanını kartın yüksekliğini değiştirmeden büyütür.
          <label className="-my-2.5 ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 py-2.5 pl-2 font-semibold whitespace-nowrap text-white">
            <input
              type="checkbox"
              checked={storySelection.checked}
              onChange={storySelection.onToggle}
              data-testid="story-select"
              className="h-5 w-5 shrink-0 accent-brand"
            />
            Görsele ekle
          </label>
        )}
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
              {secondLabel} <span className="font-bold text-white">%{secondPercent}</span>
            </p>
          )}
          {market && market.percent !== null && (
            <p className="mt-1 text-xs text-muted" data-testid="market-percent">
              Piyasa <span className="font-bold text-white">%{market.percent}</span>
            </p>
          )}
          <Stars count={stars} className="mt-1.5 block text-sm" />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {pick && <OutcomeBadge outcome={pick.outcome} />}
        {score && <span className="self-center text-xs font-bold">{score}</span>}
        <ReliabilityBadge reliability={reliability} hint={playedHint(standings)} />
        <NoteBadges notes={notes} />
        <NoteBadges notes={marketNotes(percent, market, marketConflictLimit)} />
        {sortMode === 'cautious' && supportsCautious(category) && <CautiousBadge value={cautiousPercent} />}
      </div>

      {(standings.home || standings.away) && (
        <div className="text-xs text-muted" data-testid="league-standing">
          {([['Ev', standings.home], ['Dep', standings.away]] as const).map(
            ([side, info]) =>
              info && (
                <p key={side} className="break-words">
                  <span className="font-semibold text-white">{side}:</span> {info.text}
                  {info.stale && <span className="font-bold text-warn"> · ⚠ güncel değil</span>}
                </p>
              ),
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <HighlightButton prediction={prediction} />
        <StreakButton prediction={prediction} />
      </div>

      {shared && <SharedBadge record={shared.record} onRemove={shared.onRemove} />}

      <AiVerdictBadges matchId={match.id} categoryId={categoryId} />

      <ScoreOdds match={match} />

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
