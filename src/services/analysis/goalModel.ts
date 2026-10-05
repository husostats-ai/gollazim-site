import type { CategoryId } from '../../config/categories'
import type { Match } from '../../types'
import { poissonAtLeast } from './poisson'
import { stat } from './stat'

// Ana gol kategorileri için ikinci hesap: xG / gol ortalamasından Poisson.
// FootyStats'ın hazır yüzdesinin yerine geçmez; yanında gösterilir.

/** Model yüzdesi üretilen kategoriler ve toplam gol alt sınırları (KG Var hariç) */
const MIN_GOALS: Partial<Record<CategoryId, number>> = { over25: 3, over35: 4, over45: 5 }

/** Hazır yüzde ile model yüzdesi arasındaki fark bu puanı aşarsa "model çelişkisi" sayılır */
export const MODEL_CONFLICT_LIMIT = 25

/** Çelişkide yıldız üst sınırı; yalnızca örneklem güvenilirliği orta veya yüksekse uygulanır */
export const MODEL_CONFLICT_MAX_STARS = 3

export type GoalModelSource =
  /** Maç öncesi xG toplamı */
  | 'xg'
  /** xG yok: maç başı gol ortalaması */
  | 'avgGoals'

export interface GoalModelResult {
  /** 0-100, tam sayı */
  percent: number
  source: GoalModelSource
}

export const hasGoalModel = (categoryId: CategoryId): boolean => categoryId === 'btts' || categoryId in MIN_GOALS

/** İki takımın da geçerli (pozitif) xG değeri varsa döner; 0 "veri yok" sayılır */
const xgPair = (match: Match): { home: number; away: number } | null => {
  const home = stat(match, 'homeXg')
  const away = stat(match, 'awayXg')
  return home !== null && away !== null && home > 0 && away > 0 ? { home, away } : null
}

/**
 * Beklenen toplam gol: xG toplamı; xG yoksa ya da geçersizse gol ortalaması.
 * İkisi de yoksa null.
 */
export function expectedTotalGoals(match: Match): { total: number; source: GoalModelSource } | null {
  const xg = xgPair(match)
  if (xg) return { total: xg.home + xg.away, source: 'xg' }
  const avgGoals = stat(match, 'avgGoals')
  return avgGoals !== null && avgGoals > 0 ? { total: avgGoals, source: 'avgGoals' } : null
}

/**
 * Kategorinin model yüzdesi. Hesaplanamıyorsa null döner (maç yine de hazır
 * yüzdeyle listelenir).
 * - 2.5 / 3.5 / 4.5 Üst: toplam gol Poisson dağılır kabul edilir.
 * - KG Var: iki takımın gol atma olasılıkları bağımsız Poisson kabul edilir;
 *   takım bazında beklenti gerektiği için yalnızca xG varken hesaplanır.
 */
export function goalModelPercent(match: Match, categoryId: CategoryId): GoalModelResult | null {
  if (categoryId === 'btts') {
    const xg = xgPair(match)
    if (!xg) return null
    const bothScore = (1 - Math.exp(-xg.home)) * (1 - Math.exp(-xg.away))
    return { percent: Math.round(bothScore * 100), source: 'xg' }
  }
  const minGoals = MIN_GOALS[categoryId]
  if (minGoals === undefined) return null
  const expected = expectedTotalGoals(match)
  if (!expected) return null
  return { percent: Math.round(poissonAtLeast(minGoals, expected.total) * 100), source: expected.source }
}
