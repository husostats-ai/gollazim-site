import type { Pick } from '../../types'

// Referans dökümünün biçimi: aynı veri her zaman aynı metni verir.

/** Kayıtta hiç bulunmayan alanın dökümdeki karşılığı; null ve 'none' değerlerinden ayrıdır */
export const ABSENT = '«alan yok»'

export const PICK_FIELDS: (keyof Pick)[] = [
  'id',
  'matchId',
  'categoryId',
  'date',
  'percent',
  'threshold',
  'outcome',
  'frozenAt',
  'reliability',
  'conflict',
  'secondPercent',
  'marketPercent',
  'marketConflict',
  'stars',
  'modelDrift',
]

/** Anahtarları sıralı, girintili JSON. Olmayan alan yazılmaz; null ve 'none' olduğu gibi kalır. */
export const canonical = (value: unknown): string =>
  JSON.stringify(
    value,
    (_, v: unknown) =>
      v !== null && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : v,
    1,
  ) + '\n'

/**
 * Dondurulmuş önerinin dökümü: kayıtlı alanlar aynen, kayıtta olmayan alan ABSENT.
 * Bilinmeyen bir alan varsa hata verir ki yeni eklenen alan dökümden sessizce düşmesin.
 */
export function pickRecord(pick: Pick): Record<string, unknown> {
  const known = new Set<string>(PICK_FIELDS)
  const extra = Object.keys(pick).filter((k) => !known.has(k))
  if (extra.length > 0) throw new Error(`Öneride bilinmeyen alan: ${extra.join(', ')}`)
  return Object.fromEntries(PICK_FIELDS.map((k) => [k, k in pick ? pick[k] : ABSENT]))
}
