import { categoriesInGroup } from '../../config/categories'
import { BACKUP_ALERT_DAYS, BACKUP_WARN_DAYS, SCORE_DUE_HOURS } from '../../config/reminders'
import type { Match, MatchResult, Pick, SharedPick, Upload } from '../../types'
import { toAppDateTime } from '../../utils/date'
import { activeShared } from '../story/shared'

// Yedek hatırlatıcısı ve günlük kontrol listesi. Yalnızca mevcut kayıtları sayar;
// öneri, dondurma ya da istatistik hesabı yapmaz ve hiçbir kaydı değiştirmez.

/** ok: 0–2 gün; warn: 3–6 gün; alert: 7+ gün; never: veri var ama hiç yedek alınmamış; none: veri yok */
export type BackupLevel = 'none' | 'never' | 'ok' | 'warn' | 'alert'

export interface BackupStatus {
  level: BackupLevel
  /** Son yedekten bu yana geçen takvim günü (Europe/Istanbul); yedek yoksa null */
  days: number | null
  text: string
}

const DAY_MS = 86_400_000
const asUtcDay = (date: string) => new Date(`${date}T00:00:00Z`).getTime()

/** İki an arasındaki takvim günü farkı, Türkiye saatine göre */
export const daysBetween = (earlier: Date, later: Date): number =>
  Math.round((asUtcDay(toAppDateTime(later).date) - asUtcDay(toAppDateTime(earlier).date)) / DAY_MS)

export function backupStatus(lastBackupAt: string | null, now: Date, hasData: boolean): BackupStatus {
  if (!hasData) return { level: 'none', days: null, text: '' }
  if (!lastBackupAt) return { level: 'never', days: null, text: 'Henüz yedek almadın.' }
  const days = Math.max(0, daysBetween(new Date(lastBackupAt), now))
  const ago = days === 0 ? 'Son yedek bugün alındı' : `Son yedek ${days} gün önce`
  if (days >= BACKUP_ALERT_DAYS) return { level: 'alert', days, text: `${ago}, bugün yedek al` }
  return { level: days >= BACKUP_WARN_DAYS ? 'warn' : 'ok', days, text: ago }
}

/** Son yedekten sonra eklenen veri: kayıtlardaki zaman damgalarından sayılır */
export function sinceBackup(lastBackupAt: string | null, results: Pick_<MatchResult, 'updatedAt'>[], uploads: Pick_<Upload, 'uploadedAt'>[]): { scores: number; uploads: number } | null {
  if (!lastBackupAt) return null
  const since = new Date(lastBackupAt).getTime()
  const after = (stamp: string) => new Date(stamp).getTime() > since
  return { scores: results.filter((r) => after(r.updatedAt)).length, uploads: uploads.filter((u) => after(u.uploadedAt)).length }
}

type Pick_<T, K extends keyof T> = { [P in K]: T[P] }

/** Türkiye saati yıl boyu UTC+3'tür */
const APP_UTC_OFFSET = '+03:00'

/**
 * Maçın skoru artık girilebilir mi: saat biliniyorsa başlangıçtan SCORE_DUE_HOURS saat
 * sonra; bilinmiyorsa maç günü geçtiyse.
 */
export function isScoreDue(match: Pick_<Match, 'date' | 'time'>, now: Date): boolean {
  if (match.time && /^\d{2}:\d{2}$/.test(match.time)) {
    return now.getTime() >= new Date(`${match.date}T${match.time}:00${APP_UTC_OFFSET}`).getTime() + SCORE_DUE_HOURS * 3_600_000
  }
  return toAppDateTime(now).date > match.date
}

/** Skoru girilmemiş ya da "tamamlanmadı" bırakılmış; ertelenen ve iptal edilen maç beklenmez */
const isOpen = (result: MatchResult | undefined): boolean => !result || result.status === 'pending'

export interface DayInput {
  /** YYYY-MM-DD */
  date: string
  matches: Match[]
  /** Günün, en az bir kategoride önerilen maçlarının kimlikleri (mevcut analizden) */
  recommendedIds: string[]
  /** Günün dondurulmuş önerileri */
  picks: Pick[]
  /** Günün paylaşım kayıtları (çıkarılmış olanlar dahil) */
  shared: SharedPick[]
}

export interface ChecklistInput {
  now: Date
  today: DayInput
  yesterday: DayInput
  /** Bugünün ve dünün maçlarının girilmiş skorları */
  results: Record<string, MatchResult | undefined>
  /** Herhangi bir günde yüklenmiş veri var mı */
  hasData: boolean
  backup: BackupStatus
}

export type ItemState = 'done' | 'todo' | 'info'

export interface ChecklistItem {
  key: 'csv' | 'scores' | 'counts' | 'sharing' | 'yesterday' | 'backup'
  state: ItemState
  title: string
  text: string
  note?: string
  /** İlgili sayfa (uygulama içi yol) ve bağlantı metni */
  link: { to: string; label: string }
}

