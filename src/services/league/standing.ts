import { LEAGUE_TABLE_STALE_DAYS } from '../../config/reminders'
import type { LeagueTable, LeagueTableRow, Match, TeamAlias } from '../../types'
import { stat } from '../analysis/stat'
import { daysBetween } from '../daily/checklist'
import { kickoffOf } from '../highlights/highlights'
import { findStanding, type Standing } from './matching'

// Kartta gösterilen lig tablosu bilgisi. Yalnızca gösterimdir: analize, güvenilirlik
// seviyesine, yıldıza, sıralamaya, dondurmaya ve AI prompt'una girmez.

export interface StandingInfo {
  /** "Ligde 3. sıra · 5 maç · tablo 2 gün önce" */
  text: string
  rank: number
  played: number
  /** Tablonun yapıştırılmasından bu yana geçen takvim günü */
  ageDays: number
  /** Tablo LEAGUE_TABLE_STALE_DAYS günden eski */
  stale: boolean
  /** Yalnızca admin kartındaki açılır satır ve "tablo eski olabilir" işareti; matchStandings doldurur */
  detail?: StandingDetail
}

/** Tablo PPG'si ile CSV'deki genel PPG arasında bu kadardan fazla fark varsa tablo eski sayılır */
export const PPG_TOLERANCE = 0.01

export interface StandingDetail {
  /** "WWDDL · 6–4 · CS %60"; tabloda bu sütunlar yoksa null */
  text: string | null
  /** Tablodaki PPG, CSV'deki maç öncesi genel PPG'den farklı (yalnızca başlamamış maçlarda) */
  maybeOld: boolean
  /** CSV'deki lig turu; yoksa null. Yalnızca bilgi içindir, uyarı üretmez */
  gameWeek: number | null
}

/** Açılır satırın metni: Last 5 (ham, yön belirtilmez), attığı–yediği gol, gol yememe yüzdesi */
export function detailText(row: LeagueTableRow): string | null {
  const parts = [
    row.last5,
    row.goalsFor !== undefined && row.goalsAgainst !== undefined ? `${row.goalsFor}–${row.goalsAgainst}` : undefined,
    row.cs !== undefined ? `CS %${row.cs}` : undefined,
  ].filter((p) => p !== undefined)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Tablo PPG'si CSV'deki genel PPG'den toleranstan fazla mı ayrışıyor; biri yoksa ayrışmıyor sayılır */
export const ppgDiffers = (tablePpg: number | null, csvPpg: number | null): boolean =>
  tablePpg !== null && csvPpg !== null && Math.abs(tablePpg - csvPpg) > PPG_TOLERANCE + 1e-9

export const tableAgeText = (days: number): string => (days <= 0 ? 'tablo bugün' : `tablo ${days} gün önce`)

export function standingInfo(standing: Standing, now: Date): StandingInfo {
  const ageDays = Math.max(0, daysBetween(new Date(standing.table.pastedAt), now))
  const { rank, played } = standing.row
  return { text: `Ligde ${rank}. sıra · ${played} maç · ${tableAgeText(ageDays)}`, rank, played, ageDays, stale: ageDays > LEAGUE_TABLE_STALE_DAYS }
}

export interface MatchStandings {
  home: StandingInfo | null
  away: StandingInfo | null
}

/** Maçın iki takımının tablo bilgisi; lig tablosu ya da güvenli eşleşme yoksa ilgili taraf null */
export function matchStandings(match: Match, dayMatches: Match[], tables: LeagueTable[], aliases: TeamAlias[], now: Date): MatchStandings {
  if (tables.length === 0 || !match.league) return { home: null, away: null }
  // Aynı ligin o gün bilinen takımları: normalize eşleşmenin tek anlamlı olup olmadığına bakılır.
  const leagueTeams = [...new Set(dayMatches.filter((m) => m.league === match.league).flatMap((m) => [m.home, m.away]))]
  // "Tablo eski olabilir" yalnızca henüz başlamamış maçta anlamlıdır: maç oynandıktan sonra
  // tablonun CSV'deki maç öncesi değerden ayrışması olağandır. Saat bilinmiyorsa işaret çıkmaz.
  const kickoff = kickoffOf(match)
  const upcoming = kickoff !== null && now.getTime() < kickoff.getTime()
  const gameWeek = stat(match, 'gameWeek')
  const info = (team: string, ppgField: 'homeOverallPpg' | 'awayOverallPpg'): StandingInfo | null => {
    const standing = findStanding(match.league, team, leagueTeams, tables, aliases)
    if (!standing) return null
    const detail: StandingDetail = {
      text: detailText(standing.row),
      maybeOld: upcoming && ppgDiffers(standing.row.ppg, stat(match, ppgField)),
      gameWeek: gameWeek !== null && gameWeek > 0 ? gameWeek : null,
    }
    return { ...standingInfo(standing, now), detail }
  }
  return { home: info(match.home, 'homeOverallPpg'), away: info(match.away, 'awayOverallPpg') }
}

/** Güvenilirlik rozetinin ipucuna eklenen cümle; iki takımın da tablo bilgisi yoksa null */
export function playedHint({ home, away }: MatchStandings): string | null {
  if (!home && !away) return null
  const parts = [home && `ev sahibi ${home.played}`, away && `deplasman ${away.played}`].filter(Boolean).join(', ')
  const age = tableAgeText((home ?? away)!.ageDays)
  return `Lig tablosuna göre oynanan maç: ${parts} (${age}).`
}
