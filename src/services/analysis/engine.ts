import { CATEGORIES, getCategory, MAX_MATCHES_PER_CATEGORY, type CategoryId } from '../../config/categories'
import type { FieldKey } from '../../config/columnAliases'
import type { Match, Thresholds } from '../../types'
import { CALCULATORS } from './calculators'
import { cautiousPercent } from './cautious'
import { starsFor } from './confidence'
import { assessReliability, UNMEASURED } from './reliability'
import type { CategoryAnalysis, Prediction, SortMode } from './types'

/**
 * Yüzde yüksekten düşüğe. Eşit yüzdelerde örneklemi büyük olan
 * (daha güvenilir veri) öne geçer, sonra erken başlayan maç.
 */
const byPercent = (a: Prediction, b: Prediction): number =>
  b.percent - a.percent ||
  (b.reliability.sampleSize ?? 0) - (a.reliability.sampleSize ?? 0) ||
  (a.match.time ?? '').localeCompare(b.match.time ?? '') ||
  a.match.id.localeCompare(b.match.id)

/** Temkinli yüzde yüksekten düşüğe; temkinli yüzdesi olmayanlar sona, kendi içinde yüzdeye göre. */
const byCautious = (a: Prediction, b: Prediction): number =>
  (b.cautiousPercent ?? -1) - (a.cautiousPercent ?? -1) || byPercent(a, b)

export const comparePredictions = (sortMode: SortMode) => (sortMode === 'cautious' ? byCautious : byPercent)

export function analyzeCategory(
  matches: Match[],
  categoryId: CategoryId,
  threshold: number,
  sortMode: SortMode = 'percent',
): CategoryAnalysis {
  const calculator = CALCULATORS[categoryId]
  const { starSteps, sampleUnmeasured } = getCategory(categoryId)
  const qualified: Prediction[] = []
  const missing = new Set<FieldKey>()
  let evaluatedCount = 0

  for (const match of matches) {
    const result = calculator.calculate(match)
    if (!result.ok) {
      result.missing.forEach((f) => missing.add(f))
      continue
    }
    evaluatedCount++
    // Eşik her iki sıralamada da ham yüzdeye uygulanır.
    if (result.percent < threshold) continue
    const extras = result.extras ?? {}
    const reliability = extras.reliability ?? (sampleUnmeasured ? UNMEASURED : assessReliability(match))
    qualified.push({
      match,
      categoryId,
      percent: result.percent,
      cautiousPercent: cautiousPercent(result.percent, reliability.sampleSize),
      stars: Math.min(starsFor(result.percent, reliability.level, starSteps), extras.maxStars ?? 5),
      reliability,
      basis: extras.basis ?? calculator.basis,
      secondPercent: extras.secondPercent,
      secondLabel: extras.secondLabel ?? 'xG modeli',
      conflict: extras.conflict,
      notes: extras.notes ?? [],
    })
  }

  qualified.sort(comparePredictions(sortMode))
  return {
    categoryId,
    threshold,
    sortMode,
    predictions: qualified.slice(0, MAX_MATCHES_PER_CATEGORY),
    qualifiedCount: qualified.length,
    evaluatedCount,
    unavailableCount: matches.length - evaluatedCount,
    missingFields: [...missing],
  }
}

export type DayAnalysis = Record<CategoryId, CategoryAnalysis>

/** Bir günün maçlarını tüm kategoriler için analiz eder. */
export function analyzeDay(matches: Match[], thresholds: Thresholds, sortMode: SortMode = 'percent'): DayAnalysis {
  return Object.fromEntries(
    CATEGORIES.map((c) => [c.id, analyzeCategory(matches, c.id, thresholds[c.id] ?? c.defaultThreshold, sortMode)]),
  ) as DayAnalysis
}
