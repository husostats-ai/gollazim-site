import type { Match } from '../../../types'
import { stat } from '../stat'
import { removeMargin, splitGoals, totalGoalsFromOver25, validOdds } from './calibrate'
import { outcomeProbs, sideWinsAndGoals, type OutcomeProbs, type Side } from './scoreModel'

/** Ana yüzdenin dayandığı veri */
export type SideGoalsSource =
  /** 1X2 ve 2.5 Alt/Üst oranları */
  | 'market'
  /** 1X2 oranları + xG / gol ortalamasından toplam gol tahmini */
  | 'market-side'
  /** Oran yok: yalnızca xG */
  | 'xg'

export const SOURCE_LABELS: Record<SideGoalsSource, string> = {
  market: 'piyasa + gol modeli',
  'market-side': 'piyasa (1X2) + gol beklentisi tahmini',
  xg: 'yalnızca xG modeli',
}

/** İki yüzde arasındaki fark bu puandan büyükse "çelişki" sayılır */
export const CONFLICT_LIMIT = 15

export interface SideGoalsLine {
  side: Side
  /** Toplam gol en az kaç olmalı: 1.5 Üst -> 2, 2.5 Üst -> 3 */
  minGoals: 2 | 3
}

export interface GoalExpectation {
  home: number
  away: number
}

export interface SideGoalsModel {
  source: SideGoalsSource
  /** Ana hesabın gol beklentileri */
  main: GoalExpectation
  /** xG tabanlı ikinci hesap; xG yoksa veya ana hesap zaten xG ise null */
  second: GoalExpectation | null
  /** Marjı çıkarılmış piyasa olasılıkları (varsa) */
  market: OutcomeProbs | null
}

const xgExpectation = (match: Match): GoalExpectation | null => {
  const home = stat(match, 'homeXg')
  const away = stat(match, 'awayXg')
  // xG 0 gerçek bir beklenti değil, "veri yok" anlamına gelir.
  return home !== null && away !== null && home > 0 && away > 0 ? { home, away } : null
}

/** Oran yokken toplam gol tahmini: xG toplamı ile gol ortalamasının ortalaması (hangisi varsa). */
const estimatedTotal = (match: Match, xg: GoalExpectation | null): number | null => {
  const avgGoals = stat(match, 'avgGoals')
  const parts = [xg ? xg.home + xg.away : null, avgGoals !== null && avgGoals > 0 ? avgGoals : null].filter(
    (v): v is number => v !== null,
  )
  return parts.length > 0 ? parts.reduce((a, b) => a + b, 0) / parts.length : null
}

/**
 * Maç için skor modelini kurar. Öncelik sırası:
 * 1. 1X2 + 2.5 Alt/Üst oranları: toplam gol 2.5 Üst olasılığına, taraf dağılımı 1X2'ye kalibre edilir.
 * 2. Yalnızca 1X2: toplam gol xG ve gol ortalamasından tahmin edilir, taraf dağılımı 1X2'den gelir.
 * 3. Oran yok: yalnızca xG.
 * Hiçbiri yoksa null (maç listede görünmez).
 */
export function buildSideGoalsModel(match: Match): SideGoalsModel | null {
  const xg = xgExpectation(match)
  const [oddsHome, oddsDraw, oddsAway] = [stat(match, 'oddsHome'), stat(match, 'oddsDraw'), stat(match, 'oddsAway')]

  if (validOdds(oddsHome) && validOdds(oddsDraw) && validOdds(oddsAway)) {
    const [home, draw, away] = removeMargin([oddsHome, oddsDraw, oddsAway])
    const market: OutcomeProbs = { home, draw, away }
    const [oddsOver, oddsUnder] = [stat(match, 'oddsOver25'), stat(match, 'oddsUnder25')]

    if (validOdds(oddsOver) && validOdds(oddsUnder)) {
      const [pOver] = removeMargin([oddsOver, oddsUnder])
      return { source: 'market', main: splitGoals(totalGoalsFromOver25(pOver), market), second: xg, market }
    }
    const total = estimatedTotal(match, xg)
    if (total !== null) return { source: 'market-side', main: splitGoals(total, market), second: xg, market }
  }

  return xg ? { source: 'xg', main: xg, second: null, market: null } : null
}

/** Modelin 1X2 olasılıkları piyasadan bu puandan fazla saparsa uyarı verilir */
export const DRIFT_LIMIT = 3

/**
 * Modelin 1/X/2 olasılıklarından piyasadakine en uzak olanın farkı (yüzde
 * puanı). Bağımsız Poisson, piyasanın çok düşük gördüğü beraberlikleri
 * tutturamaz; fark büyükse yüzdeler daha az güvenilirdir. Piyasa yoksa null.
 */
export function marketDrift(model: SideGoalsModel): number | null {
  if (!model.market) return null
  const fitted = outcomeProbs(model.main.home, model.main.away)
  return (
    Math.max(
      Math.abs(fitted.home - model.market.home),
      Math.abs(fitted.draw - model.market.draw),
      Math.abs(fitted.away - model.market.away),
    ) * 100
  )
}

export interface SideGoalsResult {
  source: SideGoalsSource
  /** Ana yüzde, tam sayı */
  percent: number
  /** xG tabanlı ikinci yüzde; hesaplanamıyorsa null */
  secondPercent: number | null
  /** İki yüzde arasındaki fark CONFLICT_LIMIT'i aşıyor */
  conflict: boolean
}

const percentOf = (goals: GoalExpectation, line: SideGoalsLine): number =>
  Math.round(sideWinsAndGoals(goals.home, goals.away, line.side, line.minGoals) * 100)

export function evaluateSideGoals(model: SideGoalsModel, line: SideGoalsLine): SideGoalsResult {
  const percent = percentOf(model.main, line)
  const secondPercent = model.second ? percentOf(model.second, line) : null
  return {
    source: model.source,
    percent,
    secondPercent,
    conflict: secondPercent !== null && Math.abs(percent - secondPercent) > CONFLICT_LIMIT,
  }
}
