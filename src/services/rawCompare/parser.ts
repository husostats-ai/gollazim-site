// "Ham veri karşılaştırma" aracının ayrıştırıcısı: bir yapay zekânın yapıştırılan ham maç verisi
// cevabını satır satır okur. Saf fonksiyonlardır; hiçbir şey kaydetmez, hiçbir değer uydurmaz:
// okunamayan alan null ("bilinmiyor") kalır, anlaşılmayan satır atılmaz, `unparsed` listesine girer.
//
// Satır biçimleri (ayırıcı |):
//   #n | SON | takım | GG.AA.YYYY | rakip | İÇ / DIŞ / bilinmiyor | kendi-rakip | [İY ]kendi-rakip / ? | LİG / KUPA / AVRUPA | kaynak
//   #n | TOPLAM | takım | oynanan N | G-B-M | atılan-yenilen | N puan | lig sırası N | kaynak [| not]
//   #n | H2H | GG.AA.YYYY | ev - dep | e-d | [İY ]e-d / ? | yarışma | kaynak      (ya da  #n | H2H | bilinmiyor)
//   #n | SKOR | …   ve   #n | HABER | …   (olduğu gibi gösterilir)
//   === KAYNAKLAR ===  bloğu:  site | URL | not

export type Venue = 'home' | 'away'
export type Competition = 'league' | 'cup' | 'europe' | 'other'

/** İlk sayı satırın takımına (H2H'de ev sahibine), ikincisi rakibe (deplasmana) aittir */
export interface Score {
  own: number
  opp: number
}

export interface LastRow {
  no: number
  team: string
  /** YYYY-AA-GG; okunamadıysa null */
  date: string | null
  opponent: string
  /** İÇ = home, DIŞ = away; bilinmiyorsa null */
  venue: Venue | null
  ft: Score | null
  /** Devre skoru; "?" ya da bilinmiyorsa null */
  ht: Score | null
  competition: Competition
  /** Yarışma alanında yazan metin */
  competitionText: string
  source: string
  raw: string
}

export interface TotalRow {
  no: number
  team: string
  played: number | null
  won: number | null
  drawn: number | null
  lost: number | null
  goalsFor: number | null
  goalsAgainst: number | null
  points: number | null
  rank: number | null
  source: string
  /** Yapay zekânın satır sonuna düştüğü not ("UYUŞMUYOR", "EKSİK 2 maç", "liste tüm sezonu kapsamıyor"); yoksa null */
  flag: string | null
  raw: string
}

export interface H2HRow {
  no: number
  /** "#n | H2H | bilinmiyor" */
  unknown: boolean
  date: string | null
  home: string
  away: string
  ft: Score | null
  ht: Score | null
  competitionText: string
  source: string
  raw: string
}

export interface NoteRow {
  no: number
  kind: 'SKOR' | 'HABER'
  text: string
}

export interface SourceEntry {
  site: string
  url: string | null
  note: string
}

export interface UnparsedLine {
  /** Yapıştırılan metindeki satır numarası (1'den başlar) */
  line: number
  text: string
  reason: string
}

export interface ParsedAnswer {
  last: LastRow[]
  totals: TotalRow[]
  h2h: H2HRow[]
  notes: NoteRow[]
  sources: SourceEntry[]
  unparsed: UnparsedLine[]
}

const URL = /https?:\/\/[^\s)\]>|]+/i

/** Büyük harf, Türkçe harfler sadeleştirilmiş: "LİG", "Lig" ve "LIG" aynı anahtara düşer */
export const fold = (text: string): string =>
  text
    .toLocaleUpperCase('tr')
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C')
    .trim()

