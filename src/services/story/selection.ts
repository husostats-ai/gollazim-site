import { isApproved } from '../../config/ai'
import type { CategoryId } from '../../config/categories'
import type { AiVerdict, StorySelection } from '../../types'
import { majorityDecision } from '../ai/consensus'
import { comparePredictions } from '../analysis/engine'
import type { Prediction } from '../analysis/types'

// Kategori Story görseline girecek maçların seçimi. Yalnızca görsel içindir:
// önerileri, sıralamayı, dondurmayı ve istatistikleri etkilemez.

export const selectionId = (date: string, categoryId: CategoryId): string => `${date}|${categoryId}`

/** Bir günün kayıtlı seçimleri, kategoriye göre; kaydı olmayan kategoride seçim yoktur */
export type DaySelections = Partial<Record<CategoryId, string[]>>

/** Verilen günün seçimlerini kategoriye göre dizer; başka günlerin kayıtları alınmaz. */
export function selectionsForDate(rows: StorySelection[], date: string): DaySelections {
  const day: DaySelections = {}
  for (const row of rows) if (row.date === date) day[row.categoryId] = [...row.matchIds]
  return day
}

export interface ResolvedSelection {
  /** Seçilmiş ve hâlâ listede olan öneriler; görseldeki sırayla (yüzdeye göre) */
  selected: Prediction[]
  /** Seçilmiş ama artık listede olmayan (ör. eşik değişti, maç silindi) maç sayısı; görsele girmez */
  missing: number
}

/**
 * Kayıtlı seçimi güncel listeyle eşleştirir. Sıra, işaretleme sırası değil
 * görselin her zamanki sırasıdır (yüzde yüksekten düşüğe); temkinli sıra görseli etkilemez.
 */
export function resolveSelection(predictions: Prediction[], selectedIds: readonly string[] = []): ResolvedSelection {
  const wanted = new Set(selectedIds)
  const selected = predictions.filter((p) => wanted.has(p.match.id)).sort(comparePredictions('percent'))
  return { selected, missing: wanted.size - selected.length }
}

export const toggleSelection = (selectedIds: readonly string[] = [], matchId: string): string[] =>
  selectedIds.includes(matchId) ? selectedIds.filter((id) => id !== matchId) : [...selectedIds, matchId]

export const selectAll = (predictions: Prediction[]): string[] => predictions.map((p) => p.match.id)

/** Listede, yapay zekâların çoğunluk kararı "onay" (Güçlü / Orta) olan maçlar */
export function majorityApprovedIds(predictions: Prediction[], verdicts: AiVerdict[]): string[] {
  return predictions
    .map((p) => p.match.id)
    .filter((matchId) => {
      const decision = majorityDecision(verdicts.filter((v) => v.matchId === matchId))
      return decision !== null && isApproved(decision)
    })
}

/** Yedekten gelen seçimleri doğrular; bozuk kayıtlar atılır, kimlik gün + kategoriden yeniden kurulur. */
export function normalizeSelections(value: unknown, isCategory: (id: string) => id is CategoryId): StorySelection[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<string, StorySelection>()
  for (const row of value as Partial<StorySelection>[]) {
    if (typeof row !== 'object' || row === null) continue
    const { date, categoryId, matchIds } = row
    if (typeof date !== 'string' || typeof categoryId !== 'string' || !isCategory(categoryId) || !Array.isArray(matchIds)) continue
    const ids = [...new Set(matchIds.filter((id): id is string => typeof id === 'string'))]
    if (ids.length > 0) byId.set(selectionId(date, categoryId), { id: selectionId(date, categoryId), date, categoryId, matchIds: ids })
  }
  return [...byId.values()]
}
