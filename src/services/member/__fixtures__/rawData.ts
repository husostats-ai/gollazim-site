import { COLUMN_ALIASES, TEXT_FIELDS, type FieldKey } from '../../../config/columnAliases'
import { defaultThresholds } from '../../../config/categories'
import type { Highlight, LeagueTable, Match, MatchResult, Pick, SharedPick, TeamAlias } from '../../../types'
import { importCsv } from '../../csv/importer'
import { addHighlight } from '../../highlights/highlights'
import { highlightInputOf } from '../../memberAdmin/publish'
import { buildPicksForResult } from '../../results/freeze'
import { recordShare } from '../../story/shared'
import type { MemberPayloadInput } from '../payload'

// Sızıntı testlerinin verisi. Kolon adları gerçek FootyStats dışa aktarımındakiyle
// aynıdır (107 kolon); takımlar ve tüm sayılar uydurmadır. Ham alanların her hücresi
// başka hiçbir yerde geçmeyen ayırt edici bir değer ("kanarya") taşır: bu değerlerden
// biri pakette görünürse ham veri sızmış demektir.

export const RAW_HEADERS = [
  'date_unix',
  'date_GMT',
  'Country',
  'League',
  'Home Team',
  'Away Team',
  'Home Team Points Per Game (Pre-Match)',
  'Away Team Points Per Game (Pre-Match)',
  'Home Team Points Per Game (Current)',
  'Away Team Points Per Game (Current)',
  'Average Goals',
  'BTTS Average',
  'Over05 Average',
  'Over15 Average',
  'Over25 Average',
  'Over35 Average',
  'Over45 Average',
  'Over05 FHG HT Average',
  'Over15 FHG HT Average',
  'Over05 2HG Average',
  'Over15 2HG Average',
  'Average Corners',
  'Average Cards',
  'Average Over 8.5 Corners',
  'Average Over 9.5 Corners',
  'Average Over 10.5 Corners',
  'Match Status',
  'Result - Home Team Goals',
  'Result - Away Team Goals',
  'Home Team Corners',
  'Away Team Corners',
  'Home Team Offsides',
  'Away Team Offsides',
  'Home Team Yellow Cards',
  'Away Team Yellow Cards',
  'Home Team Red Cards',
  'Away Team Red Cards',
  'Home Team Shots',
  'Away Team Shots',
  'Home Team Shots On Target',
  'Away Team Shots On Target',
  'Home Team Shots Off Target',
  'Away Team Shots Off Target',
  'Home Team Possession',
  'Away Team Possession',
  'Odds_Home_Win',
  'Odds_Draw',
  'Odds_Away_Win',
  'Odds_Over15',
  'Odds_Over25',
  'Odds_Over35',
  'Odds_Over45',
  'Odds_BTTS_Yes',
  'Odds_BTTS_No',
  'Home Team Pre-Match xG',
  'Away Team Pre-Match xG',
  'Home Team xG',
  'Away Team xG',
  'Odds_Under05',
  'Odds_Under15',
  'Odds_Under25',
  'Odds_Under35',
  'Odds_Under45',
  'Odds_DoubleChance_1x',
  'Odds_DoubleChance_12',
  'Odds_DoubleChance_x2',
  'Odds_DrawNoBet_1',
  'Odds_DrawNoBet_2',
  'Odds_Corners_Over75',
  'Odds_Corners_Over85',
  'Odds_Corners_Over95',
  'Odds_Corners_Over105',
  'Odds_Corners_Over115',
  'Odds_Corners_Under75',
  'Odds_Corners_Under85',
  'Odds_Corners_Under95',
  'Odds_Corners_Under105',
  'Odds_Corners_Under115',
  'Under05 Average',
  'Under15 Average',
  'Under25 Average',
  'Under35 Average',
  'Under45 Average',
  'Odds_1st_Half_Over05',
  'Odds_1st_Half_Over15',
  'Odds_1st_Half_Over25',
  'Odds_1st_Half_Under05',
  'Odds_1st_Half_Under15',
  'Odds_1st_Half_Under25',
  'Odds_2nd_Half_Over05',
  'Odds_2nd_Half_Over15',
  'Odds_2nd_Half_Over25',
  'Odds_2nd_Half_Under05',
  'Odds_2nd_Half_Under15',
  'Odds_2nd_Half_Under25',
  'Odds_1st_Half_BTTS_Yes',
  'Odds_1st_Half_BTTS_No',
  'Odds_2nd_Half_BTTS_Yes',
  'Odds_2nd_Half_BTTS_No',
  '1H BTTS Average',
  'Odds_Home_Team_Had_More_Corners',
  'Odds_Both_Teams_Same_Corners',
  'Odds_Away_Team_Had_More_Corners',
  'Home Team Overall Points Per Game (Pre-Match)',
  'Away Team Overall Points Per Game (Pre-Match)',
  'Game Week',
  'Match FootyStats URL',
] as const

