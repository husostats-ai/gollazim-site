// FootyStats lig tablosu kopyasının ayrıştırılması. Sıra, takım adı, MP, W, D, L, GF, GA, GD,
// Pts ve PPG ile birlikte kalan sütunlar da okunur: "Last 5" ve değer satırındaki CS, BTTS,
// xGF, kart, korner, 1.5+, 2.5+, AVG. Sağlaması tutmayan satır kaydedilmez ve nedeniyle
// birlikte bildirilir. Değer satırı beklenen biçimde değilse ya da AVG tutmuyorsa satır
// kaydedilir, yalnızca ek alanları boş kalır ve uyarı verilir.

export interface ParsedTableRow {
  rank: number
  team: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  points: number
  /** Tabloda yazan maç başı puan; okunamadıysa null (hesaplanıp yerine konmaz) */
  ppg: number | null
  goalDiff: number
  last5?: string
  cs?: number
  btts?: number
  xgf?: number
  cards?: number
  corners?: number
  over15?: number
  over25?: number
  avgGoals?: number
}

export interface TableParseError {
  /** Yapıştırılan metindeki satır numarası (1'den başlar) */
  line: number
  text: string
  message: string
}

export interface TableParseResult {
  rows: ParsedTableRow[]
  errors: TableParseError[]
  /** Kaydedilen ama ek alanları okunamayan satırlar */
  warnings: TableParseError[]
}

const INTEGER = /^\d+$/
const DECIMAL = /^\d+[.,]\d+$/
const STATS_SUFFIX = /\s+Stats$/i

const toInt = (text: string): number | null => (INTEGER.test(text) ? Number(text) : null)
/** "+8", "-2", "0" ve tipografik eksi işareti */
const toSigned = (text: string): number | null => {
  const clean = text.replace(/[−–]/g, '-').replace(/^\+/, '')
  return /^-?\d+$/.test(clean) ? Number(clean) : null
}
const toDecimal = (text: string): number | null => (DECIMAL.test(text) ? Number(text.replace(',', '.')) : null)

const LAST5 = /^[WDL]{1,5}$/
/** Değer satırındaki ondalık sütunlar tam sayı da yazılabilir ("3") */
const toAmount = (text: string): number | null => (/^\d+([.,]\d+)?$/.test(text) ? Number(text.replace(',', '.')) : null)
const toPercent = (text: string): number | null => {
  const value = /^\d{1,3}%$/.test(text) ? Number(text.slice(0, -1)) : null
  return value !== null && value <= 100 ? value : null
}

type Extras = Pick<ParsedTableRow, 'cs' | 'btts' | 'xgf' | 'cards' | 'corners' | 'over15' | 'over25' | 'avgGoals'>

/** PPG'den sonraki sütunlar; satır sırayla tam 9 alan (PPG, CS, BTTS, xGF, kart, korner, 1.5+, 2.5+, AVG) değilse null */
function readExtras(fields: string[]): Required<Extras> | null {
  if (fields.length !== 9 || toDecimal(fields[0]) === null) return null
  const [cs, btts, over15, over25] = [fields[1], fields[2], fields[6], fields[7]].map(toPercent)
  const [xgf, cards, corners, avgGoals] = [fields[3], fields[4], fields[5], fields[8]].map(toAmount)
  if (cs === null || btts === null || over15 === null || over25 === null || xgf === null || cards === null || corners === null || avgGoals === null) return null
  return { cs, btts, xgf, cards, corners, over15, over25, avgGoals }
}

/** AVG = (GF + GA) / MP; tabloda iki ondalığa yuvarlanmış yazar */
export const fitsAverage = (avgGoals: number, row: Pick<ParsedTableRow, 'played' | 'goalsFor' | 'goalsAgainst'>): boolean =>
  row.played === 0 || Math.abs(avgGoals - (row.goalsFor + row.goalsAgainst) / row.played) <= 0.005 + 1e-9

/** Satır bir takım satırı gibi mi: sıra numarasıyla başlar ve ardından takım adı gelir */
const looksLikeTeamLine = (fields: string[]): boolean => fields.length >= 4 && INTEGER.test(fields[0]) && !INTEGER.test(fields[1]) && fields[1] !== ''

