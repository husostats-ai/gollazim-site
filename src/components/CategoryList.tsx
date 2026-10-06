import { getCategory, MAX_MATCHES_PER_CATEGORY, supportsCautious } from '../config/categories'
import type { CategoryAnalysis } from '../services/analysis/types'
import { consensusApprovedIds, selectAll, toggleSelection } from '../services/story/selection'
import { useApp } from '../state/AppContext'
import { EmptyAnalysis, UnavailableNote } from './AnalysisNotice'
import MatchCard from './MatchCard'
import StoryButton from './StoryButton'

const TOOL_BUTTON =
  'rounded-lg border border-navy-500 px-2.5 py-1.5 font-bold hover:bg-navy-600 disabled:cursor-not-allowed disabled:opacity-40'

/** Bir kategorinin tam listesi: eşiği geçen en güçlü maçlar, kart olarak. */
export default function CategoryList({ analysis }: { analysis: CategoryAnalysis }) {
  const { matches, sortMode, storySelections, setStorySelection, aiVerdicts } = useApp()
  const category = getCategory(analysis.categoryId)
  const { predictions, qualifiedCount, threshold } = analysis
  const selectedIds = storySelections[category.id] ?? []
  const approvedIds = consensusApprovedIds(predictions, aiVerdicts)
  const select = (ids: string[]) => setStorySelection(category.id, ids)

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Eşik %{threshold} · {predictions.length} öneri
          {qualifiedCount > predictions.length &&
            ` (eşiği geçen ${qualifiedCount} maçtan en güçlü ${MAX_MATCHES_PER_CATEGORY})`}
        </p>
        <StoryButton categoryId={analysis.categoryId} />
      </div>
      {(predictions.length > 0 || selectedIds.length > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs" data-testid="story-select-tools">
          <span className="text-muted">Görsel için:</span>
          {predictions.length > 0 && (
            <button type="button" onClick={() => select(selectAll(predictions))} className={TOOL_BUTTON} data-testid="story-select-all">
              Tümünü seç
            </button>
          )}
          <button
            type="button"
            onClick={() => select([])}
            disabled={selectedIds.length === 0}
            className={TOOL_BUTTON}
            data-testid="story-select-clear"
          >
            Temizle
          </button>
          {approvedIds.length > 0 && (
            <button type="button" onClick={() => select(approvedIds)} className={TOOL_BUTTON} data-testid="story-select-approved">
              Ortak karar Onay olanları seç
            </button>
          )}
        </div>
      )}
      {sortMode === 'cautious' && !supportsCautious(category) && predictions.length > 0 && (
        <p className="mb-3 text-xs text-muted">
          {category.marketBased
            ? 'Bu kategoride yüzde maç örneklemine değil piyasa oranlarına dayandığı için temkinli sıra uygulanmıyor'
            : 'Bu kategoride verinin örneklemi ölçülemediği için temkinli sıra uygulanamıyor'}
          ; liste yüzdeye göre sıralandı.
        </p>
      )}
      {predictions.length === 0 ? (
        <EmptyAnalysis analysis={analysis} total={matches.length} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {predictions.map((p, i) => (
            <MatchCard
              key={p.match.id}
              prediction={p}
              rank={i + 1}
              sortMode={sortMode}
              storySelection={{
                checked: selectedIds.includes(p.match.id),
                onToggle: () => select(toggleSelection(selectedIds, p.match.id)),
              }}
            />
          ))}
        </div>
      )}
      <UnavailableNote analysis={analysis} />
    </div>
  )
}