type Header = (typeof RAW_HEADERS)[number]

export const DAY = '2026-10-05'
export const PREVIOUS_DAY = '2026-10-04'
export const PUBLISHED_AT = '2026-10-05T06:30:00.000Z'
const FROZEN_AT = '2026-10-05T19:00:00.000Z'
export const URL_CANARY = 'kanarya-mac-yolu'
export const LEAGUE = 'Testland · Deneme Ligi'

/**
 * Pakette görünmesi serbest olan ham kolonlar: maçın kimliği (takım, lig, saat) ve
 * kategorilerin "hazır yüzde"si olarak doğrudan yayınlanan yüzde kolonları.
 */
const PUBLIC_HEADERS: readonly Header[] = [
  'date_unix',
  'date_GMT',
  'Country',
  'League',
  'Home Team',
  'Away Team',
  'BTTS Average',
  'Over25 Average',
  'Over35 Average',
  'Over45 Average',
  'Over05 FHG HT Average',
  'Over15 FHG HT Average',
  'Over05 2HG Average',
  'Average Over 8.5 Corners',
  'Average Over 9.5 Corners',
  'Average Over 10.5 Corners',
]

interface RowSpec {
  home: string
  away: string
  /** 5 Ekim 2026 12:00 (TSİ) üzerine eklenen saat */
  hourOffset: number
  /** Önceki gün */
  previousDay?: boolean
  values?: Partial<Record<Header, string>>
}

// Analizin kullandığı ham alanlar: değerler geçerli ama ayırt edici (üç ondalıklı).
const BASE: Partial<Record<Header, string>> = {
  Country: 'Testland',
  League: 'Deneme Ligi',
  'Match Status': 'incomplete',
  'Home Team Points Per Game (Pre-Match)': '2.137',
  'Away Team Points Per Game (Pre-Match)': '1.291',
  'Average Goals': '3.371',
  'BTTS Average': '89',
  'Over25 Average': '88',
  'Over35 Average': '77',
  'Over45 Average': '66',
  'Over05 FHG HT Average': '91',
  'Over15 FHG HT Average': '72',
  'Over05 2HG Average': '93',
  'Average Corners': '11.371',
  'Average Cards': '5.431',
  'Average Over 8.5 Corners': '86',
  'Average Over 9.5 Corners': '81',
  'Average Over 10.5 Corners': '74',
  'Home Team Pre-Match xG': '1.913',
  'Away Team Pre-Match xG': '1.277',
  Odds_Home_Win: '1.737',
  Odds_Draw: '3.913',
  Odds_Away_Win: '4.817',
  Odds_Over25: '1.613',
  Odds_Under25: '2.371',
}

