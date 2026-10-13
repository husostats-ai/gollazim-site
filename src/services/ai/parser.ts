import { AI_CATEGORY_IDS, AI_DECISIONS, type AiDecision } from '../../config/ai'
import { getCategory, type CategoryId } from '../../config/categories'
import type { ScoreLine } from '../../types'

export interface ParsedVerdict {
  number: number
  matchId: string
  /** Sorulan kategorilerden kararı okunabilenler */
  decisions: Partial<Record<CategoryId, AiDecision>>
  /** Bu maç için sorulan kategoriler */
  asked: CategoryId[]
  /** Sorulan ama cevapta karşılığı olmayan (ya da okunamayan) kategoriler: o yapay zekâ bu kategoride "cevapsız" */
  unanswered: CategoryId[]
  /** Satır kaydedilir ama dikkat gerektirir: sorulmayan kategoriye verilen karar, okunamayan parça */
  warnings: string[]
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

/** Okunamayan bir maçın kısa nedeni */
export type ParseErrorCause = 'noNumber' | 'fields' | 'unknownNumber' | 'oldFormat' | 'category' | 'decision' | 'notAsked' | 'emptyReason' | 'duplicate'

export const PARSE_ERROR_CAUSE_LABELS: Record<ParseErrorCause, string> = {
  noNumber: 'maç numarasıyla başlamıyor',
  fields: 'alan sayısı yanlış',
  unknownNumber: 'numara listede yok',
  oldFormat: 'eski biçim',
  category: 'kategori tanınmadı',
  decision: 'karar kelimesi geçersiz',
  notAsked: 'kategori bu maç için sorulmadı',
  emptyReason: 'gerekçe boş',
  duplicate: 'aynı numara iki kez',
}

export interface DetailedParseError extends ParseError {
  cause: ParseErrorCause
  /** Okunabildiyse maç numarası */
  number?: number
}

export interface DetailedParseResult extends ParseResult {
  errors: DetailedParseError[]
  /** Sorulmayan kategoriye yazıldığı için yok sayılan karar sayısı (okunan maçlarda) */
  skipped: number
}

const normalize = (text: string): string =>
  text
    .replace(/[İIı]/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

const DECISION_BY_LABEL = new Map<string, AiDecision>(AI_DECISIONS.map((d) => [normalize(d.label), d.id]))

/**
 * Atıf ve kaynak işaretlerini siler: ChatGPT'nin 【…】 ve görünmez atıf belirteçleri, "[1]" / "[1, 2]" / "[^1]",
 * üst simge rakamlar, çıplak adresler; "[metin](adres)" yalnızca "metin" olarak kalır. "(QSL)" gibi düz
 * parantezli kaynak adına dokunmaz. Atıf içermeyen metin olduğu gibi döner.
 */
function stripCitations(text: string): string {
  const stripped = text
    .replace(/\uE200[^\uE201]*\uE201/g, '')
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/【[^】]*】/g, '')
    .replace(/\[([^\]]*)\]\(\s*https?:\/\/[^)\s]*\s*\)/g, '$1')
    .replace(/\[\^?\d+(?:\s*[,;–-]\s*\d+)*\]/g, '')
    .replace(/[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]/g, '')
    .replace(/\(\s*https?:\/\/[^\s|)]*\s*\)|https?:\/\/[^\s|)]+/g, '')
  if (stripped === text) return text
  return stripped
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,;])/g, '$1')
}

/** Atıf işaretlerini, kalın yazı, kod işareti, madde imi ve tablo kenar çizgilerini temizler */
const clean = (line: string): string =>
  stripCitations(line)
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

type DetailedLineResult =
  | { kind: 'verdict'; verdict: ParsedVerdict; skipped: number }
  | { kind: 'error'; message: string; cause: ParseErrorCause; number?: number }
  | { kind: 'ignored' }

/** Kategori adını karşılaştırmak için: küçük harf, aksansız, yalnızca harf ve rakam ("2,5 Üst & KG Var" -> "25ustkgvar") */
const categoryKey = (text: string): string => normalize(text).replace(/[^a-z0-9]/g, '')

