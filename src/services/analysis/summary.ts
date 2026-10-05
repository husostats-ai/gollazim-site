import { getCategory, type CategoryId } from '../../config/categories'
import type { Match } from '../../types'
import { formatNumber } from '../../utils/format'
import { stat } from './stat'

export interface SummaryItem {
  label: string
  value: string
}

/** Kartta gösterilen kısa istatistik özeti; CSV'de olmayan değer listeye girmez. */
export function statSummary(match: Match, categoryId: CategoryId): SummaryItem[] {
  const items: SummaryItem[] = []
  const add = (label: string, value: number | null, suffix = '') => {
    if (value !== null) items.push({ label, value: formatNumber(value) + suffix })
  }
  const group = getCategory(categoryId).group

  if (group === 'corners') {
    add('Korner ort.', stat(match, 'avgCorners'))
  } else if (group === 'cards') {
    add('Kart ort.', stat(match, 'avgCards'))
  } else {
    add('Gol ort.', stat(match, 'avgGoals'))
    const homeXg = stat(match, 'homeXg')
    const awayXg = stat(match, 'awayXg')
    if (homeXg !== null && awayXg !== null) {
      items.push({ label: 'xG', value: `${formatNumber(homeXg)} – ${formatNumber(awayXg)}` })
    }
    if (categoryId === 'over25btts') {
      add('2.5 Üst', stat(match, 'over25Pct'), '%')
      add('KG Var', stat(match, 'bttsPct'), '%')
    }
  }
  return items
}
