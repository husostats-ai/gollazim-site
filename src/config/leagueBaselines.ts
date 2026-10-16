/**
 * "Lig bazlı ana kategoriler" tablosundaki lig tabanları: ligin geçmiş sezonlarındaki tüm maçlarında
 * KG VAR ve 2.5 ÜST oranı (%). SABİT listedir; uygulama bunları hesaplamaz, yalnızca yan sütunda gösterir
 * ve n ≥ 20 hücrede "bizim − taban" farkını yazar. İY 0.5 ÜST için taban yoktur.
 */
export const BASELINE_SOURCE = 'openfootball maç sonuçları, 90 dk skoru'
export const BASELINE_COMPUTED_AT = '2026-10-15'

export interface LeagueBaseline {
  /** Uygulamanın lig adı (leagueNameOf: "ülke · lig adı") */
  league: string
  seasons: string
  /** KG VAR % */
  btts: number
  /** 2.5 ÜST % */
  over25: number
}

export const LEAGUE_BASELINES: readonly LeagueBaseline[] = [
  { league: 'Germany · Bundesliga', seasons: '2021-22 → 2025-26', btts: 60.1, over25: 61.0 },
  { league: 'England · Premier League', seasons: '2021-22 → 2025-26', btts: 55.3, over25: 56.6 },
  { league: 'France · Ligue 1', seasons: '2021-22 → 2025-26', btts: 55.1, over25: 53.5 },
  { league: 'Spain · La Liga', seasons: '2021-22 → 2025-26', btts: 51.8, over25: 47.4 },
  { league: 'Italy · Serie A', seasons: '2021-22 → 2025-26', btts: 51.4, over25: 48.9 },
  { league: 'Europe · UEFA Champions League', seasons: '2021-22 → 2025-26', btts: 53.4, over25: 60.0 },
  { league: 'Europe · UEFA Europa League', seasons: '2021-22 → 2024-25', btts: 53.6, over25: 53.9 },
]

/** Taban yüzdesi her zaman bir ondalıkla: "%60,0" */
export const formatBaseline = (value: number): string => `%${value.toFixed(1).replace('.', ',')}`

export const baselineOf = (leagueName: string): LeagueBaseline | undefined => LEAGUE_BASELINES.find((b) => b.league === leagueName)
