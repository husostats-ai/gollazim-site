import type { LastRow, TotalRow, Venue } from './parser'

// Yapıştırılan SON satırlarından sayılan oranlar. Yalnızca sayar: eşik, yıldız, güvenilirlik
// ya da model hesabıyla ilgisi yoktur.

export interface Rate {
  hit: number
  n: number
}

export interface TeamRates {
  /** Sayılan satır (maç sonu skoru bilinen) */
  matches: number
  over25: Rate
  btts: Rate
  over25btts: Rate
  /** Paydası yalnızca devre skoru bilinen satırlardır */
  ht05: Rate
  /** Devre skoru bilinen satır sayısı (ht05.n ile aynı) */
  htKnown: number
  /** Maç sonu skoru okunamadığı için sayılmayan satır */
  noScore: number
}

export const RATE_KEYS = ['over25', 'btts', 'over25btts', 'ht05'] as const
export type RateKey = (typeof RATE_KEYS)[number]
export const RATE_LABELS: Record<RateKey, string> = { over25: '2.5 ÜST', btts: 'KG VAR', over25btts: '2.5 ÜST & KG VAR', ht05: 'İLK YARI 0.5 ÜST' }

export const leagueRows = (rows: LastRow[]): LastRow[] => rows.filter((row) => row.competition === 'league')

/** Verilen satırların dört oranı; satırlar çağıran tarafından seçilir (lig, iç / dış) */
export function computeRates(rows: LastRow[]): TeamRates {
  const scored = rows.filter((row) => row.ft !== null)
  const withHalf = scored.filter((row) => row.ht !== null)
  const count = (list: LastRow[], test: (row: LastRow) => boolean): Rate => ({ hit: list.filter(test).length, n: list.length })
  const over25 = (row: LastRow) => row.ft!.own + row.ft!.opp >= 3
  const btts = (row: LastRow) => row.ft!.own >= 1 && row.ft!.opp >= 1
  return {
    matches: scored.length,
    over25: count(scored, over25),
    btts: count(scored, btts),
    over25btts: count(scored, (row) => over25(row) && btts(row)),
    ht05: count(withHalf, (row) => row.ht!.own + row.ht!.opp >= 1),
    htKnown: withHalf.length,
    noScore: rows.length - scored.length,
  }
}

export interface VenueRates {
  venue: Venue
  rates: TeamRates
  /** İÇ / DIŞ bilgisi olmadığı için dışarıda bırakılan lig satırı */
  unknownVenue: number
}

/** Ev sahibi için yalnızca İÇ, deplasman takımı için yalnızca DIŞ lig maçları */
export function venueRates(rows: LastRow[], venue: Venue): VenueRates {
  const league = leagueRows(rows)
  return { venue, rates: computeRates(league.filter((row) => row.venue === venue)), unknownVenue: league.filter((row) => row.venue === null).length }
}

export interface Tally {
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  points: number
}

/** TOPLAM satırı ancak bu kadar maça kadar SON listesiyle karşılaştırılır (liste daha uzununu kapsamaz) */
export const TOTAL_CHECK_MAX_PLAYED = 8

export interface TotalCheck {
  /**
   * ok: tutuyor. mismatch: tutmuyor. too-many: oynanan > 8, denetlenmedi. unknown: TOPLAM'da
   * oynanan sayısı ya da lig satırlarından birinin skoru bilinmiyor, denetlenemedi.
   */
  status: 'ok' | 'mismatch' | 'too-many' | 'unknown'
  /** LİG satırlarından hesaplanan değerler; denetlenmediyse null */
  computed: Tally | null
  /** Tutmayan alanlar: "puan: TOPLAM 7, satırlardan 6" */
  differences: string[]
}

/** Lig satırlarından galibiyet-beraberlik-mağlubiyet, goller ve puan (3-1-0) */
export function tallyOf(rows: LastRow[]): Tally {
  const scored = leagueRows(rows).filter((row) => row.ft !== null)
  const won = scored.filter((row) => row.ft!.own > row.ft!.opp).length
  const drawn = scored.filter((row) => row.ft!.own === row.ft!.opp).length
  return {
    played: scored.length,
    won,
    drawn,
    lost: scored.length - won - drawn,
    goalsFor: scored.reduce((sum, row) => sum + row.ft!.own, 0),
    goalsAgainst: scored.reduce((sum, row) => sum + row.ft!.opp, 0),
    points: won * 3 + drawn,
  }
}

/** TOPLAM satırını takımın LİG satırlarıyla karşılaştırır (oynanan ≤ 8 ise) */
export function checkTotal(total: TotalRow, rows: LastRow[]): TotalCheck {
  if (total.played === null) return { status: 'unknown', computed: null, differences: [] }
  if (total.played > TOTAL_CHECK_MAX_PLAYED) return { status: 'too-many', computed: null, differences: [] }
  const league = leagueRows(rows)
  const computed = tallyOf(rows)
  const differences: string[] = []
  if (league.some((row) => row.ft === null)) return { status: 'unknown', computed, differences: ['lig satırlarından birinin maç sonu skoru bilinmiyor'] }
  const compare = (label: string, stated: number | null, counted: number) => {
    if (stated === null) differences.push(`${label}: TOPLAM bilinmiyor, satırlardan ${counted}`)
    else if (stated !== counted) differences.push(`${label}: TOPLAM ${stated}, satırlardan ${counted}`)
  }
  compare('oynanan', total.played, computed.played)
  compare('galibiyet', total.won, computed.won)
  compare('beraberlik', total.drawn, computed.drawn)
  compare('mağlubiyet', total.lost, computed.lost)
  compare('atılan', total.goalsFor, computed.goalsFor)
  compare('yenilen', total.goalsAgainst, computed.goalsAgainst)
  compare('puan', total.points, computed.points)
  return { status: differences.length === 0 ? 'ok' : 'mismatch', computed, differences }
}
