import { CATEGORIES } from '../../config/categories'
import type { Match, MatchResult, Pick, Thresholds } from '../../types'
import { analyzeDay } from '../analysis/engine'
import { estimateSampleSize } from '../analysis/reliability'
import type { MarketInfo } from '../analysis/market'
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
  /** Piyasa çelişkisi sınırı (puan); verilmezse varsayılan */
  marketConflictLimit?: number
  /** Yalnızca ölçüm için öneriye yazılan kayıt bilgisi; verilmezse alanlar yazılmaz */
  record?: FreezeRecord
}

/** Dondurulan öneriye eklenen, davranışı etkilemeyen kayıt bilgisi */
export interface FreezeRecord {
  /** Admin derlemesinin commit'i */
  appCommit: string
  /** Maçın verisini getiren CSV'nin yüklenme anı (ISO); bilinmiyorsa null */
  statsUploadedAt: string | null
}

/** Öneriye yazılan piyasa alanları; oran yoksa null ya da 0 değil, açıkça 'none' */
export const frozenMarket = (market: MarketInfo): PickSubset<'marketPercent' | 'marketConflict'> =>
  market.percent === null
    ? { marketPercent: 'none', marketConflict: 'none' }
    : { marketPercent: market.percent, marketConflict: market.conflict }

type PickSubset<K extends keyof Pick> = { [P in K]: NonNullable<Pick[P]> }

/**
 * Skor kaydedilirken maçın önerilerini belirler.
 * - Daha önce dondurulmuşsa: aynı öneriler, aynı yüzde ve eşikle kalır; sadece
 *   sonuç (kazandı/kaybetti) yeni skora göre yeniden hesaplanır.
 * - İlk kez "tamamlandı" kaydediliyorsa: maçın o an (yüzdeye göre sıralı,
 *   eşiği geçen ilk 15 içinde) göründüğü kategoriler o anki yüzde ve eşikle dondurulur.
 * - Henüz tamamlanmadıysa ve dondurulmuş öneri yoksa hiçbir şey dondurulmaz.
 */
export function buildPicksForResult({
  match,
  dayMatches,
  thresholds,
  result,
  existing,
  now,
  marketConflictLimit,
  record,
}: FreezeInput): Pick[] {
  if (existing.length > 0) {
    return existing.map((pick) => ({ ...pick, outcome: evaluatePick(pick.categoryId, result) }))
  }
  if (result.status !== 'completed') return []

  const analysis = analyzeDay(dayMatches, thresholds, 'percent', marketConflictLimit)
  const sampleAtFreeze = record ? estimateSampleSize(match) : null
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
      ...(prediction.secondPercent !== undefined && { secondPercent: prediction.secondPercent }),
      ...(prediction.secondSource !== undefined && { modelSource: prediction.secondSource }),
      ...(prediction.market && frozenMarket(prediction.market)),
      stars: prediction.stars,
      ...(prediction.modelDrift !== undefined && { modelDrift: prediction.modelDrift }),
      // Ölçüm kaydı: liste yüzdeye göre sıralı olduğu için sıra, listedeki yeridir.
      ...(record && {
        sampleAtFreeze,
        rankAtFreeze: predictions.indexOf(prediction) + 1,
        appCommit: record.appCommit,
        ...(record.statsUploadedAt !== null && { statsUploadedAt: record.statsUploadedAt }),
      }),
    })
  }
  return picks
}