const ROWS: RowSpec[] = [
  { home: 'Kuzey Yıldızı', away: 'Güney Spor', hourOffset: 0 },
  // Ev sahibi net favori ve xG yüksek: Ev kazanır listeleri ve 2.5 Üst & KG Var
  {
    home: 'Doğu Gençlik',
    away: 'Batı Akademi',
    hourOffset: 2,
    values: { Odds_Home_Win: '1.213', Odds_Draw: '6.513', Odds_Away_Win: '11.317', Odds_Over25: '1.313', Odds_Under25: '3.417', 'Home Team Pre-Match xG': '2.713', 'Away Team Pre-Match xG': '2.413' },
  },
  // Hazır yüzde çok yüksek, xG çok düşük: model çelişkisi
  { home: 'İç Anadolu FK', away: 'Çağlayan Gücü', hourOffset: 3, values: { 'Over25 Average': '100', 'Home Team Pre-Match xG': '0.413', 'Away Team Pre-Match xG': '0.317' } },
  // Deplasman favori: Deplasman kazanır listeleri
  { home: 'Ova Belediyespor', away: 'Liman İdman Yurdu', hourOffset: 5, values: { Odds_Home_Win: '12.213', Odds_Draw: '6.713', Odds_Away_Win: '1.207', Odds_Over25: '1.337', Odds_Under25: '3.297' } },
  // Örneklemi çıkarılabilen maç (ev 9 + deplasman 9): güvenilirlik "Yüksek"
  {
    home: 'Yayla Gençlerbirliği',
    away: 'Vadi Demirspor',
    hourOffset: 8,
    values: {
      'Home Team Points Per Game (Pre-Match)': '1.11',
      'Away Team Points Per Game (Pre-Match)': '0.78',
      'BTTS Average': '89',
      'Over05 Average': '100',
      'Over15 Average': '89',
      'Over25 Average': '78',
      'Over35 Average': '72',
      'Over45 Average': '61',
      'Over05 FHG HT Average': '94',
      'Over15 FHG HT Average': '61',
      'Over05 2HG Average': '94',
      'Over15 2HG Average': '50',
    },
  },
  { home: 'Dünkü Ev', away: 'Dünkü Deplasman', hourOffset: -20, previousDay: true },
]

/** Hücre değeri: satır belirtmişse o, yoksa satır ve kolona özgü dört ondalıklı kanarya */
const cell = (row: RowSpec, rowIndex: number, header: Header, column: number): string => {
  if (header === 'Home Team') return row.home
  if (header === 'Away Team') return row.away
  if (header === 'date_unix') return String(1791190800 + row.hourOffset * 3600)
  if (header === 'date_GMT') return ''
  if (header === 'Match FootyStats URL') return `https://footystats.org/${URL_CANARY}-${rowIndex + 1}`
  return row.values?.[header] ?? BASE[header] ?? `${41 + rowIndex}.${1000 + column}`
}

const TABLE = ROWS.map((row, rowIndex) => RAW_HEADERS.map((header, column) => cell(row, rowIndex, header, column)))

export const RAW_CSV = [RAW_HEADERS.join(','), ...TABLE.map((r) => r.join(','))].join('\n')

/** Ham alanlardaki ayırt edici değerler (CSV'de yazdığı biçimde); pakette hiçbiri bulunmamalı */
export const RAW_CANARIES: string[] = [
  ...new Set(
    TABLE.flatMap((r) => r.filter((value, column) => !PUBLIC_HEADERS.includes(RAW_HEADERS[column]) && /^\d+\.\d{3,}$/.test(value))),
  ),
]

/** Maç kaydında saklanan ham istatistik anahtarları (kimlik alanları dışında) */
export const RAW_STAT_KEYS: string[] = (Object.keys(COLUMN_ALIASES) as FieldKey[]).filter((k) => !TEXT_FIELDS.includes(k) && k !== 'dateUnix')

const { matches } = importCsv(RAW_CSV, 'yukleme-kanarya')
export const MATCHES: Match[] = matches
export const dayMatches = (date: string): Match[] => MATCHES.filter((m) => m.date === date)

export const THRESHOLDS = defaultThresholds()
export const MARKET_LIMIT = 25

const result = (matchId: string, values: Partial<MatchResult>): MatchResult => ({
  matchId,
  status: 'completed',
  htHome: null,
  htAway: null,
  ftHome: null,
  ftAway: null,
  cornersHome: null,
  cornersAway: null,
  cardsHome: null,
  cardsAway: null,
  updatedAt: FROZEN_AT,
  ...values,
})

const byHome = (home: string): Match => MATCHES.find((m) => m.home === home)!