/** Markdown bağlantısını ([x](y)), köşeli parantezleri, kalın / kod işaretlerini temizler */
export function cleanText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_, label: string, target: string) => (label.trim() === '' || URL.test(label) ? target : label))
    .replace(/[[\]]/g, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Alandaki ilk adres; markdown bağlantısında parantez içindeki hedef */
export function extractUrl(text: string): string | null {
  const found = URL.exec(text)
  return found ? found[0].replace(/[.,;]+$/, '') : null
}

const isUnknown = (text: string): boolean => {
  const t = fold(text)
  return t === '' || t === '?' || t === '-' || t === '—' || t.startsWith('BILINMIYOR') || t === 'YOK'
}

/** GG.AA.YYYY (ayırıcı . / - olabilir) -> YYYY-AA-GG; geçersizse null */
export function parseDate(text: string): string | null {
  const found = /(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})/.exec(text)
  if (!found) return null
  const [day, month, year] = [Number(found[1]), Number(found[2]), Number(found[3])]
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** "2-1", "İY 1-0", "(İY 1 – 0)" -> skor; "?" ya da okunamayan değer null */
export function parseScore(text: string): Score | null {
  if (isUnknown(text)) return null
  const found = /^\D*?(\d{1,2})\s*[-–—:]\s*(\d{1,2})\D*$/.exec(text.trim())
  return found ? { own: Number(found[1]), opp: Number(found[2]) } : null
}

function parseVenue(text: string): Venue | null {
  const t = fold(text)
  if (t === 'IC' || t === 'IC SAHA' || t === 'EV') return 'home'
  if (t === 'DIS' || t === 'DIS SAHA' || t === 'DEP' || t === 'DEPLASMAN') return 'away'
  return null
}

function parseCompetition(text: string): Competition {
  const t = fold(text)
  if (t === 'LIG') return 'league'
  if (t === 'KUPA') return 'cup'
  if (t === 'AVRUPA') return 'europe'
  return 'other'
}

/** Alandaki ilk tam sayı; "bilinmiyor" ya da sayı yoksa null */
const firstInt = (text: string): number | null => {
  if (isUnknown(text)) return null
  const found = /\d+/.exec(text)
  return found ? Number(found[0]) : null
}

/** Alandaki tam sayılar ("3-1-0" -> [3, 1, 0]) */
const ints = (text: string): number[] => (isUnknown(text) ? [] : (text.match(/\d+/g) ?? []).map(Number))

/** "ev takım - dep takım": tire boşluklarla ayrılmış olmalı (takım adında tire bulunabilir) */
function splitPair(text: string): [string, string] | null {
  const parts = text.split(/\s+[-–—]\s+|\s+vs\.?\s+/i)
  return parts.length === 2 && parts[0].trim() !== '' && parts[1].trim() !== '' ? [parts[0].trim(), parts[1].trim()] : null
}

const SOURCES_HEADING = /^[=\-#*\s]*KAYNAKLAR[=\-#*:\s]*$/
const SEPARATOR_ONLY = /^[\s=\-_*#|:]*$/

/** Yapıştırılan cevabı ayrıştırır. Aynı metin her zaman aynı sonucu verir. */
export function parseAnswer(text: string): ParsedAnswer {
  const answer: ParsedAnswer = { last: [], totals: [], h2h: [], notes: [], sources: [], unparsed: [] }
  let inSources = false

  text.split(/\r\n|\r|\n/).forEach((original, index) => {
    const line = index + 1
    // Liste imi ve tablo kenarlığı gibi baştaki / sondaki süsler atılır.
    const trimmed = original.trim().replace(/^(?:[-*•]\s+|>\s*)+/, '').replace(/^\|\s*/, '').replace(/\s*\|$/, '')
    if (SOURCES_HEADING.test(fold(trimmed))) {
      inSources = true
      return
    }
    if (SEPARATOR_ONLY.test(trimmed)) return
    const skip = (reason: string) => void answer.unparsed.push({ line, text: original.trim(), reason })

    const rawFields = trimmed.split('|').map((field) => field.trim())
    const fields = rawFields.map(cleanText)
    const numbered = /^#?\s*(\d+)\.?$/.exec(fields[0])

    if (!numbered || fields.length < 2) {
      if (inSources) {
        const url = extractUrl(trimmed)
        const urlAt = rawFields.findIndex((field) => URL.test(field))
        const site = urlAt === 0 ? '' : fields[0]
        const note = fields.filter((_, i) => i !== 0 && i !== urlAt).join(' | ')
        if (site === '' && url === null) return skip('kaynak satırı okunamadı')
        answer.sources.push({ site: site || (url ?? ''), url, note })
        return
      }
      return skip('satır "#n | TÜR | …" biçiminde değil')
    }

    inSources = false
    const no = Number(numbered[1])
    const kind = fold(fields[1])

    if (kind === 'SKOR' || kind === 'HABER') {
      answer.notes.push({ no, kind, text: fields.slice(2).join(' | ') })
      return
    }

    if (kind === 'SON') {
      if (fields.length < 9) return skip(`SON satırında ${fields.length} alan var; en az 9 bekleniyor`)
      const [, , team, date, opponent, venue, ft, ht, competition] = fields
      if (team === '' || opponent === '') return skip('SON satırında takım ya da rakip boş')
      answer.last.push({
        no,
        team,
        date: parseDate(date),
        opponent,
        venue: parseVenue(venue),
        ft: parseScore(ft),
        ht: parseScore(ht),
        competition: parseCompetition(competition),
        competitionText: competition,
        source: fields.slice(9).join(' | '),
        raw: original.trim(),
      })
      return
    }

    if (kind === 'TOPLAM') {
      if (fields.length < 8) return skip(`TOPLAM satırında ${fields.length} alan var; en az 8 bekleniyor`)
      const [, , team, played, record, goals, points, rank] = fields
      if (team === '') return skip('TOPLAM satırında takım boş')
      const [won = null, drawn = null, lost = null] = ints(record).length === 3 ? ints(record) : []
      const [goalsFor = null, goalsAgainst = null] = ints(goals).length === 2 ? ints(goals) : []
      answer.totals.push({
        no,
        team,
        played: firstInt(played),
        won,
        drawn,
        lost,
        goalsFor,
        goalsAgainst,
        points: firstInt(points),
        rank: firstInt(rank),
        source: fields[8] ?? '',
        flag: fields.slice(9).join(' | ') || null,
        raw: original.trim(),
      })
      return
    }

    if (kind === 'H2H') {
      const unknown = { no, unknown: true, date: null, home: '', away: '', ft: null, ht: null, competitionText: '', source: '', raw: original.trim() }
      if (fields.length <= 4 && fields.slice(2).every(isUnknown)) {
        answer.h2h.push(unknown)
        return
      }
      if (fields.length < 5) return skip(`H2H satırında ${fields.length} alan var; en az 5 bekleniyor`)
      const pair = splitPair(fields[3])
      if (!pair) return skip('H2H satırında "ev takım - dep takım" okunamadı')
      answer.h2h.push({ ...unknown, unknown: false, date: parseDate(fields[2]), home: pair[0], away: pair[1], ft: parseScore(fields[4]), ht: parseScore(fields[5] ?? ''), competitionText: fields[6] ?? '', source: fields.slice(7).join(' | ') })
      return
    }

    skip(`tanınmayan satır türü: ${fields[1] || '(boş)'}`)
  })
  return answer
}
