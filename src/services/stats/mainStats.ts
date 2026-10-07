import type { CategoryId } from '../../config/categories'
import { MAIN_CATEGORY_IDS } from '../../config/mainCategories'
import type { Pick } from '../../types'
import { buildStats, type Tally } from './statsEngine'

/** Ana kategorilerin (config/mainCategories) toplu başarısı */
export interface MainStats {
  /** Kapsanan kategoriler, sabit listedeki sırayla */
  categories: CategoryId[]
  overall: Tally
  /** Benzersiz maç sayıları; kural genel başarıdaki ile aynıdır */
  matches: { total: number; decided: number }
}

/**
 * Önerilerden yalnızca ana kategorilerdekileri alır ve genel başarıyla AYNI hesabı
 * (buildStats) bu alt kümeye uygular. Kategori seçimi sonuçlara bakmaz.
 */
export function buildMainStats(picks: Pick[]): MainStats {
  const ids: readonly CategoryId[] = MAIN_CATEGORY_IDS
  const stats = buildStats(picks.filter((p) => ids.includes(p.categoryId)))
  return { categories: [...ids], overall: stats.overall, matches: stats.matches }
}
