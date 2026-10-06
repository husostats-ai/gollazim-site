import { CATEGORIES, type CategoryId } from '../../config/categories'
import type { Match, Pick } from '../../types'
import { hasMarket, isMarketConflict, marketPercent } from '../analysis/market'
import { tally, type Tally } from './statsEngine'

export interface MarketCalibrationRow {
  key: CategoryId | 'all'
  /** Piyasa yüzdesi olan, sonuçlanmış önerilerin ortalama hazır yüzdesi */
  ready: number | null
  /** Aynı önerilerin ortalama piyasa yüzdesi */
  market: number | null
  /** Piyasa yüzdesi olan önerilerin sayımı; rate gerçekleşen başarıdır */
  tally: Tally
  /** Hazır yüzde ile piyasa çelişmeyen / çelişen önerilerin sayımı */
  clear: Tally
  conflict: Tally
  /** İki yönlü oranı olmayan öneri sayısı; yukarıdaki sütunlara girmez */
  noOdds: number
}

export interface MarketStats {
  /** Kayıt defterindeki sırayla, önerisi olan kategoriler; sonda hepsi birlikte */
  rows: MarketCalibrationRow[]
  /** Piyasa bilgisi dondurma anında kaydedilmemiş, maç kaydındaki oranlardan sonradan hesaplanan öneri sayısı */
  backfilled: number
  /** Piyasa bilgisi kayıtlı olmayan ve maç kaydı silindiği için hesaplanamayan öneri sayısı; tabloya girmez */
  unknown: number
}

export interface MarketBackfill {
  picks: Pick[]
  backfilled: number
  unknown: number
}

/**
 * Piyasa bilgisi kaydedilmeden dondurulmuş önerileri, maç kaydı duruyorsa
 * oradaki oranlardan tamamlar. Veritabanına yazmaz; yalnızca istatistik içindir.
 * Dondurma anında kaydedilmiş değerlere dokunulmaz.
 */
export function backfillMarket(picks: Pick[], matches: Match[], limit: number): MarketBackfill {
  const byId = new Map(matches.map((m) => [m.id, m]))
  let backfilled = 0
  let unknown = 0
  const filled = picks.map((pick) => {
    if (!hasMarket(pick.categoryId) || pick.marketPercent !== undefined) return pick
    const match = byId.get(pick.matchId)
    if (!match) {
      unknown++
      return pick
    }
    backfilled++
    const market = marketPercent(match, pick.categoryId)
    return market === null
      ? { ...pick, marketPercent: 'none' as const, marketConflict: 'none' as const }
      : { ...pick, marketPercent: market, marketConflict: isMarketConflict(pick.percent, market, limit) }
  })
  return { picks: filled, backfilled, unknown }
}

const round1 = (value: number) => Math.round(value * 10) / 10
const mean = (values: number[]) => (values.length === 0 ? null : round1(values.reduce((a, b) => a + b, 0) / values.length))
const isDecided = (p: Pick) => p.outcome === 'won' || p.outcome === 'lost'

function calibrationRow(key: MarketCalibrationRow['key'], picks: Pick[]): MarketCalibrationRow {
  const priced = picks.filter((p) => typeof p.marketPercent === 'number')
  // Ortalamalar gerçekleşen başarıyla aynı öneriler üzerinden alınır.
  const decided = priced.filter(isDecided)
  return {
    key,
    ready: mean(decided.map((p) => p.percent)),
    market: mean(decided.map((p) => p.marketPercent as number)),
    tally: tally(priced),
    clear: tally(priced.filter((p) => p.marketConflict === false)),
    conflict: tally(priced.filter((p) => p.marketConflict === true)),
    noOdds: picks.filter((p) => p.marketPercent === 'none').length,
  }
}

/** Piyasa yüzdesi kapsamındaki kategorilerde hazır yüzde, piyasa ve gerçekleşen başarı. Öneri yoksa null. */
export function buildMarketStats({ picks, backfilled, unknown }: MarketBackfill): MarketStats | null {
  const inScope = picks.filter((p) => hasMarket(p.categoryId) && p.marketPercent !== undefined)
  if (inScope.length === 0) return null
  const ids = CATEGORIES.map((c) => c.id).filter((id) => inScope.some((p) => p.categoryId === id))
  return {
    rows: [...ids.map((id) => calibrationRow(id, inScope.filter((p) => p.categoryId === id))), calibrationRow('all', inScope)],
    backfilled,
    unknown,
  }
}
