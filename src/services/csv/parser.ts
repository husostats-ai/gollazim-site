import Papa from 'papaparse'

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
}

export class CsvError extends Error {}

/** Ham CSV metnini başlık + satırlara çevirir; ayırıcıyı (virgül, noktalı virgül, sekme) kendisi bulur. */
export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })
  const headers = (result.meta.fields ?? []).filter((h) => h !== '')
  if (headers.length === 0) throw new CsvError('CSV dosyasında başlık satırı bulunamadı.')
  if (result.data.length === 0) throw new CsvError('CSV dosyasında maç satırı bulunamadı.')
  return { headers, rows: result.data }
}
