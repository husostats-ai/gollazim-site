import type { CategoryId } from '../../config/categories'
import type { MatchResult, PickOutcome } from '../../types'

type Settled = Exclude<PickOutcome, 'pending'>
type Evaluator = (result: MatchResult) => Settled

const sum = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a + b)

/** Toplam, çizginin üstündeyse kazandı; veri girilmemişse değerlendirilemedi. */
const over = (total: number | null, line: number): Settled =>
  total === null ? 'void' : total > line ? 'won' : 'lost'

const fullTimeOver = (line: number): Evaluator => (r) => over(sum(r.ftHome, r.ftAway), line)
const firstHalfOver = (line: number): Evaluator => (r) => over(sum(r.htHome, r.htAway), line)
const cornersOver = (line: number): Evaluator => (r) => over(sum(r.cornersHome, r.cornersAway), line)
const cardsOver = (line: number): Evaluator => (r) => over(sum(r.cardsHome, r.cardsAway), line)

/** İkinci yarı golleri = maç skoru - ilk yarı skoru */
export const secondHalfGoals = (r: MatchResult): number | null => {
  const fullTime = sum(r.ftHome, r.ftAway)
  const halfTime = sum(r.htHome, r.htAway)
  return fullTime === null || halfTime === null ? null : fullTime - halfTime
}

const bothScored: Evaluator = (r) =>
  r.ftHome === null || r.ftAway === null ? 'void' : r.ftHome >= 1 && r.ftAway >= 1 ? 'won' : 'lost'

const all =
  (...evaluators: Evaluator[]): Evaluator =>
  (r) => {
    const outcomes = evaluators.map((e) => e(r))
    if (outcomes.includes('void')) return 'void'
    return outcomes.every((o) => o === 'won') ? 'won' : 'lost'
  }

/**
 * Taraf kazanır & gol üstü: seçilen taraf rakibinden fazla gol atmalı VE
 * toplam gol çizginin üstünde olmalı. Beraberlik kaybettirir.
 */
const sideWinsAndOver =
  (side: 'home' | 'away', line: number): Evaluator =>
  (r) => {
    if (r.ftHome === null || r.ftAway === null) return 'void'
    const sideWon = side === 'home' ? r.ftHome > r.ftAway : r.ftAway > r.ftHome
    return sideWon && r.ftHome + r.ftAway > line ? 'won' : 'lost'
  }

// Her kategorinin gerçek skora göre kazanma kuralı.
const EVALUATORS: Record<CategoryId, Evaluator> = {
  over25: fullTimeOver(2.5),
  ht05: firstHalfOver(0.5),
  btts: bothScored,
  over25btts: all(fullTimeOver(2.5), bothScored),
  sh05: (r) => over(secondHalfGoals(r), 0.5),
  over35: fullTimeOver(3.5),
  over45: fullTimeOver(4.5),
  ht15: firstHalfOver(1.5),
  corners85: cornersOver(8.5),
  corners95: cornersOver(9.5),
  corners105: cornersOver(10.5),
  cards35: cardsOver(3.5),
  cards45: cardsOver(4.5),
  homeWin15: sideWinsAndOver('home', 1.5),
  homeWin25: sideWinsAndOver('home', 2.5),
  awayWin15: sideWinsAndOver('away', 1.5),
  awayWin25: sideWinsAndOver('away', 2.5),
}

/**
 * Bir önerinin sonucunu verir. Maç "tamamlandı" değilse (bitmedi, ertelendi,
 * iptal) sonuç pending kalır ve istatistiğe girmez.
 */
export const evaluatePick = (categoryId: CategoryId, result: MatchResult): PickOutcome =>
  result.status === 'completed' ? EVALUATORS[categoryId](result) : 'pending'

export const OUTCOME_LABELS: Record<PickOutcome, string> = {
  won: 'KAZANDI ✅',
  lost: 'KAYBETTİ ❌',
  void: 'DEĞERLENDİRİLEMEDİ',
  pending: 'BEKLİYOR',
}
