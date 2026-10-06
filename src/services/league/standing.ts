import { LEAGUE_TABLE_STALE_DAYS } from '../../config/reminders'
import type { LeagueTable, Match, TeamAlias } from '../../types'
import { daysBetween } from '../daily/checklist'
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
}

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
  const info = (team: string) => {
    const standing = findStanding(match.league, team, leagueTeams, tables, aliases)
    return standing ? standingInfo(standing, now) : null
  }
  return { home: info(match.home), away: info(match.away) }
}

/** Güvenilirlik rozetinin ipucuna eklenen cümle; iki takımın da tablo bilgisi yoksa null */
export function playedHint({ home, away }: MatchStandings): string | null {
  if (!home && !away) return null
  const parts = [home && `ev sahibi ${home.played}`, away && `deplasman ${away.played}`].filter(Boolean).join(', ')
  const age = tableAgeText((home ?? away)!.ageDays)
  return `Lig tablosuna göre oynanan maç: ${parts} (${age}).`
}
