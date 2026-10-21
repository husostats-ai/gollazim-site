import { LEAGUE_TABLE_STALE_DAYS } from '../../config/reminders'
import type { LeagueTable, LeagueTableSnapshot, Match, TeamAlias } from '../../types'
import { stat } from '../analysis/stat'
import { daysBetween } from '../daily/checklist'
import { kickoffOf } from '../highlights/highlights'
import { snapshotAt } from './history'
import { findStanding, matchTeams, type Standing } from './matching'

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
  /** Yalnızca admin kartındaki "tablo eski olabilir" / "CSV turu tabloyla uyuşmuyor" işareti ve lig turu; matchStandings doldurur */
  detail?: StandingDetail
}

/** Tablo PPG'si ile CSV'deki genel PPG arasında bu kadardan fazla fark varsa tablo eski sayılır */
export const PPG_TOLERANCE = 0.01

export interface StandingDetail {
  /**
   * Tablodaki PPG CSV'deki maç öncesi genel PPG'den farklı ve tablo MP'si CSV turuyla tutarlı değilse
   * nedeni (yalnızca başlamamış maçlarda); yoksa null. Kartta STANDING_BLOCK_TEXT ile gösterilir.
   */
  block: PpgBlock | null
  /** CSV'deki lig turu; yoksa null. Yalnızca bilgi içindir, uyarı üretmez */
  gameWeek: number | null
}

/** Tablo PPG'si CSV'deki genel PPG'den toleranstan fazla mı ayrışıyor; biri yoksa ayrışmıyor sayılır */
export const ppgDiffers = (tablePpg: number | null, csvPpg: number | null): boolean =>
  tablePpg !== null && csvPpg !== null && Math.abs(tablePpg - csvPpg) > PPG_TOLERANCE + 1e-9

/**
 * Tablodaki maç sayısı CSV'deki lig turuyla tutarlı mı (bu turdan önce tam bir önceki tur kadar maç).
 * Tutarlıysa tablo güncel sayılır; PPG farkı CSV'nin başka maçları da saymasındandır (ör. Avrupa
 * kupalarında eleme maçları), tablonun eskiliğinden değil.
 */
export const roundConsistent = (played: number, gameWeek: number | null): boolean => gameWeek !== null && gameWeek > 0 && played === gameWeek - 1

/** PPG farkının nedeni. ppg-differs: tablo MP'si CSV turu − 1'den az ya da tur yok (tablo eski olabilir); round-mismatch: tablo MP'si fazla (CSV turu tutarsız) */
export type PpgBlock = 'ppg-differs' | 'round-mismatch'

/** Admin kartında sıra satırının yanına yazılan neden; form satırının notu da bununla başlar */
export const STANDING_BLOCK_TEXT: Record<PpgBlock, string> = {
  'ppg-differs': '⚠ tablo eski olabilir',
  'round-mismatch': 'CSV turu tabloyla uyuşmuyor',
}

