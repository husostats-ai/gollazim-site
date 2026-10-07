import type { CategoryId } from './categories'

/**
 * İstatistik sayfasının en üstündeki "Ana kategoriler başarısı" kartının kapsadığı kategoriler.
 * SABİT listedir: sonuçlara göre seçilmez, "en iyi" kategoriler hesaplanmaz. Değiştirmek için
 * bu satır elle düzenlenir. Diğer bütün kartlar ve "Analiz için özet" tüm kategorileri kullanır.
 */
export const MAIN_CATEGORY_IDS = ['over25', 'btts', 'ht05'] as const satisfies readonly CategoryId[]
