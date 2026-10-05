import { CATEGORIES } from '../../config/categories'
import type { Match } from '../../types'
import type { DayAnalysis } from '../analysis/engine'
import type { Prediction } from '../analysis/types'

/** Yapay zekâya sorulacak bir maç: eşiği geçtiği tüm kategorilerdeki önerileriyle */
export interface AiMatchItem {
  match: Match
  /** Kategori kayıt defteri sırasıyla */
  predictions: Prediction[]
}

export const byKickoff = (a: Match, b: Match): number =>
  (a.time ?? '').localeCompare(b.time ?? '') || a.home.localeCompare(b.home, 'tr') || a.id.localeCompare(b.id)

/**
 * Günün analizinde herhangi bir kategoride gösterilen (eşiği geçen ve ilk
 * 15'e giren) maçları benzersiz maç bazında toplar; başlama saatine göre sıralar.
 */
export function collectAiMatches(analysis: DayAnalysis): AiMatchItem[] {
  const byMatch = new Map<string, AiMatchItem>()
  for (const category of CATEGORIES) {
    for (const prediction of analysis[category.id].predictions) {
      const item = byMatch.get(prediction.match.id) ?? { match: prediction.match, predictions: [] }
      item.predictions.push(prediction)
      byMatch.set(prediction.match.id, item)
    }
  }
  return [...byMatch.values()].sort((a, b) => byKickoff(a.match, b.match))
}