/** PPG farkı tur tutarlılığıyla açıklanamıyorsa nedeni; açıklanıyorsa ya da fark yoksa null */
export function ppgBlock(tablePpg: number | null, played: number, csvPpg: number | null, gameWeek: number | null): PpgBlock | null {
  if (!ppgDiffers(tablePpg, csvPpg) || roundConsistent(played, gameWeek)) return null
  // Tablo turdan ileride (ya da CSV turu 1): CSV turu tutarsız, tablo eski değil.
  return gameWeek !== null && gameWeek > 0 && played > gameWeek - 1 ? 'round-mismatch' : 'ppg-differs'
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
  // "Tablo eski olabilir" yalnızca henüz başlamamış maçta anlamlıdır: maç oynandıktan sonra
  // tablonun CSV'deki maç öncesi değerden ayrışması olağandır. Saat bilinmiyorsa işaret çıkmaz.
  const kickoff = kickoffOf(match)
  const upcoming = kickoff !== null && now.getTime() < kickoff.getTime()
  const gameWeek = stat(match, 'gameWeek')
  const info = (team: string, ppgField: 'homeOverallPpg' | 'awayOverallPpg'): StandingInfo | null => {
    const standing = findStanding(match.league, team, leagueTeams, tables, aliases)
    if (!standing) return null
    const detail: StandingDetail = {
      block: upcoming ? ppgBlock(standing.row.ppg, standing.row.played, stat(match, ppgField), gameWeek) : null,
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

// FORM, GOL ve "gol yemediği maç": kartta sabit satırlar olarak gösterilen tablo sütunları.
// Kaynak, maçın başlama saatinden ÖNCE yapıştırılmış son görüntüdür: maç oynandıktan sonra tablo
// yenilense de kart o maçtan önceki değerleri gösterir (maçın kendi sonucu forma karışmaz).
// Yalnızca gösterimdir; analize, yıldıza, sıralamaya, dondurmaya ve AI prompt'una girmez.

/**
 * Satırın üyeye GİTMEME nedeni. ppg-differs: tablo PPG'si CSV'deki maç öncesi genel PPG'den farklı ve
 * tablo MP'si CSV turu − 1'den az ya da tur yok (tablo eski olabilir). round-mismatch: PPG farklı ve
 * tablo MP'si CSV turu − 1'den fazla (CSV turu tutarsız). unverifiable: iki PPG'den biri yok, karşılaştırılamıyor.
 * old-snapshot: görüntü maç saatinden LEAGUE_TABLE_STALE_DAYS günden eski.
 */
export type FormBlock = PpgBlock | 'unverifiable' | 'old-snapshot'

export interface TeamForm {
  /** "Last 5", yapıştırıldığı gibi: soldan sağa eskiden yeniye; yoksa null */
  last5: string | null
  goalsFor: number
  goalsAgainst: number
  /** Gol yememe yüzdesi (0-100); yoksa null */
  cs: number | null
  /** Üyeye gitmeme nedeni; null ise satır doğrulanmıştır ve üye kartında da gösterilir */
  blocked: FormBlock | null
}

export interface MatchForms {
  home: TeamForm | null
  away: TeamForm | null
}

/** Admin kartında, üyeye gitmeyen satırın yanına yazılan not */
export const FORM_BLOCK_TEXT: Record<FormBlock, string> = {
  'ppg-differs': `${STANDING_BLOCK_TEXT['ppg-differs']} · üyeye gitmez`,
  'round-mismatch': `${STANDING_BLOCK_TEXT['round-mismatch']} · üyeye gitmez`,
  unverifiable: 'doğrulanamadı · üyeye gitmez',
  'old-snapshot': `tablo maçtan ${LEAGUE_TABLE_STALE_DAYS} günden eski · üyeye gitmez`,
}

/**
 * Maçın iki takımının form satırı. Saat bilinmiyorsa, maçtan önce yapıştırılmış görüntü yoksa,
 * takım o görüntüde güvenle eşleşmiyorsa ya da görüntüde gol sütunları yoksa ilgili taraf null.
 */
export function matchForms(match: Match, dayMatches: Match[], snapshots: LeagueTableSnapshot[], aliases: TeamAlias[]): MatchForms {
  const kickoff = kickoffOf(match)
  if (!match.league || !kickoff || snapshots.length === 0) return { home: null, away: null }
  const snapshot = snapshotAt(snapshots, match.league, kickoff)
  if (!snapshot) return { home: null, away: null }
  const leagueTeams = [...new Set([...dayMatches.filter((m) => m.league === match.league).flatMap((m) => [m.home, m.away]), match.home, match.away])]
  const matched = matchTeams(match.league, leagueTeams, snapshot.rows, aliases)
  // Aynı içerik maçtan önce yeniden yapıştırıldıysa tablo o an da günceldi.
  const seenAt = snapshot.lastSeenAt && Date.parse(snapshot.lastSeenAt) < kickoff.getTime() ? snapshot.lastSeenAt : snapshot.pastedAt
  const old = daysBetween(new Date(seenAt), kickoff) > LEAGUE_TABLE_STALE_DAYS
  const gameWeek = stat(match, 'gameWeek')
  const form = (team: string, ppgField: 'homeOverallPpg' | 'awayOverallPpg'): TeamForm | null => {
    const row = matched.find((m) => m.csvTeam === team)?.row
    if (!row || row.goalsFor === undefined || row.goalsAgainst === undefined) return null
    const csvPpg = stat(match, ppgField)
    const blocked: FormBlock | null = ppgBlock(row.ppg, row.played, csvPpg, gameWeek) ?? (row.ppg === null || csvPpg === null ? 'unverifiable' : old ? 'old-snapshot' : null)
    return { last5: row.last5 ?? null, goalsFor: row.goalsFor, goalsAgainst: row.goalsAgainst, cs: row.cs !== undefined && Number.isInteger(row.cs) ? row.cs : null, blocked }
  }
  return { home: form(match.home, 'homeOverallPpg'), away: form(match.away, 'awayOverallPpg') }
}
