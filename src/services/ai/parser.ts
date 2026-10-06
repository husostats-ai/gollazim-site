import { AI_DECISIONS, type AiDecision } from '../../config/ai'
import type { ScoreLine } from '../../types'

export interface ParsedVerdict {
  number: number
  matchId: string
  decision: AiDecision
  reason: string
  risk: string
  /** İsteğe bağlı skor tahmini; cevapta yoksa alan da yoktur */
  score?: ScoreLine
}

export interface ParseError {
  /** Yapıştırılan metindeki satır numarası (1'den başlar) */
  line: number
  text: string
  message: string
}

export interface ParseResult {
  verdicts: ParsedVerdict[]
  errors: ParseError[]
  /** Karar satırı gibi görünmeyen (açıklama, tablo çizgisi, başlık) ve atlanan satır sayısı */
  ignored: number
  /** Listede olup cevapta karşılığı bulunmayan maç numaraları */
  missing: number[]
}

const normalize = (text: string): string =>
  text
    .replace(/[İIı]/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

const DECISION_BY_LABEL = new Map<string, AiDecision>(AI_DECISIONS.map((d) => [normalize(d.label), d.id]))

/** Kalın yazı, kod işareti, madde imi ve tablo kenar çizgilerini temizler */
const clean = (line: string): string =>
  line
    .replace(/\*\*|__|`/g, '')
    .trim()
    .replace(/^[-*•]\s+/, '')
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .trim()

/** En fazla iki haneli gol sayıları: "2-1", "2:1", "2 - 1", "2–1", "SKOR: 2-1", "Skor tahmini 2-1" */
const SCORE_PATTERN = /^(?:skor(?:\s+tahmini)?\s*[:=]?\s*)?(\d{1,2})\s*[-:–—]\s*(\d{1,2})$/
/** Skor alanının bilerek boş bırakıldığını gösteren yazımlar */
const NO_SCORE_PATTERN = /^(?:skor(?:\s+tahmini)?\s*[:=]?\s*)?(?:|-|–|—|yok|bilinmiyor|belirsiz|n\/a)$/

/** Alan bir skor tahminiyse skoru verir; değilse null */
export function parseScore(field: string): ScoreLine | null {
  const found = SCORE_PATTERN.exec(normalize(field))
  return found ? { home: Number(found[1]), away: Number(found[2]) } : null
}

type LineResult =
  | { kind: 'verdict'; verdict: ParsedVerdict }
  | { kind: 'error'; message: string }
  | { kind: 'ignored' }

/**
 * Tek bir satırı çözer. Maç yalnızca numarayla bulunur; takım adına bakılmaz.
 * numbers: numara -> maç kimliği (kopyalanan prompt'taki numaralandırma).
 */
export function parseLine(raw: string, numbers: ReadonlyMap<number, string>): LineResult {
  const line = clean(raw)
  if (line === '') return { kind: 'ignored' }
  // Tablo ayırıcı satırı: |---|---|
  if (/^[\s|:-]+$/.test(line)) return { kind: 'ignored' }

  const fields = line.split('|').map((f) => f.trim())
  const startsWithNumber = /^#?\s*\d+\b/.test(fields[0])
  // Ne numarayla başlıyor ne de alan ayırıcı içeriyor: açıklama cümlesi
  if (!startsWithNumber && fields.length === 1) return { kind: 'ignored' }
  // Biçimin başlık olarak tekrar edilmesi: "#numara | KARAR | gerekçe | risk"
  if (!startsWithNumber && fields.length > 1 && normalize(fields[1]) === 'karar') return { kind: 'ignored' }

  const numberMatch = /^#?\s*(\d+)\s*[.)]?$/.exec(fields[0])
  if (!numberMatch) return { kind: 'error', message: 'Satır maç numarasıyla (#1 gibi) başlamıyor.' }
  if (fields.length < 4) {
    return { kind: 'error', message: `4 alan bekleniyor (#numara | KARAR | gerekçe | risk), ${fields.length} alan var.` }
  }
  const number = Number(numberMatch[1])
  const matchId = numbers.get(number)
  if (!matchId) return { kind: 'error', message: `#${number} numaralı bir maç listede yok.` }

  const decision = DECISION_BY_LABEL.get(normalize(fields[1]))
  if (!decision) {
    return {
      kind: 'error',
      message: `KARAR tanınmadı: “${fields[1]}”. Beklenen: ${AI_DECISIONS.map((d) => d.label).join(', ')}.`,
    }
  }
  // İsteğe bağlı beşinci alan skor tahminidir. Yalnızca 5 ve üzeri alan varsa ve son alan
  // skora (ya da "skor yok" yazımına) benziyorsa ayrılır; 4 alanlı eski cevaplar aynen okunur.
  let body = fields
  let score: ScoreLine | null = null
  if (fields.length >= 5) {
    const last = fields[fields.length - 1]
    score = parseScore(last)
    if (score || NO_SCORE_PATTERN.test(normalize(last))) body = fields.slice(0, -1)
  }
  // İlk alan numara, ikinci karar, sonuncu risktir; aradaki her şey gerekçedir.
  // Böylece gerekçenin içinde geçen fazladan "|" karakteri satırı bozmaz.
  const reason = body.slice(2, -1).join(' | ').trim()
  if (body.slice(2, -1).every((f) => f === '')) return { kind: 'error', message: 'Gerekçe boş.' }
  const risk = body[body.length - 1]
  return { kind: 'verdict', verdict: { number, matchId, decision, reason, risk, ...(score && { score }) } }
}

/** Yapıştırılan cevabın tamamını çözer. Aynı numara iki kez gelirse ikincisi hata sayılır. */
export function parseAiResponse(text: string, numbers: ReadonlyMap<number, string>): ParseResult {
  const verdicts: ParsedVerdict[] = []
  const errors: ParseError[] = []
  const seen = new Set<number>()
  let ignored = 0

  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === '') return
    const result = parseLine(raw, numbers)
    if (result.kind === 'ignored') ignored++
    else if (result.kind === 'error') errors.push({ line: i + 1, text: raw.trim(), message: result.message })
    else if (seen.has(result.verdict.number)) {
      errors.push({ line: i + 1, text: raw.trim(), message: `#${result.verdict.number} cevapta birden fazla kez geçiyor.` })
    } else {
      seen.add(result.verdict.number)
      verdicts.push(result.verdict)
    }
  })

  const missing = [...numbers.keys()].filter((n) => !seen.has(n)).sort((a, b) => a - b)
  return { verdicts, errors, ignored, missing }
}

/** matchIds[0] = #1 olacak şekilde numara -> maç eşlemesi */
export const numberMap = (matchIds: string[]): Map<number, string> => new Map(matchIds.map((id, i) => [i + 1, id]))
