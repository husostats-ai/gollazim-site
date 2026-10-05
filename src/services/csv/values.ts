const MISSING_TOKENS = new Set(['', 'n/a', 'na', 'null', 'nan', '-', '--'])

/** Kolon adlarını karşılaştırmak için: küçük harf, aksansız, sadece harf ve rakam */
export const normalizeHeader = (header: string): string =>
  header
    .replace(/[İIı]/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

export const isMissing = (raw: string | undefined | null): boolean =>
  raw == null || MISSING_TOKENS.has(raw.trim().toLowerCase())

export const isNumeric = (raw: string | undefined | null): boolean =>
  raw != null && /^-?\d+([.,]\d+)?%?$/.test(raw.trim())

/**
 * "2,33" ve "2.33" biçimlerini okur. Boş, N/A ve -1 (FootyStats'ın
 * "veri yok" işareti) null döner; sayı olmayan metin de null döner.
 */
export const parseNumber = (raw: string | undefined | null): number | null => {
  if (isMissing(raw)) return null
  if (!isNumeric(raw)) return null
  const value = Number(raw!.trim().replace('%', '').replace(',', '.'))
  return Number.isFinite(value) && value !== -1 ? value : null
}

export const parseText = (raw: string | undefined | null): string | null =>
  isMissing(raw) ? null : raw!.trim()
