import { getCategory, MAX_MATCHES_PER_CATEGORY, supportsCautious } from '../config/categories'
import type { CategoryAnalysis } from '../services/analysis/types'
import type { SharedPick } from '../types'
import { useState } from 'react'
import { DEFAULT_STORY_TEXTS, type StoryTexts } from '../config/storyTexts'
import { settingsRepo } from '../services/data'
import { buildCaption, type CaptionTarget } from '../services/story/caption'
import { majorityApprovedIds, resolveSelection, selectAll, toggleSelection } from '../services/story/selection'
import { formatLongDate } from '../utils/format'
import CaptionBox from './CaptionBox'
import { activeShared, findActiveShared } from '../services/story/shared'
import { useApp } from '../state/AppContext'
import SharedBadge from './SharedBadge'
import { EmptyAnalysis, UnavailableNote } from './AnalysisNotice'
import MatchCard from './MatchCard'
import StoryButton from './StoryButton'

const TOOL_BUTTON =
  'rounded-lg border border-navy-500 px-2.5 py-1.5 font-bold hover:bg-navy-600 disabled:cursor-not-allowed disabled:opacity-40'

const withRecord = (record: SharedPick | undefined, onRemove: () => void) => (record ? { record, onRemove } : undefined)

/** Bir kategorinin tam listesi: eşiği geçen en güçlü maçlar, kart olarak. */
export default function CategoryList({ analysis }: { analysis: CategoryAnalysis }) {
  const { matches, sortMode, storySelections, setStorySelection, aiVerdicts, sharedPicks, removeShared, selectedDate } = useApp()
  const category = getCategory(analysis.categoryId)
  const { predictions, qualifiedCount, threshold } = analysis
  const selectedIds = storySelections[category.id] ?? []
  const approvedIds = majorityApprovedIds(predictions, aiVerdicts, category.id)
  const select = (ids: string[]) => setStorySelection(category.id, ids)
  // Açıklama metni görselle aynı maçlardan ve aynı sırayla üretilir.
  const { selected } = resolveSelection(predictions, selectedIds)
  const [captionTexts, setCaptionTexts] = useState<StoryTexts | null>(null)
  const caption = (target: CaptionTarget) =>
    selectedDate && captionTexts
      ? buildCaption({
          target,
          categoryId: category.id,
          dateLabel: formatLongDate(selectedDate),
          matches: selected.map((p) => ({ ...p.match, percent: p.percent })),
          texts: captionTexts,
        })
      : ''
  const toggleCaption = async () => setCaptionTexts(captionTexts ? null : await settingsRepo.getStoryTexts().catch(() => DEFAULT_STORY_TEXTS))
  const sharedFor = (matchId: string) => (selectedDate ? findActiveShared(sharedPicks, selectedDate, category.id, matchId) : undefined)
  // Paylaşılmış ama artık listede olmayan maçlar da görülebilsin ve çıkarılabilsin.
  const listed = new Set(predictions.map((p) => p.match.id))
  const orphans = activeShared(sharedPicks).filter((r) => r.categoryId === category.id && r.date === selectedDate && !listed.has(r.matchId))

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Eşik %{threshold} · {predictions.length} öneri
          {qualifiedCount > predictions.length &&
            ` (eşiği geçen ${qualifiedCount} maçtan en güçlü ${MAX_MATCHES_PER_CATEGORY})`}
        </p>
        <span className="inline-flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void toggleCaption()}
            disabled={selected.length === 0}
            aria-expanded={captionTexts !== null}
            data-testid={`caption-${category.id}`}
            className="rounded-lg border border-navy-500 px-3 py-1.5 text-xs font-bold whitespace-nowrap hover:bg-navy-600 disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent"
          >
            Açıklama metni
          </button>
          <StoryButton categoryId={analysis.categoryId} />
        </span>
      </div>
      {captionTexts && selected.length > 0 && (
        <div className="mb-3">
          <CaptionBox instagram={caption('instagram')} telegram={caption('telegram')} testId={`caption-${category.id}`} />
        </div>
      )}
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
              Çoğunluk kararı Onay olanları seç
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
              shared={withRecord(sharedFor(p.match.id), () => void removeShared(category.id, p.match.id))}
            />
          ))}
        </div>
      )}
      {orphans.length > 0 && (
        <div className="mt-3 rounded-xl border border-line bg-navy-800 p-3" data-testid="shared-orphans">
          <p className="text-xs text-muted">Paylaşılmış ama şu an bu listede olmayan maçlar:</p>
          <ul className="mt-2 space-y-2">
            {orphans.map((record) => {
              const match = matches.find((m) => m.id === record.matchId)
              return (
                <li key={record.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 text-sm font-semibold break-words">
                    {match ? `${match.home} – ${match.away}` : 'Maç kaydı silinmiş'}
                  </span>
                  <SharedBadge record={record} onRemove={() => void removeShared(category.id, record.matchId)} />
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <UnavailableNote analysis={analysis} />
    </div>
  )
}