// İlk maç tam skorla, ikincisi korner/kart girilmeden tamamlandı; dördüncü ertelendi.
export const RESULTS: MatchResult[] = [
  result(byHome('Kuzey Yıldızı').id, { htHome: 1, htAway: 0, ftHome: 3, ftAway: 1, cornersHome: 7, cornersAway: 5, cardsHome: 3, cardsAway: 2 }),
  result(byHome('Doğu Gençlik').id, { htHome: 0, htAway: 0, ftHome: 0, ftAway: 0 }),
  result(byHome('Ova Belediyespor').id, { status: 'postponed' }),
  result(byHome('Dünkü Ev').id, { htHome: 2, htAway: 1, ftHome: 2, ftAway: 2, cornersHome: 4, cornersAway: 4, cardsHome: 1, cardsAway: 1 }),
]

/** Öneriler uygulamanın kendi dondurma koduyla üretilir */
export const PICKS: Pick[] = RESULTS.flatMap((r) => {
  const match = MATCHES.find((m) => m.id === r.matchId)!
  return buildPicksForResult({ match, dayMatches: dayMatches(match.date), thresholds: THRESHOLDS, result: r, existing: [], now: FROZEN_AT, marketConflictLimit: MARKET_LIMIT })
})

export const SHARED: SharedPick[] = recordShare([], { date: DAY, categoryId: 'over25', matches: [byHome('Kuzey Yıldızı'), byHome('Doğu Gençlik')], now: PUBLISHED_AT })

/**
 * Öne çıkan seçimler (uygulamanın kendi ekleme koduyla, maçlar başlamadan önce). Kayıttaki yüzde
 * (HIGHLIGHT_PERCENT) pakette hiçbir yerde geçmeyen bir değerdir: görünürse kayıt sızmış demektir.
 */
export const HIGHLIGHT_PERCENT = 43
const highlight = (home: string, categoryId: Highlight['categoryId'], now: string): Highlight => {
  const added = addHighlight([], { match: byHome(home), categoryId, percent: HIGHLIGHT_PERCENT, reliability: 'unmeasured' }, new Date(now))
  if (!added.ok) throw new Error(`öne çıkan eklenemedi: ${home} (${added.reason})`)
  return added.record
}
export const HIGHLIGHTS: Highlight[] = [
  highlight('Kuzey Yıldızı', 'over25', '2026-10-05T06:00:00.000Z'), // 3-1: tuttu
  highlight('Doğu Gençlik', 'over25', '2026-10-05T06:01:00.000Z'), // 0-0: tutmadı
  highlight('İç Anadolu FK', 'over25', '2026-10-05T06:02:00.000Z'), // skor yok: bekliyor
  highlight('Kuzey Yıldızı', 'corners85', '2026-10-05T06:03:00.000Z'), // korner 12: tuttu
  highlight('Dünkü Ev', 'btts', '2026-10-04T06:00:00.000Z'), // 2-2: tuttu
]
export const dayHighlights = (date: string): Highlight[] => HIGHLIGHTS.filter((h) => h.date === date)

export const LEAGUE_TABLES: LeagueTable[] = [
  {
    id: LEAGUE,
    league: LEAGUE,
    pastedAt: '2026-10-04T08:00:00.000Z',
    rows: [
      { team: 'Kuzey Yıldızı', rank: 1, played: 8, points: 20, ppg: 2.5 },
      { team: 'Güney Spor', rank: 4, played: 7, points: 11, ppg: 1.57 },
      { team: 'Doğu Gençlik', rank: 9, played: 8, points: 6, ppg: 0.75 },
    ],
  },
]
export const TEAM_ALIASES: TeamAlias[] = []

export const memberInput = (overrides: Partial<MemberPayloadInput> = {}): MemberPayloadInput => ({
  n: 7,
  publishedAt: PUBLISHED_AT,
  texts: { disclaimer: 'Bu bir istatistik taramasıdır; bahis tavsiyesi değildir ve sonuç garantisi vermez. 18+', account: 'Hesap kişiye özeldir, paylaşılamaz.' },
  thresholds: THRESHOLDS,
  marketConflictLimit: MARKET_LIMIT,
  days: [DAY, PREVIOUS_DAY].map((date) => ({ date, matches: dayMatches(date), results: RESULTS.filter((r) => dayMatches(date).some((m) => m.id === r.matchId)), highlights: dayHighlights(date).map(highlightInputOf) })),
  leagueTables: LEAGUE_TABLES,
  teamAliases: TEAM_ALIASES,
  picks: PICKS,
  shared: SHARED,
  ...overrides,
})
