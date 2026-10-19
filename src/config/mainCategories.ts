import type { CategoryId } from './categories'

/**
 * İstatistiklerin ana kategorileri. SABİT listedir: sonuçlara göre seçilmez, "en iyi" kategoriler
 * hesaplanmaz. Değiştirmek için bu satır elle düzenlenir. İstatistik sayfasındaki (admin ve üye)
 * bölümler ile "Analiz için özet" yalnızca bu kategorileri sayar; tek istisna "Kategori bazlı
 * başarı"dır, orada tüm kategoriler gösterilir. Kayıtlar silinmez, yalnızca gösterim süzülür.
 */
export const MAIN_CATEGORY_IDS = ['over25', 'btts', 'ht05'] as const satisfies readonly CategoryId[]

export const isMainCategory = (id: CategoryId): boolean => (MAIN_CATEGORY_IDS as readonly CategoryId[]).includes(id)

/** İstatistik bölümlerinin ortak filtresi: yalnızca ana kategorilerdeki kayıtlar (öneri, sıra vb.) */
export const onlyMainCategories = <T extends { categoryId: CategoryId }>(rows: readonly T[]): T[] => rows.filter((r) => isMainCategory(r.categoryId))

/** Ana kategorilerle sınırlı bölümlerin açıklamasına ve özetin "Kapsam" satırına eklenen cümle */
export const MAIN_SCOPE_NOTE = "Bu bölümler yalnızca 2.5 ÜST, KG VAR ve İLK YARI 0.5 ÜST'ü kapsar; diğer kategoriler yalnızca Kategori bazlı başarı'da gösterilir."
