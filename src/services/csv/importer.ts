import { FIELD_LABELS, TEXT_FIELDS, type FieldKey } from '../../config/columnAliases'
import type { Match, StatValue } from '../../types'
import { mapColumns } from './columnMapper'
import { parseMatchDate } from './dateParser'
import { CsvError, parseCsv } from './parser'
import { isNumeric, normalizeHeader, parseNumber, parseText } from './values'

export interface CsvImportResult {
  matches: Match[]
  /** Atlanan satırlar ve benzeri uyarılar; kullanıcıya gösterilir */
  warnings: string[]
  /** CSV'de bulunamayan alanlar; ilgili analizler "veri yok" olur */
  missingFields: FieldKey[]
  totalRows: number
}

export const buildMatchId = (date: string, home: string, away: string): string =>
  [date, normalizeHeader(home), normalizeHeader(away)].join('|')

/** CSV metnini maç kayıtlarına çevirir. Zorunlu kolonlar yoksa CsvError fırlatır. */
export function importCsv(text: string, uploadId: string): CsvImportResult {
  const { headers, rows } = parseCsv(text)
  const { fieldToHeader, missingFields, unmappedHeaders } = mapColumns(headers)

  const requiredMissing = (['home', 'away'] as const).filter((f) => !fieldToHeader[f])
  if (requiredMissing.length > 0) {
    throw new CsvError(
      `CSV'de zorunlu kolon bulunamadı: ${requiredMissing.map((f) => FIELD_LABELS[f]).join(', ')}.`,
    )
  }
  if (!fieldToHeader.dateUnix && !fieldToHeader.dateText) {
    throw new CsvError("CSV'de maç tarihi kolonu bulunamadı.")
  }

  const cell = (row: Record<string, string>, field: FieldKey) => {
    const header = fieldToHeader[field]
    return header ? row[header] : undefined
  }

  const byId = new Map<string, Match>()
  const warnings: string[] = []

  rows.forEach((row, index) => {
    const line = index + 2
    const home = parseText(cell(row, 'home'))
    const away = parseText(cell(row, 'away'))
    if (!home || !away) {
      warnings.push(`Satır ${line}: takım adı eksik, satır atlandı.`)
      return
    }
    const when = parseMatchDate({
      dateUnix: cell(row, 'dateUnix'),
      dateText: cell(row, 'dateText'),
      time: cell(row, 'time'),
    })
    if (!when) {
      warnings.push(`Satır ${line} (${home} - ${away}): tarih okunamadı, satır atlandı.`)
      return
    }

    const stats: Record<string, StatValue> = {}
    for (const [field, header] of Object.entries(fieldToHeader) as [FieldKey, string][]) {
      stats[field] = TEXT_FIELDS.includes(field) ? parseText(row[header]) : parseNumber(row[header])
    }
    // Tanınmayan kolonlar atılmaz: sayıysa sayı, değilse metin olarak saklanır.
    for (const header of unmappedHeaders) {
      stats[header] = isNumeric(row[header]) ? parseNumber(row[header]) : parseText(row[header])
    }

    const id = buildMatchId(when.date, home, away)
    if (byId.has(id)) warnings.push(`Satır ${line} (${home} - ${away}): aynı maç dosyada tekrar ediyor, son satır kullanıldı.`)
    const country = parseText(cell(row, 'country'))
    const league = parseText(cell(row, 'league'))
    byId.set(id, {
      id,
      uploadId,
      date: when.date,
      time: when.time,
      league: [country, league].filter(Boolean).join(' · ') || undefined,
      home,
      away,
      stats,
    })
  })

  if (byId.size === 0) throw new CsvError('CSV dosyasından okunabilir maç çıkmadı.')
  return { matches: [...byId.values()], warnings, missingFields, totalRows: rows.length }
}