export interface Checklist {
  /** Hiç veri yoksa true; liste yerine "Başlamak için CSV yükle" gösterilir */
  empty: boolean
  items: ChecklistItem[]
  /** Yapılacak (todo) madde sayısı */
  todo: number
}

/** Önerisi olup skoru girilebilir hâle gelmiş ama girilmemiş maç sayısı */
export function scoresDue(day: DayInput, results: ChecklistInput['results'], now: Date): number {
  const recommended = new Set(day.recommendedIds)
  return day.matches.filter((m) => recommended.has(m.id) && isOpen(results[m.id]) && isScoreDue(m, now)).length
}

const COUNT_CATEGORY_IDS = [...categoriesInGroup('corners'), ...categoriesInGroup('cards')].map((c) => c.id)

/** Skoru girilmiş ama korner / kart sayısı girilmediği için değerlendirilemeyen öneriler */
export function missingCounts(picks: Pick[]): { picks: number; matches: number } {
  const open = picks.filter((p) => p.outcome === 'void' && COUNT_CATEGORY_IDS.includes(p.categoryId))
  return { picks: open.length, matches: new Set(open.map((p) => p.matchId)).size }
}

/** Günün geçerli paylaşım kayıtları: kaç kategoride görsel indirildi, kaç öneri paylaşıldı */
export function sharingOf(day: DayInput): { categories: number; picks: number } {
  const records = activeShared(day.shared).filter((r) => r.date === day.date)
  return { categories: new Set(records.map((r) => r.categoryId)).size, picks: records.length }
}

/** Dünün paylaşılan önerilerinden, maçının skoru henüz girilmemiş olanlar */
export function sharedPending(day: DayInput, results: ChecklistInput['results']): { total: number; pending: number } {
  const records = activeShared(day.shared).filter((r) => r.date === day.date)
  return { total: records.length, pending: records.filter((r) => isOpen(results[r.matchId])).length }
}

export const START_TEXT = 'Başlamak için CSV yükle'

/** Ana sayfadaki günlük kontrol listesi. */
export function buildChecklist(input: ChecklistInput): Checklist {
  const { now, today, yesterday, results, backup } = input
  if (!input.hasData) return { empty: true, items: [], todo: 0 }

  const items: ChecklistItem[] = []
  const hasToday = today.matches.length > 0
  items.push({
    key: 'csv',
    state: hasToday ? 'done' : 'todo',
    title: 'Bugünün CSV’si',
    text: hasToday ? `${today.matches.length} maç` : 'Bugün için CSV yok',
    link: { to: '/admin', label: 'CSV yükle' },
  })

  const dueToday = scoresDue(today, results, now)
  const dueYesterday = scoresDue(yesterday, results, now)
  items.push({
    key: 'scores',
    state: dueToday + dueYesterday > 0 ? 'todo' : 'done',
    title: 'Skor bekleyen',
    text: `Bugün: ${dueToday} maç · Dünden kalan: ${dueYesterday}`,
    note: `Önerisi olan ve başlangıcından ${SCORE_DUE_HOURS} saat geçmiş, skoru girilmemiş maçlar.`,
    link: { to: '/skor-girisi', label: 'Skor gir' },
  })

  const counts = missingCounts([...today.picks, ...yesterday.picks])
  items.push({
    key: 'counts',
    state: counts.picks > 0 ? 'todo' : 'done',
    title: 'Korner / kart sayısı',
    text: counts.picks > 0 ? `${counts.matches} maçta ${counts.picks} öneri için sayı girilmedi (bugün ve dün)` : 'Eksik korner / kart sayısı yok (bugün ve dün)',
    note: counts.picks > 0 ? 'Girilmezse bu öneriler değerlendirilemedi kalır.' : undefined,
    link: { to: '/skor-girisi', label: 'Sayıları gir' },
  })

  const sharing = sharingOf(today)
  items.push({
    key: 'sharing',
    state: sharing.picks > 0 ? 'done' : 'info',
    title: 'Paylaşım',
    text: sharing.picks > 0 ? `Bugün ${sharing.categories} kategoride görsel indirildi, ${sharing.picks} öneri paylaşıldı` : 'Bugün görsel indirilmedi',
    link: { to: '/', label: 'Önerilere git' },
  })

  const pending = sharedPending(yesterday, results)
  items.push({
    key: 'yesterday',
    state: pending.total === 0 ? 'info' : pending.pending > 0 ? 'todo' : 'done',
    title: 'Dünün sonucu',
    text:
      pending.total === 0
        ? 'Dün paylaşılan öneri yok'
        : pending.pending > 0
          ? `${pending.pending} paylaşılan öneri bekliyor`
          : 'Dünün sonuç görseli hazırlanabilir',
    link: pending.pending > 0 ? { to: '/skor-girisi', label: 'Skor gir' } : { to: '/istatistik', label: 'Günlük görsel' },
  })

  items.push({
    key: 'backup',
    state: backup.level === 'ok' ? 'done' : 'todo',
    title: 'Yedek',
    text: backup.text,
    link: { to: '/admin', label: 'Yedek al' },
  })

  return { empty: false, items, todo: items.filter((i) => i.state === 'todo').length }
}
