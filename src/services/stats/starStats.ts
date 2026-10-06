import { CATEGORIES, getCategory, type CategoryId } from '../../config/categories'
import type { Pick } from '../../types'
import { starsFor } from '../analysis/confidence'
import { hasGoalModel, MODEL_CONFLICT_MAX_STARS } from '../analysis/goalModel'
import { tally, type Bucket, type Tally } from './statsEngine'

// Yıldız sayısına göre başarı. Yıldız, dondurma anında öneriye kaydedilir; bu
// özellikten önce dondurulmuş önerilerde kayıt yoktur ve mümkünse yeniden bulunur.

export type StarSource = 'stored' | 'recomputed'

/**
 * Kayıtlı yıldızı olmayan eski önerinin yıldızı: kayıtlı yüzde, güvenilirlik ve
 * model çelişkisinden, analizdeki kuralla (starsFor + çelişki sınırı) bulunur.
 * Taraf & Gol'de yıldız "model piyasadan sapıyor" sınırına da bağlıdır ve eski
 * kayıtlarda bu bilgi olmadığı için null döner; güvenilirliği kayıtlı olmayan öneride de null.
 */
export function recomputeStars(pick: Pick): number | null {
  const category = getCategory(pick.categoryId)
  if (category.group === 'sidegoals' || !pick.reliability) return null
  const stars = starsFor(pick.percent, pick.reliability, category.starSteps)
  const capped = hasGoalModel(pick.categoryId) && pick.conflict === true && (pick.reliability === 'medium' || pick.reliability === 'high')
  return capped ? Math.min(stars, MODEL_CONFLICT_MAX_STARS) : stars
}

const isStars = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5

/** Önerinin yıldızı ve nereden geldiği: kayıttan, ya da (eski kayıtta) yeniden hesaptan. Bulunamıyorsa null. */
export function starsOf(pick: Pick): { stars: number; source: StarSource } | null {
  if (isStars(pick.stars)) return { stars: pick.stars, source: 'stored' }
  const stars = recomputeStars(pick)
  return stars === null ? null : { stars, source: 'recomputed' }
}

/** Dondurulmuş önerinin yıldızı; bulunamıyorsa null */
export const frozenStars = (pick: Pick): number | null => starsOf(pick)?.stars ?? null

export const STAR_LEVELS = [5, 4, 3, 2, 1] as const

export interface StarStats {
  /** 5 yıldızdan 1 yıldıza; anahtar yıldız sayısıdır */
  byStars: Bucket<'5' | '4' | '3' | '2' | '1'>[]
  /** Kayıt defterindeki sırayla, yıldızı bulunan önerisi olan kategoriler */
  byCategory: { key: CategoryId; byStars: Tally[] }[]
  /** Yıldızı kayıtlı olmadığı için yeniden hesaplanan (eski kayıt) öneri sayısı */
  recomputed: number
  /** Yıldızı ne kayıtlı ne de hesaplanabilen öneri sayısı; tablolara girmez */
  missing: number
}

/** Yıldız sayısına göre başarı: tümü ve kategori bazında. */
export function buildStarStats(picks: Pick[]): StarStats {
  const starred = picks.flatMap((pick) => {
    const found = starsOf(pick)
    return found ? [{ pick, ...found }] : []
  })
  const of = (stars: number, categoryId?: CategoryId) =>
    tally(starred.filter((x) => x.stars === stars && (categoryId === undefined || x.pick.categoryId === categoryId)).map((x) => x.pick))
  return {
    byStars: STAR_LEVELS.map((s) => ({ key: String(s) as '5', tally: of(s) })),
    byCategory: CATEGORIES.map((c) => c.id)
      .filter((id) => starred.some((x) => x.pick.categoryId === id))
      .map((id) => ({ key: id, byStars: STAR_LEVELS.map((s) => of(s, id)) })),
    recomputed: starred.filter((x) => x.source === 'recomputed').length,
    missing: picks.length - starred.length,
  }
}

/** "12 öneri yeniden hesaplandı (eski kayıt)"; yeniden hesaplanan yoksa null */
export const recomputedNote = (stats: Pick_<StarStats, 'recomputed'>): string | null =>
  stats.recomputed > 0 ? `${stats.recomputed} öneri yeniden hesaplandı (eski kayıt)` : null

type Pick_<T, K extends keyof T> = { [P in K]: T[P] }
