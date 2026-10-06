// FootyStats lig tablosu kopyasının ayrıştırılması. Yalnızca sıra, takım adı,
// MP, W, D, L, GF, GA, Pts ve PPG okunur; kalan sütunlar (adı olmayanlar dahil)
// yok sayılır. Sağlaması tutmayan satır kaydedilmez ve nedeniyle birlikte bildirilir.

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

/** Satır bir takım satırı gibi mi: sıra numarasıyla başlar ve ardından takım adı gelir */
const looksLikeTeamLine = (fields: string[]): boolean => fields.length >= 4 && INTEGER.test(fields[0]) && !INTEGER.test(fields[1]) && fields[1] !== ''

/** Sağlama kuralları; hepsi tutuyorsa boş dizi */
export function checkRow(row: ParsedTableRow, goalDifference: number): string[] {
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
    }
    const problems = checkRow(row, goalDifference!)
    if (problems.length > 0) return fail(`Sağlama tutmadı: ${problems.join('; ')}.`)
    if (seenTeams.has(team)) return fail(`“${team}” tabloda birden fazla kez geçiyor.`)
    seenTeams.add(team)
    rows.push(row)
  })

  return { rows, errors }
}
