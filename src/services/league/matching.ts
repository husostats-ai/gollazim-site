import type { LeagueTable, LeagueTableRow, TeamAlias } from '../../types'

// CSV'deki takım adı ile lig tablosundaki ad farklı olabilir ("Coventry City U21" /
// "Coventry City FC"). Sıra: kullanıcının seçimi (takma ad), tam eşleşme, normalize
// eşleşme. Normalize eşleşme yalnızca tek anlamlıysa ve iki adın yaş grubu eki (U21 vb.)
// aynıysa kabul edilir; emin olunmayan eşleşme yapılmaz, kullanıcıya sorulur.

/** Takma ad kaydında "bu takım tabloda yok" seçimi */
export const NOT_IN_TABLE = ''

export const aliasId = (league: string, csvTeam: string): string => `${league}|${csvTeam}`

/** Kulüp türü ve yaş grubu ekleri: karşılaştırmada atılır */
const DROPPED_TOKENS = new Set(['fc', 'afc', 'cf', 'sc', 'ac', 'fk', 'sk', 'bk', 'if', 'club'])
const AGE_TOKEN = /^(u|under)-?\d{2}$/

/** Karşılaştırma anahtarı: küçük harf, aksansız, "&" = "and", FC / AFC / U21 gibi ekler atılmış */
export function normalizeTeam(name: string): string {
  return name
    .replace(/[İIı]/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // "U-21", "U 21" ve "Under 21" tek tipe ("u21") getirilir
    .replace(/\b(?:u|under)[\s-]?(\d{2})\b/g, 'u$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token !== '' && !DROPPED_TOKENS.has(token) && !AGE_TOKEN.test(token))
    .join(' ')
}

/**
 * Addaki yaş grubu eki, tek tipte ("u21"); yoksa null. "U21", "U-21" ve "Under 21" aynıdır.
 * A takım ile altyapı takımı farklı takımlardır: ekleri farklı iki ad kendiliğinden eşleştirilmez.
 */
export function ageGroup(name: string): string | null {
  const found = /\b(?:u|under)[\s-]?(\d{2})\b/i.exec(name)
  return found ? `u${found[1]}` : null
}

/** alias: kullanıcı seçti; exact: adlar aynı; normalized: ekler atılınca aynı; none: eşleşme yok */
export type MatchKind = 'alias' | 'exact' | 'normalized' | 'none'

export interface TeamMatch {
  csvTeam: string
  /** Eşleşen tablo satırı; yoksa null */
  row: LeagueTableRow | null
  kind: MatchKind
  /** Eşleşme yoksa nedeni: kullanıcı "tabloda yok" dedi, birden çok aday var ya da aday yok */
  reason?: 'declared-absent' | 'ambiguous' | 'no-candidate' | 'alias-missing' | 'age-mismatch'
}

const sameText = (a: string, b: string): boolean => a.trim().toLocaleLowerCase('tr') === b.trim().toLocaleLowerCase('tr')

/**
 * Bir ligin CSV takımlarını tablo satırlarıyla eşleştirir. Normalize eşleşme iki yönde de
 * tek olmalıdır: aynı anahtara düşen iki tablo takımı ya da iki CSV takımı varsa eşleştirilmez.
 */
export function matchTeams(league: string, csvTeams: string[], rows: LeagueTableRow[], aliases: TeamAlias[]): TeamMatch[] {
  const aliasByTeam = new Map(aliases.filter((a) => a.league === league).map((a) => [a.csvTeam, a.tableTeam]))
  // Karşılaştırma anahtarı adın yanında yaş grubunu da taşır: "X U21" ile "X" ayrı takımlardır.
  const keyOf = (name: string) => `${normalizeTeam(name)}|${ageGroup(name) ?? ''}`
  const csvKeyCount = new Map<string, number>()
  for (const team of csvTeams) csvKeyCount.set(keyOf(team), (csvKeyCount.get(keyOf(team)) ?? 0) + 1)

  return csvTeams.map((csvTeam): TeamMatch => {
    const alias = aliasByTeam.get(csvTeam)
    if (alias !== undefined) {
      if (alias === NOT_IN_TABLE) return { csvTeam, row: null, kind: 'none', reason: 'declared-absent' }
      const row = rows.find((r) => r.team === alias)
      // Seçilen takım yeni tabloda yoksa sessizce başka bir takıma düşülmez.
      return row ? { csvTeam, row, kind: 'alias' } : { csvTeam, row: null, kind: 'none', reason: 'alias-missing' }
    }
    const exact = rows.find((r) => sameText(r.team, csvTeam))
    if (exact) return { csvTeam, row: exact, kind: 'exact' }

    const name = normalizeTeam(csvTeam)
    const sameName = name === '' ? [] : rows.filter((r) => normalizeTeam(r.team) === name)
    const candidates = sameName.filter((r) => ageGroup(r.team) === ageGroup(csvTeam))
    if (candidates.length === 1 && csvKeyCount.get(keyOf(csvTeam)) === 1) return { csvTeam, row: candidates[0], kind: 'normalized' }
    if (candidates.length > 0) return { csvTeam, row: null, kind: 'none', reason: 'ambiguous' }
    // Ad aynı ama yaş grubu eki farklı (ör. "X U21" / "X FC"): kendiliğinden eşleştirilmez, kullanıcı seçer.
    return { csvTeam, row: null, kind: 'none', reason: sameName.length > 0 ? 'age-mismatch' : 'no-candidate' }
  })
}

export interface Standing {
  row: LeagueTableRow
  table: LeagueTable
}

/** Bir takımın kayıtlı lig tablosundaki satırı; tablo ya da güvenli bir eşleşme yoksa null */
export function findStanding(
  league: string | undefined,
  team: string,
  /** Aynı ligin bilinen diğer CSV takımları (normalize eşleşmenin tek anlamlı olup olmadığı için) */
  leagueTeams: string[],
  tables: LeagueTable[],
  aliases: TeamAlias[],
): Standing | null {
  if (!league) return null
  const table = tables.find((t) => t.league === league)
  if (!table) return null
  const teams = leagueTeams.includes(team) ? leagueTeams : [...leagueTeams, team]
  const match = matchTeams(league, teams, table.rows, aliases).find((m) => m.csvTeam === team)
  return match?.row ? { row: match.row, table } : null
}

const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0
const isAmount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
const isPercent = (n: unknown): n is number => isAmount(n) && n <= 100
const LAST5 = /^[WDL]{1,5}$/

/**
 * Satırın saklanan biçimi: alanlar sabit sırada, tanınmayan alanlar atılmış. Zorunlu alanlardan
 * biri bozuksa null. Ek alanlardan (W, D, L, GF, GA, GD, Last 5, CS, BTTS, xGF, kart, korner,
 * 1.5+, 2.5+, AVG) bozuk olan yalnızca kendisi atılır; satır kalır.
 */
export function canonicalRow(value: unknown): LeagueTableRow | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Partial<Record<keyof LeagueTableRow, unknown>>
  if (typeof r.team !== 'string' || ![r.rank, r.played, r.points].every((n) => Number.isInteger(n)) || !(r.ppg === null || typeof r.ppg === 'number')) return null
  return {
    team: r.team,
    rank: r.rank as number,
    played: r.played as number,
    points: r.points as number,
    ppg: r.ppg,
    ...(isCount(r.won) && { won: r.won }),
    ...(isCount(r.drawn) && { drawn: r.drawn }),
    ...(isCount(r.lost) && { lost: r.lost }),
    ...(isCount(r.goalsFor) && { goalsFor: r.goalsFor }),
    ...(isCount(r.goalsAgainst) && { goalsAgainst: r.goalsAgainst }),
    ...(Number.isInteger(r.goalDiff) && { goalDiff: r.goalDiff as number }),
    ...(typeof r.last5 === 'string' && LAST5.test(r.last5) && { last5: r.last5 }),
    ...(isPercent(r.cs) && { cs: r.cs }),
    ...(isPercent(r.btts) && { btts: r.btts }),
    ...(isAmount(r.xgf) && { xgf: r.xgf }),
    ...(isAmount(r.cards) && { cards: r.cards }),
    ...(isAmount(r.corners) && { corners: r.corners }),
    ...(isPercent(r.over15) && { over15: r.over15 }),
    ...(isPercent(r.over25) && { over25: r.over25 }),
    ...(isAmount(r.avgGoals) && { avgGoals: r.avgGoals }),
  }
}

const canonicalRows = (rows: unknown[]): LeagueTableRow[] => rows.map(canonicalRow).filter((r): r is LeagueTableRow => r !== null)

/** Yedekten gelen tabloları doğrular; bozuk tablo ve satırlar atılır. */
export function normalizeLeagueTables(value: unknown): LeagueTable[] {
  if (!Array.isArray(value)) return []
  const byLeague = new Map<string, LeagueTable>()
  for (const table of value as Partial<LeagueTable>[]) {
    if (typeof table !== 'object' || table === null || typeof table.league !== 'string' || typeof table.pastedAt !== 'string' || !Array.isArray(table.rows)) continue
    byLeague.set(table.league, { id: table.league, league: table.league, pastedAt: table.pastedAt, rows: canonicalRows(table.rows) })
  }
  return [...byLeague.values()]
}

export function normalizeAliases(value: unknown): TeamAlias[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<string, TeamAlias>()
  for (const alias of value as Partial<TeamAlias>[]) {
    if (typeof alias !== 'object' || alias === null) continue
    const { league, csvTeam, tableTeam } = alias
    if (typeof league !== 'string' || typeof csvTeam !== 'string' || typeof tableTeam !== 'string') continue
    byId.set(aliasId(league, csvTeam), { id: aliasId(league, csvTeam), league, csvTeam, tableTeam })
  }
  return [...byId.values()]
}
