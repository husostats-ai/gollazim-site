import { poissonPmf } from '../poisson'

// Skor modeli: ev ve deplasman golleri bağımsız Poisson kabul edilir.
// Tüm olasılıklar skor tablosunun (i-j) hücreleri toplanarak bulunur;
// "taraf kazanır" ile "üst" yüzdeleri hiçbir yerde birbiriyle çarpılmaz.

const MAX_GOALS = 15

export type Side = 'home' | 'away'

export interface OutcomeProbs {
  home: number
  draw: number
  away: number
}

const pmfs = (lambda: number): number[] => Array.from({ length: MAX_GOALS + 1 }, (_, k) => poissonPmf(k, lambda))

/** Skor tablosunda koşulu sağlayan hücrelerin toplam olasılığı */
export function scoreProbability(
  homeGoals: number,
  awayGoals: number,
  matches: (home: number, away: number) => boolean,
): number {
  const h = pmfs(homeGoals)
  const a = pmfs(awayGoals)
  let total = 0
  for (let i = 0; i <= MAX_GOALS; i++) for (let j = 0; j <= MAX_GOALS; j++) if (matches(i, j)) total += h[i] * a[j]
  return total
}

export const outcomeProbs = (homeGoals: number, awayGoals: number): OutcomeProbs => ({
  home: scoreProbability(homeGoals, awayGoals, (i, j) => i > j),
  draw: scoreProbability(homeGoals, awayGoals, (i, j) => i === j),
  away: scoreProbability(homeGoals, awayGoals, (i, j) => i < j),
})

/** P(seçilen taraf kazanır VE toplam gol >= minGoals) */
export const sideWinsAndGoals = (homeGoals: number, awayGoals: number, side: Side, minGoals: number): number =>
  scoreProbability(homeGoals, awayGoals, (i, j) => (side === 'home' ? i > j : j > i) && i + j >= minGoals)
