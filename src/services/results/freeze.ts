import { CATEGORIES } from '../../config/categories'
import type { Match, MatchResult, Pick, Thresholds } from '../../types'
import { analyzeDay } from '../analysis/engine'
import { evaluatePick } from './evaluator'

interface FreezeInput {
  match: Match
  /** Maçın günündeki tüm maçlar (ilk 15 sıralaması için) */
  dayMatches: Match[]
  thresholds: Thresholds
  result: MatchResult
  /** Bu maç için daha önce dondurulmuş öneriler */
  existing: Pick[]
  now: string
}

/**
 * Skor kaydedilirken maçın önerilerini belirler.
 * - Daha önce dondurulmuşsa: aynı öneriler, aynı yüzde ve eşikle kalır; sadece
 *   sonuç (kazandı/kaybetti) yeni skora göre yeniden hesaplanır.
 * - İlk kez "tamamlandı" kaydediliyorsa: maçın o an (yüzdeye göre sıralı,
 *   eşiği geçen ilk 15 içinde) göründüğü kategoriler o anki yüzde ve eşikle dondurulur.
 * - Henüz tamamlanmadıysa ve dondurulmuş öneri yoksa hiçbir şey dondurulmaz.
 */
export function buildPicksForResult({ match, dayMatches, thresholds, result, existing, now }: FreezeInput): Pick[] {
  if (existing.length > 0) {
    return existing.map((pick) => ({ ...pick, outcome: evaluatePick(pick.categoryId, result) }))
  }
  if (result.status !== 'completed') return []

  const analysis = analyzeDay(dayMatches, thresholds, 'percent')
  const picks: Pick[] = []
  for (const category of CATEGORIES) {
    const { predictions, threshold } = analysis[category.id]
    const prediction = predictions.find((p) => p.match.id === match.id)
    if (!prediction) continue
    picks.push({
      id: `${match.id}|${category.id}`,
      matchId: match.id,
      categoryId: category.id,
      date: match.date,
      percent: prediction.percent,
      threshold,
      outcome: evaluatePick(category.id, result),
      frozenAt: now,
      reliability: prediction.reliability.level,
      ...(prediction.conflict !== undefined && { conflict: prediction.conflict }),
    })
  }
  return picks
}
