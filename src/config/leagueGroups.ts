/**
 * "Lig bazlı ana kategoriler" tablosundaki sabit lig grupları. SABİT listedir: veriye ya da
 * sonuçlara bakılarak değişmez; değiştirmek için bu dosya elle düzenlenir. Anahtar, uygulamanın
 * lig adıyla (leagueNameOf: "ülke · lig adı") birebir aynıdır; yalnızca lig adıyla eşleşme yapılmaz,
 * böylece başka ülkedeki aynı adlı lig (ör. Wales · Premier League) gruba girmez.
 * Listede olmayan her lig "Diğer yetişkin ligler" grubundadır.
 */
export type LeagueGroupId = 'big5' | 'euroCups' | 'youth' | 'otherCups' | 'unsure' | 'otherAdult'

export interface LeagueGroup {
  id: LeagueGroupId
  label: string
  /** Gruba giren ligler; "otherAdult" için boş (kalan hepsi) */
  leagues: readonly string[]
}

/** Tablodaki sırayla */
export const LEAGUE_GROUPS: readonly LeagueGroup[] = [
  {
    id: 'big5',
    label: 'Beş büyük lig',
    // "France · Ligue 1" 16 Ekim 2026 yedeğinde hiçbir kayıtta geçmiyor; yazımı doğrulanamadı.
    leagues: ['England · Premier League', 'Spain · La Liga', 'Germany · Bundesliga', 'Italy · Serie A', 'France · Ligue 1'],
  },
  {
    id: 'euroCups',
    label: 'Avrupa kupaları',
    // Konferans Ligi iki adla gelebilir (2024'ten beri resmi adı "UEFA Conference League")
    leagues: ['Europe · UEFA Champions League', 'Europe · UEFA Europa League', 'Europe · UEFA Europa Conference League', 'Europe · UEFA Conference League'],
  },
  {
    id: 'youth',
    label: 'Gençlik / U-takım',
    leagues: [
      'Europe · UEFA Youth League',
      'England · Professional Development League',
      'Europe · UEFA U21 Championship Qualification',
      'England · U18 Premier League',
      'Iceland · U19 League',
    ],
  },
  {
    id: 'otherCups',
    label: 'Diğer kupalar',
    leagues: ['England · EFL Trophy', 'Asia · AFC Champions League', 'Japan · Emperor Cup', 'Asia · AFC Cup', 'Japan · J-League Cup', 'Asia · ASEAN Club Championship'],
  },
  { id: 'unsure', label: 'Belirsiz', leagues: ['International · UEFA Nations League', 'International · ASEAN Cup'] },
  { id: 'otherAdult', label: 'Diğer yetişkin ligler', leagues: [] },
]

const GROUP_BY_LEAGUE = new Map(LEAGUE_GROUPS.flatMap((g) => g.leagues.map((league) => [league, g.id] as const)))

/** Ligin ("ülke · lig adı") grubu; listede yoksa "otherAdult" */
export const leagueGroupOf = (leagueName: string): LeagueGroupId => GROUP_BY_LEAGUE.get(leagueName) ?? 'otherAdult'
