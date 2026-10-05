import { DEFAULT_STAR_STEPS, type StarSteps } from '../../config/categories'
import type { ReliabilityLevel } from './types'

/** Küçük örneklemden gelen yüksek yüzdeler tam yıldız alamaz */
const MAX_STARS_BY_RELIABILITY: Record<ReliabilityLevel, number> = {
  high: 5,
  medium: 4,
  low: 3,
  unknown: 3,
  unmeasured: 3,
  // Orana dayanan yüzdelerde örneklem sınırı yoktur; sınırlar hesaplayıcıdan gelir.
  market: 5,
  'market-partial': 5,
}

export const starsFor = (
  percent: number,
  reliability: ReliabilityLevel,
  steps: StarSteps = DEFAULT_STAR_STEPS,
): number => {
  const index = steps.findIndex((min) => percent >= min)
  const byPercent = index === -1 ? 1 : 5 - index
  return Math.min(byPercent, MAX_STARS_BY_RELIABILITY[reliability])
}
