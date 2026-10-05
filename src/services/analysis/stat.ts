import { COLUMN_ALIASES, type FieldKey } from '../../config/columnAliases'
import type { Match } from '../../types'

/**
 * Maçın sayısal istatistiği; yoksa veya sayı değilse null. Alan, kolon
 * eşlemesine sonradan eklendiyse eski yüklemelerde değer hâlâ CSV'deki kolon
 * adıyla saklıdır; o yüzden takma adlara da bakılır.
 */
export const stat = (match: Match, field: FieldKey): number | null => {
  const keys: readonly string[] = [field, ...COLUMN_ALIASES[field]]
  for (const key of keys) {
    const value = match.stats[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}