/** Yazılışa göre kategori. Ad prompttaki etikettir; "ve" ile yazılan "&" ve "İY" kısaltması da tanınır. */
const CATEGORY_BY_NAME = new Map<string, CategoryId>(
  AI_CATEGORY_IDS.flatMap((id): [string, CategoryId][] => {
    const key = categoryKey(getCategory(id).label)
    return [
      [key, id],
      [categoryKey(getCategory(id).label.replace('&', ' ve ')), id],
      [key.replace('ilkyari', 'iy'), id],
    ]
  }),
)

export const OLD_FORMAT_MESSAGE = 'Eski biçim; promptu yeniden kopyalayın. (Karar artık kategori bazında yazılır: “2.5 ÜST: Orta ; KG VAR: Zayıf”.)'

/** Kararlar alanını ("2.5 ÜST: Orta ; KG VAR: Zayıf") sorulan kategorilere göre çözer */
function parseDecisions(
  field: string,
  asked: readonly CategoryId[],
  number: number,
): { parsed: Pick<ParsedVerdict, 'decisions' | 'unanswered' | 'warnings'>; skipped: number; badDecision: boolean } {
  const decisions: Partial<Record<CategoryId, AiDecision>> = {}
  const warnings: string[] = []
  let skipped = 0
  let badDecision = false
  for (const raw of field.split(';')) {
    const part = raw.trim()
    if (part === '') continue
    const colon = part.lastIndexOf(':')
    const name = colon < 0 ? part : part.slice(0, colon).trim()
    const categoryId = CATEGORY_BY_NAME.get(categoryKey(name))
    if (colon < 0 || !categoryId) {
      warnings.push(`#${number}: “${part}” okunamadı (kategori adı tanınmadı); bu parça kaydedilmedi.`)
      continue
    }
    const label = getCategory(categoryId).label
    const decision = DECISION_BY_LABEL.get(normalize(part.slice(colon + 1)))
    if (!asked.includes(categoryId)) {
      warnings.push(`#${number}: ${label} bu maç için sorulmadı; karar yok sayıldı.`)
      skipped++
      continue
    }
    if (!decision) {
      warnings.push(`#${number} ${label}: KARAR tanınmadı (“${part.slice(colon + 1).trim()}”); bu kategori cevapsız sayıldı. Beklenen: ${AI_DECISIONS.map((d) => d.label).join(', ')}.`)
      badDecision = true
      continue
    }
    if (decisions[categoryId] !== undefined) {
      warnings.push(`#${number}: ${label} satırda iki kez geçiyor; ilki kullanıldı.`)
      continue
    }
    decisions[categoryId] = decision
  }
  return { parsed: { decisions, unanswered: asked.filter((id) => decisions[id] === undefined), warnings }, skipped, badDecision }
}

/**
 * Tek bir satırı (tek maçı) çözer. Maç yalnızca numarayla bulunur; takım adına bakılmaz.
 * numbers: numara -> maç kimliği (kopyalanan prompt'taki numaralandırma).
 * asked: numara -> o maç için sorulan kategoriler (prompttaki "Değerlendir" satırı).
 * Hata, kısa nedeni ve (okunabildiyse) maç numarasıyla döner.
 */
