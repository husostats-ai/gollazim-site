import type { AiDecision, AiProvider } from './config/ai'
import type { CategoryId } from './config/categories'
import type { StoryTexts } from './config/storyTexts'
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
  /** Dondurma anında ana yüzde ile ikinci hesap çelişiyor muydu (Taraf & Gol, ana gol kategorileri) */
  conflict?: boolean
  /** Dondurma anındaki ikinci hesap (xG / gol modeli) yüzdesi; hesaplanamadıysa null */
  secondPercent?: number | null
  /**
   * Dondurma anındaki piyasa yüzdesi (marjsız oran olasılığı); iki yönlü oran yoksa 'none'.
   * Alan hiç yoksa öneri bu özellikten önce dondurulmuştur ya da kategori kapsam dışıdır.
   */
  marketPercent?: number | 'none'
  /** Dondurma anında hazır yüzde ile piyasa çelişiyor muydu; oran yoksa 'none' */
  marketConflict?: boolean | 'none'
}

/** Bir yapay zekânın bir maç için verdiği karar; maç başına her sağlayıcıdan en fazla bir tane */
export interface AiVerdict {
  /** matchId + provider */
  id: string
  matchId: string
  date: string
  provider: AiProvider
  decision: AiDecision
  reason: string
  risk: string
  savedAt: string
}

/**
 * Kopyalanan son prompt'taki numaralandırma. Cevap, kopyalama anındaki
 * numaralara göre eşleştirilir; sonradan eşik değişse de karışmaz.
 */
export interface AiPromptBatch {
  /** date + provider */
  id: string
  date: string
  provider: AiProvider
  createdAt: string
  /** Sıra numarası - 1 konumundaki maç kimliği: matchIds[0] = #1 */
  matchIds: string[]
}

/** Bir gün + kategori için Story görseline girmesi seçilen maçlar. Yalnızca görsel içindir. */
export interface StorySelection {
  /** date + categoryId */
  id: string
  date: string
  categoryId: CategoryId
  matchIds: string[]
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
  /** Eski yedeklerde bulunmaz */
  aiVerdicts?: AiVerdict[]
  aiPrompts?: AiPromptBatch[]
  /** Günlük görselin alt metinleri; eski yedeklerde bulunmaz */
  storyTexts?: StoryTexts
  /** Piyasa çelişkisi sınırı (puan); eski yedeklerde bulunmaz */
  marketConflictLimit?: number
  /** Story görseli maç seçimleri; eski yedeklerde bulunmaz */
  storySelections?: StorySelection[]
}