/** Sağlama kuralları; hepsi tutuyorsa boş dizi */
export function checkRow(row: Pick<ParsedTableRow, 'played' | 'won' | 'drawn' | 'lost' | 'goalsFor' | 'goalsAgainst' | 'points'>, goalDifference: number): string[] {
  const problems: string[] = []
  if (row.won + row.drawn + row.lost !== row.played) problems.push(`W+D+L (${row.won}+${row.drawn}+${row.lost}) MP'ye (${row.played}) eşit değil`)
  if (3 * row.won + row.drawn !== row.points) problems.push(`3W+D (${3 * row.won + row.drawn}) Pts'ye (${row.points}) eşit değil`)
  if (row.goalsFor - row.goalsAgainst !== goalDifference) problems.push(`GF−GA (${row.goalsFor - row.goalsAgainst}) GD'ye (${goalDifference}) eşit değil`)
  return problems
}

/**
 * Yapıştırılan metni çözer. Her takım birkaç satır tutar: ilk satırda sıra, "<Takım> Stats",
 * "<Takım>", MP, W, D, L, GF, GA, GD, Pts; izleyen satırlarda "Last 5" ve PPG ile başlayan değerler.
 */
export function parseLeagueTable(text: string): TableParseResult {
  const lines = text.split(/\r?\n/)
  const rows: ParsedTableRow[] = []
  const errors: TableParseError[] = []
  const warnings: TableParseError[] = []
  const seenTeams = new Set<string>()

  lines.forEach((raw, index) => {
    const fields = raw.split('\t').map((f) => f.trim())
    if (!looksLikeTeamLine(fields)) return
    const fail = (message: string) => errors.push({ line: index + 1, text: raw.trim(), message })

    // İlk ad "<Takım> Stats" bağlantısıdır; asıl ad onu izleyen sütundadır.
    const hasStatsColumn = STATS_SUFFIX.test(fields[1])
    const team = hasStatsColumn && fields[2] && !INTEGER.test(fields[2]) ? fields[2] : fields[1].replace(STATS_SUFFIX, '')
    const start = hasStatsColumn && fields[2] && !INTEGER.test(fields[2]) ? 3 : 2
    const [played, won, drawn, lost, goalsFor, goalsAgainst] = fields.slice(start, start + 6).map(toInt)
    const goalDifference = toSigned(fields[start + 6] ?? '')
    const points = toInt(fields[start + 7] ?? '')
    if ([played, won, drawn, lost, goalsFor, goalsAgainst, goalDifference, points].some((v) => v === null)) {
      return fail('MP, W, D, L, GF, GA, GD, Pts sütunlarından biri okunamadı.')
    }

    // PPG: aynı satırda Pts'den sonraki ilk ondalık değer, yoksa izleyen iki satırdan birinin ilk alanı.
    let ppg = fields.slice(start + 8).map(toDecimal).find((v) => v !== null) ?? null
    for (let next = index + 1; ppg === null && next <= index + 2 && next < lines.length; next++) {
      const nextFields = lines[next].split('\t').map((f) => f.trim())
      if (looksLikeTeamLine(nextFields)) break
      ppg = toDecimal(nextFields[0])
    }

    const row: ParsedTableRow = {
      rank: Number(fields[0]),
      team,
      played: played!,
      won: won!,
      drawn: drawn!,
      lost: lost!,
      goalsFor: goalsFor!,
      goalsAgainst: goalsAgainst!,
      points: points!,
      ppg,
      goalDiff: goalDifference!,
    }
    const problems = checkRow(row, goalDifference!)
    if (problems.length > 0) return fail(`Sağlama tutmadı: ${problems.join('; ')}.`)
    if (seenTeams.has(team)) return fail(`“${team}” tabloda birden fazla kez geçiyor.`)
    seenTeams.add(team)

    // Ek sütunlar: takım satırını izleyen iki satırda "Last 5" ve değer satırı aranır.
    for (let next = index + 1; next <= index + 2 && next < lines.length; next++) {
      const nextFields = lines[next].split('\t').map((f) => f.trim())
      if (looksLikeTeamLine(nextFields)) break
      const letters = lines[next].replace(/\s+/g, '').toUpperCase()
      if (LAST5.test(letters)) {
        row.last5 ??= letters
        continue
      }
      if (nextFields.length < 2) continue
      const warn = (message: string) => warnings.push({ line: next + 1, text: lines[next].trim(), message: `${team}: ${message}` })
      const extras = readExtras(nextFields)
      if (!extras) warn('Değer satırı beklenen 9 sütun (PPG, CS, BTTS, xGF, kart, korner, 1.5+, 2.5+, AVG) biçiminde değil; ek alanlar boş bırakıldı.')
      else if (!fitsAverage(extras.avgGoals, row)) warn(`AVG (${extras.avgGoals}) (GF+GA)/MP ile tutmuyor; ek alanlar boş bırakıldı.`)
      else Object.assign(row, extras)
      break
    }
    rows.push(row)
  })

  return { rows, errors, warnings }
}
