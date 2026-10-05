import { poissonAtLeast } from '../poisson'
import { outcomeProbs, type OutcomeProbs } from './scoreModel'

/** Oran geçerli mi (1'den büyük sayı) */
export const validOdds = (odds: number | null): odds is number => odds !== null && odds > 1

/**
 * Bahisçi marjını çıkarır: 1/oran değerlerinin toplamı 1'i aşar (marj);
 * her biri toplama bölünerek olasılıklar 1'e tamamlanır.
 */
export const removeMargin = (odds: number[]): number[] => {
  const raw = odds.map((o) => 1 / o)
  const sum = raw.reduce((a, b) => a + b, 0)
  return raw.map((p) => p / sum)
}

const MIN_TOTAL = 0.2
const MAX_TOTAL = 8

/** P(toplam gol >= 3) = pOver25 olacak toplam gol beklentisi (toplam da Poisson dağılır). */
export function totalGoalsFromOver25(pOver25: number): number {
  let lo = MIN_TOTAL
  let hi = MAX_TOTAL
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (poissonAtLeast(3, mid) < pOver25) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * Toplam gol beklentisi sabitken, modelin ev ve deplasman galibiyet
 * olasılıkları piyasadakine en yakın olacak şekilde gol beklentisini iki
 * takıma böler (kareler toplamı en küçük). Beraberlik modelden çıkar.
 */
export function splitGoals(total: number, market: OutcomeProbs): { home: number; away: number } {
  const error = (share: number) => {
    const p = outcomeProbs(total * share, total * (1 - share))
    return (p.home - market.home) ** 2 + (p.away - market.away) ** 2
  }
  let best = 0.5
  let bestError = Infinity
  const scan = (from: number, to: number, step: number) => {
    for (let s = from; s <= to + 1e-12; s += step) {
      const e = error(s)
      if (e < bestError) [best, bestError] = [s, e]
    }
  }
  scan(0.02, 0.98, 0.01)
  scan(Math.max(0.005, best - 0.01), Math.min(0.995, best + 0.01), 0.0005)
  return { home: total * best, away: total * (1 - best) }
}
