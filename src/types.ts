import type { CategoryId } from './config/categories'
import type { ReliabilityLevel } from './services/analysis/types'

export type StatValue = number | string | null

export interface Match {
  /** tarih + takımlardan türetilir; aynı maç tekrar yüklenirse kayıt güncellenir */
  id: string
  uploadId: string
  /** YYYY-MM-DD (Europe/Istanbul) */
  date: string
  /** HH:mm */
  time?: string
  league?: string
  home: string
  away: string
  /** CSV'deki tüm kolonlar; tanınmayanlar da atılmadan saklanır */
  stats: Record<string, StatValue>
  /** Admin panelinden elle düzenlendi; aynı maç CSV ile tekrar gelirse üzerine yazılmaz */
  edited?: boolean
}

export interface Upload {
  id: string
  fileName: string
  uploadedAt: string
  matchCount: number
}

/** pending: henüz bitmedi. Sadece completed maçlar kazandı/kaybetti olarak değerlendirilir. */
export type MatchStatus = 'pending' | 'completed' | 'postponed' | 'cancelled'

export interface MatchResult {
  matchId: string
  status: MatchStatus
  htHome: number | null
  htAway: number | null
  ftHome: number | null
  ftAway: number | null
  cornersHome: number | null
  cornersAway: number | null
  cardsHome: number | null
  /** Sarı + kırmızı kart toplamı */
  cardsAway: number | null
  updatedAt: string
}

/**
 * void: maç tamamlandı ama gerekli veri (ör. korner sayısı) girilmediği için
 * değerlendirilemedi. pending: maç tamamlanmadı, ertelendi veya iptal.
 * İstatistiklere sadece won ve lost girer.
 */
export type PickOutcome = 'won' | 'lost' | 'void' | 'pending'

/**
 * Maç ilk kez "tamamlandı" olarak kaydedildiği anda dondurulan öneri. Yüzde ve
 * eşik sonradan değişmez; skor düzeltilirse sadece outcome yeniden hesaplanır.
 */
export interface Pick {
  /** matchId + categoryId */
  id: string
  matchId: string
  categoryId: CategoryId
  date: string
  percent: number
  threshold: number
  outcome: PickOutcome
  frozenAt: string
  /** Dondurma anındaki veri güvenilirliği; eski kayıtlarda bulunmayabilir */
  reliability?: ReliabilityLevel
  /** Dondurma anında ana hesap ile xG hesabı çelişiyor muydu (yalnızca Taraf & Gol) */
  conflict?: boolean
}

export type Thresholds = Record<CategoryId, number>

export interface BackupFile {
  app: 'gollazim'
  version: 1
  exportedAt: string
  uploads: Upload[]
  matches: Match[]
  results: MatchResult[]
  picks: Pick[]
  thresholds: Thresholds
}