export function parseLineDetailed(raw: string, numbers: ReadonlyMap<number, string>, asked: ReadonlyMap<number, readonly CategoryId[]>): DetailedLineResult {
  const line = clean(raw)
  if (line === '') return { kind: 'ignored' }
  // Tablo ayırıcı satırı: |---|---|
  if (/^[\s|:-]+$/.test(line)) return { kind: 'ignored' }

  const fields = line.split('|').map((f) => f.trim())
  const startsWithNumber = /^#?\s*\d+\b/.test(fields[0])
  // Ne numarayla başlıyor ne de alan ayırıcı içeriyor: açıklama cümlesi
  if (!startsWithNumber && fields.length === 1) return { kind: 'ignored' }
  // Biçimin başlık olarak tekrar edilmesi: "#numara | KATEGORİ: KARAR | gerekçe | risk"
  if (!startsWithNumber && fields.length > 1 && /^(karar|kategori)/.test(normalize(fields[1]))) return { kind: 'ignored' }

  const numberMatch = /^#?\s*(\d+)\s*[.)]?$/.exec(fields[0])
  if (!numberMatch) return { kind: 'error', cause: 'noNumber', message: 'Satır maç numarasıyla (#1 gibi) başlamıyor.' }
  const number = Number(numberMatch[1])
  if (fields.length < 4) {
    return { kind: 'error', cause: 'fields', number, message: `4 alan bekleniyor (#numara | KATEGORİ: KARAR ; … | gerekçe | risk), ${fields.length} alan var.` }
  }

  const matchId = numbers.get(number)
  if (!matchId) return { kind: 'error', cause: 'unknownNumber', number, message: `#${number} numaralı bir maç listede yok.` }

  // Kategori bazlı karardan önceki biçim: ikinci alan tek bir karar ("Orta").
  if (DECISION_BY_LABEL.has(normalize(fields[1]))) return { kind: 'error', cause: 'oldFormat', number, message: OLD_FORMAT_MESSAGE }

  const askedHere = [...(asked.get(number) ?? [])]
  const { parsed, skipped, badDecision } = parseDecisions(fields[1], askedHere, number)
  if (Object.keys(parsed.decisions).length === 0) {
    return {
      kind: 'error',
      cause: badDecision ? 'decision' : skipped > 0 ? 'notAsked' : 'category',
      number,
      message: `#${number}: hiçbir kategori kararı okunamadı. Beklenen: ${askedHere.map((id) => `${getCategory(id).label}: KARAR`).join(' ; ')}.${parsed.warnings.length > 0 ? ` ${parsed.warnings.join(' ')}` : ''}`,
    }
  }

  // İsteğe bağlı beşinci alan skor tahminidir. Yalnızca 5 ve üzeri alan varsa ve son alan
  // skora (ya da "skor yok" yazımına) benziyorsa ayrılır.
  let body = fields
  let score: ScoreLine | null = null
  if (fields.length >= 5) {
    const last = fields[fields.length - 1]
    // Skorun ardında kalan parantezli kaynak adı ("SKOR: 2-1 (ESPN)") skoru bozmaz.
    score = parseScore(last.replace(/(?:\s*\([^()]*\))+$/, ''))
    if (score || NO_SCORE_PATTERN.test(normalize(last))) body = fields.slice(0, -1)
  }

  // İlk alan numara, ikinci kararlar, sonuncu risktir; aradaki her şey gerekçedir.
  // Böylece gerekçenin içinde geçen fazladan "|" karakteri satırı bozmaz.
  const reason = body.slice(2, -1).join(' | ').trim()
  if (body.slice(2, -1).every((f) => f === '')) return { kind: 'error', cause: 'emptyReason', number, message: 'Gerekçe boş.' }
  const risk = body[body.length - 1]

  return { kind: 'verdict', verdict: { number, matchId, ...parsed, asked: askedHere, reason, risk, ...(score && { score }) }, skipped }
}

/** parseLineDetailed ile aynı çözüm; hata yalnızca mesajıyla döner. */
export function parseLine(raw: string, numbers: ReadonlyMap<number, string>, asked: ReadonlyMap<number, readonly CategoryId[]>): LineResult {
  const result = parseLineDetailed(raw, numbers, asked)
  if (result.kind === 'verdict') return { kind: 'verdict', verdict: result.verdict }
  if (result.kind === 'error') return { kind: 'error', message: result.message }
  return result
}

/** Tek başına "\r" ve Unicode satır ayırıcıları da satır sonudur */
const LINE_BREAK = /\r\n|\r|\n|\u2028|\u2029/
/** Maç başlangıcı adayı: "#N |" */
const MATCH_MARK = /#\s*(\d+)\s*(?:\*\*|__|`)?\s*\|/g

