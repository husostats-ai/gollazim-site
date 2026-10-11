/** Arama anahtarı: küçük harf, aksansız; "İ / I / ı" hep "i" (ör. "Başakşehir" -> "basaksehir") */
export function foldText(text: string): string {
  return text
    .replace(/[İIı]/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Yazılan her kelime etikette geçiyorsa eşleşir; boş arama her şeyi getirir */
export function matchesSearch(label: string, query: string): boolean {
  const target = foldText(label)
  return foldText(query)
    .split(' ')
    .every((word) => target.includes(word))
}
