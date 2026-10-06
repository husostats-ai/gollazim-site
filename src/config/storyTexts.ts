// Günlük başarı görselinin altındaki, Admin panelinden düzenlenebilen metinler.
// Boş bırakılan metnin satırı görselde hiç çizilmez.

export interface StoryTexts {
  /** Telegram bağlantısı */
  telegram: string
  /** Instagram kullanıcı adı */
  instagram: string
  /** En alttaki küçük uyarı */
  disclaimer: string
}

export const DEFAULT_STORY_TEXTS: StoryTexts = {
  telegram: 'https://t.me/gollazimanaliz',
  instagram: '@gollazim',
  disclaimer: 'Bu bir istatistik taramasıdır; bahis tavsiyesi değildir ve sonuç garantisi vermez. 18+',
}

export const STORY_TEXT_FIELDS: { key: keyof StoryTexts; label: string; maxLength: number }[] = [
  { key: 'telegram', label: 'Telegram bağlantısı', maxLength: 80 },
  { key: 'instagram', label: 'Instagram kullanıcı adı', maxLength: 40 },
  { key: 'disclaimer', label: 'Uyarı metni', maxLength: 160 },
]

/**
 * Kayıtlı değeri varsayılanlarla tamamlar. Kayıtlı boş metin korunur ("bu satırı
 * çizme" demektir); eksik ya da metin olmayan alan varsayılanı alır.
 */
export function normalizeStoryTexts(saved: unknown): StoryTexts {
  const source = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {}
  const texts = { ...DEFAULT_STORY_TEXTS }
  for (const { key, maxLength } of STORY_TEXT_FIELDS) {
    const value = source[key]
    if (typeof value === 'string') texts[key] = value.trim().slice(0, maxLength)
  }
  return texts
}