/** Alan bir kararlar alanına benziyor mu: "KATEGORİ: …", "…: KARAR" ya da tek başına karar kelimesi (eski biçim) */
function looksLikeDecisions(field: string): boolean {
  const text = clean(field)
  if (DECISION_BY_LABEL.has(normalize(text))) return true
  return text.split(';').some((part) => {
    const colon = part.lastIndexOf(':')
    return colon > 0 && (CATEGORY_BY_NAME.has(categoryKey(part.slice(0, colon))) || DECISION_BY_LABEL.has(normalize(part.slice(colon + 1))))
  })
}

/**
 * Satır sonu olmadan art arda yazılmış maçları ayırır. "#N |" ancak N listedeki bir numaraysa ve ardından
 * kararlar alanı geliyorsa (ya da satır orada bitiyorsa) maç başlangıcıdır; gerekçede geçen "#3" bölmez.
 * Satır başındaki işaret sınır değildir: içinde ikinci bir maç bulunmayan satır olduğu gibi döner.
 */
function splitMatches(raw: string, numbers: ReadonlyMap<number, string>): string[] {
  const cuts: number[] = []
  for (const mark of raw.matchAll(MATCH_MARK)) {
    if (!numbers.has(Number(mark[1]))) continue
    if (clean(`${raw.slice(0, mark.index)}x`) === 'x') continue
    const rest = raw.slice(mark.index + mark[0].length)
    if (clean(rest) === '' || looksLikeDecisions(rest.split('|', 1)[0])) cuts.push(mark.index)
  }
  if (cuts.length === 0) return [raw]
  return [0, ...cuts].map((from, i, all) => raw.slice(from, all[i + 1]))
}

/**
 * Yapıştırılan cevabın tamamını çözer; maçlar aynı satıra yazılmış olsa da ayrılır. Aynı numara iki kez
 * gelirse ikincisi hata sayılır. Her hata kısa nedeni ve maç numarasıyla döner.
 */
export function parseAiResponseDetailed(text: string, numbers: ReadonlyMap<number, string>, asked: ReadonlyMap<number, readonly CategoryId[]>): DetailedParseResult {
  const verdicts: ParsedVerdict[] = []
  const errors: DetailedParseError[] = []
  const seen = new Set<number>()
  let ignored = 0
  let skipped = 0

  text.split(LINE_BREAK).forEach((raw, i) => {
    if (raw.trim() === '') return
    for (const part of splitMatches(raw, numbers)) {
      const result = parseLineDetailed(part, numbers, asked)
      if (result.kind === 'ignored') ignored++
      else if (result.kind === 'error') {
        errors.push({ line: i + 1, text: part.trim(), message: result.message, cause: result.cause, ...(result.number !== undefined && { number: result.number }) })
      } else if (seen.has(result.verdict.number)) {
        const { number } = result.verdict
        errors.push({ line: i + 1, text: part.trim(), message: `#${number} cevapta birden fazla kez geçiyor.`, cause: 'duplicate', number })
      } else {
        seen.add(result.verdict.number)
        verdicts.push(result.verdict)
        skipped += result.skipped
      }
    }
  })

  const missing = [...numbers.keys()].filter((n) => !seen.has(n)).sort((a, b) => a - b)
  return { verdicts, errors, ignored, missing, skipped }
}

/** parseAiResponseDetailed ile aynı çözüm; hatalar yalnızca satır, metin ve mesajla döner. */
export function parseAiResponse(text: string, numbers: ReadonlyMap<number, string>, asked: ReadonlyMap<number, readonly CategoryId[]>): ParseResult {
  const { verdicts, errors, ignored, missing } = parseAiResponseDetailed(text, numbers, asked)
  return { verdicts, errors: errors.map(({ line, text: errorText, message }) => ({ line, text: errorText, message })), ignored, missing }
}

/** matchIds[0] = #1 olacak şekilde numara -> maç eşlemesi */
export const numberMap = (matchIds: string[]): Map<number, string> => new Map(matchIds.map((id, i) => [i + 1, id]))

/** categories[0] = #1 olacak şekilde numara -> sorulan kategoriler eşlemesi */
export const askedMap = (categories: readonly (readonly CategoryId[])[]): Map<number, readonly CategoryId[]> => new Map(categories.map((ids, i) => [i + 1, ids]))
