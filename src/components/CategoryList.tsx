import { getCategory, MAX_MATCHES_PER_CATEGORY, supportsCautious } from '../config/categories'
import type { CategoryAnalysis } from '../services/analysis/types'
import { useApp } from '../state/AppContext'
import { EmptyAnalysis, UnavailableNote } from './AnalysisNotice'
import MatchCard from './MatchCard'
import StoryButton from './StoryButton'

/** Bir kategorinin tam listesi: eşiği geçen en güçlü maçlar, kart olarak. */
export default function CategoryList({ analysis }: { analysis: CategoryAnalysis }) {
  const { matches, sortMode } = useApp()
  const category = getCategory(analysis.categoryId)
  const { predictions, qualifiedCount, threshold } = analysis

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
            <MatchCard key={p.match.id} prediction={p} rank={i + 1} sortMode={sortMode} />
          ))}
        </div>
      )}
      <UnavailableNote analysis={analysis} />
    </div>
  )
}
