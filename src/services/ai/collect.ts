import { AI_CATEGORY_IDS } from '../../config/ai'
import { CATEGORIES, type CategoryId } from '../../config/categories'
import type { Match } from '../../types'
import type { DayAnalysis } from '../analysis/engine'
import type { Prediction } from '../analysis/types'

/** Yapay zekâya sorulacak bir maç */
export interface AiMatchItem {
  match: Match
  /** Maçın eşiği geçtiği tüm kategorilerdeki önerileri (veri bloğu için), kategori kayıt defteri sırasıyla */
  predictions: Prediction[]
  /** Karar istenen kategoriler: AI_CATEGORY_IDS içinden, maçın listede (ilk 15'te) olduğu kategoriler */
  evaluate: CategoryId[]
}

export const byKickoff = (a: Match, b: Match): number =>
  (a.time ?? '').localeCompare(b.time ?? '') || a.home.localeCompare(b.home, 'tr') || a.id.localeCompare(b.id)

/**
 * Günün analizinde, karar istenen kategorilerden (AI_CATEGORY_IDS) en az birinde gösterilen
 * (eşiği geçen ve ilk 15'e giren) maçları benzersiz maç bazında toplar; başlama saatine göre
 * sıralar. Yalnızca başka kategorilerde (2. yarı, korner, kart…) görünen maç listeye girmez.
 */
export function collectAiMatches(analysis: DayAnalysis): AiMatchItem[] {
  const byMatch = new Map<string, AiMatchItem>()
  for (const category of CATEGORIES) {
    for (const prediction of analysis[category.id].predictions) {
      const item = byMatch.get(prediction.match.id) ?? { match: prediction.match, predictions: [], evaluate: [] }
      item.predictions.push(prediction)
      if (AI_CATEGORY_IDS.includes(category.id)) item.evaluate.push(category.id)
      byMatch.set(prediction.match.id, item)
    }
  }
  return [...byMatch.values()].filter((item) => item.evaluate.length > 0).sort((a, b) => byKickoff(a.match, b.match))
}
