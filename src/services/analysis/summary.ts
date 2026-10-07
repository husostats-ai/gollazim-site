import { getCategory, type CategoryId } from '../../config/categories'
import type { Match } from '../../types'
import { formatNumber } from '../../utils/format'
import { stat } from './stat'
import { STAT_MISSING_TEXT, usableAvgGoals, usableXg } from './statAvailability'

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
    // Eksik gol ortalaması kaynakta 0 olarak gelir; hesaplar onu kullanmaz, kartta da "0" yazılmaz.
    // Kolon hiç yoksa satır eskisi gibi hiç yazılmaz.
    if (stat(match, 'avgGoals') !== null && usableAvgGoals(match) === null) items.push({ label: 'Gol ort.', value: STAT_MISSING_TEXT })
    else add('Gol ort.', stat(match, 'avgGoals'))
    const homeXg = stat(match, 'homeXg')
    const awayXg = stat(match, 'awayXg')
    if (homeXg !== null && awayXg !== null) {
      // Eksik xG kaynakta 0 olarak gelir; hesaplar onu kullanmaz, kartta da "0 – 0" yazılmaz.
      const xg = usableXg(match)
      items.push({ label: 'xG', value: xg ? `${formatNumber(xg.home)} – ${formatNumber(xg.away)}` : STAT_MISSING_TEXT })
    }
    if (categoryId === 'over25btts') {
      add('2.5 Üst', stat(match, 'over25Pct'), '%')
      add('KG Var', stat(match, 'bttsPct'), '%')
    }
  }
  return items
}
