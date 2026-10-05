import { COLUMN_ALIASES, type FieldKey } from '../../config/columnAliases'
import { normalizeHeader } from './values'

export interface ColumnMap {
  /** alan adı -> CSV'deki gerçek kolon adı */
  fieldToHeader: Partial<Record<FieldKey, string>>
  /** CSV'de bulunamayan alanlar */
  missingFields: FieldKey[]
  /** Hiçbir alana eşlenmeyen kolonlar; ham olarak saklanır */
  unmappedHeaders: string[]
}

export function mapColumns(headers: string[]): ColumnMap {
  const byNormalized = new Map(headers.map((h) => [normalizeHeader(h), h]))
  const fieldToHeader: Partial<Record<FieldKey, string>> = {}
  const missingFields: FieldKey[] = []

  for (const field of Object.keys(COLUMN_ALIASES) as FieldKey[]) {
    const aliases: readonly string[] = COLUMN_ALIASES[field]
    const header = aliases.map((a) => byNormalized.get(normalizeHeader(a))).find((h) => h !== undefined)
    if (header) fieldToHeader[field] = header
    else missingFields.push(field)
  }

  const used = new Set(Object.values(fieldToHeader))
  return { fieldToHeader, missingFields, unmappedHeaders: headers.filter((h) => !used.has(h)) }
}
