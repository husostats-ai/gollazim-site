// Üye sayfasının üstünde gösterilen, Admin panelinden düzenlenebilen metinler.
// Story görsellerinin metinlerinden (storyTexts.ts) bilerek ayrıdır: buradaki
// değişiklik görselleri etkilemez.

export interface MemberTexts {
  /** Yasal uyarı */
  disclaimer: string
  /** Hesabın kişiye özel olduğu notu */
  account: string
}

export const DEFAULT_MEMBER_TEXTS: MemberTexts = {
  disclaimer: 'Bu bir istatistik taramasıdır; bahis tavsiyesi değildir ve sonuç garantisi vermez. 18+',
  account: 'Hesap kişiye özeldir, paylaşılamaz.',
}

export const MEMBER_TEXT_FIELDS: { key: keyof MemberTexts; label: string; maxLength: number }[] = [
  { key: 'disclaimer', label: 'Yasal uyarı', maxLength: 200 },
  { key: 'account', label: 'Hesap notu', maxLength: 200 },
]

/** Kayıtlı değeri varsayılanlarla tamamlar; eksik, boş ya da metin olmayan alan varsayılanı alır. */
export function normalizeMemberTexts(saved: unknown): MemberTexts {
  const source = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {}
  const texts = { ...DEFAULT_MEMBER_TEXTS }
  for (const { key, maxLength } of MEMBER_TEXT_FIELDS) {
    const value = source[key]
    // Uyarı metinleri boş bırakılamaz: boş kayıt varsayılana döner.
    if (typeof value === 'string' && value.trim() !== '') texts[key] = value.trim().slice(0, maxLength)
  }
  return texts
}
