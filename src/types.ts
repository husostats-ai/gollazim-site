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
  /** Maç ilk "tamamlandı" kaydedilirken alınan skor olasılıkları; sonradan değişmez */
  scoreSnapshot?: ScoreSnapshot
}

export interface ScoreLine {
  home: number
  away: number
}

/**
 * Skor modelinin maç skoru girildiği andaki tahmini (deney amaçlı, iç kullanım).
 * source 'none': oran da xG de yoktu; diğer alanlar yazılmaz.
 */
export interface ScoreSnapshot {
  source: 'market' | 'market-side' | 'xg' | 'none'
  /** Anlık görüntünün alındığı an (ISO) */
  takenAt: string
  /** En olası skor */
  best?: ScoreLine
  /** En olası üç skor ve yüzdeleri (bir ondalık) */
  top?: (ScoreLine & { percent: number })[]
  /** 1 / X / 2 olasılıkları, yüzde (bir ondalık) */
  outcome?: { home: number; draw: number; away: number }
  /** Beklenen toplam gol */
  expectedGoals?: number
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
  /** Dondurma anında kartta görünen yıldız sayısı (1-5); eski kayıtlarda bulunmaz */
  stars?: number
  /**
   * Yalnızca Taraf & Gol: dondurma anında model piyasadan sapıyor muydu (yıldızı sınırlar);
   * piyasa oranı olmadığı için ölçülemediyse 'none'. Eski kayıtlarda bulunmaz.
   */
  modelDrift?: boolean | 'none'
}

/**
 * Bir yapay zekânın bir maç için verdiği cevap; maç başına her sağlayıcıdan en fazla bir tane.
 * Kararlar kategori bazındadır (byCategory). Kategori bazlı karara geçilmeden önce kaydedilmiş
 * cevaplarda yalnızca maç geneli tek karar (decision) vardır: bunlar "maç geneli (eski)" sayılır,
 * kategori kararına çevrilmez ve üyeye gitmez.
 */
export interface AiVerdict {
  /** matchId + provider */
  id: string
  matchId: string
  date: string
  provider: AiProvider
  /**
   * ESKİ biçim: maçın tüm önerilerini birlikte kapsayan tek karar. Yeni cevaplarda yoktur; eski
   * kararı olan maça yeni biçimli cevap kaydedilirse eski karar burada saklanmaya devam eder.
   */
  decision?: AiDecision
  /** Kategori bazlı kararlar; alanın bulunması cevabın yeni biçimde olduğunu gösterir */
  byCategory?: Partial<Record<CategoryId, AiDecision>>
  /** Bu cevap için sorulan kategoriler (prompttaki "Değerlendir" satırı); kararı olmayan "cevapsız"dır */
  asked?: CategoryId[]
  reason: string
  risk: string
  savedAt: string
  /** Yapay zekânın skor tahmini (isteğe bağlı); tahmin zamanı savedAt'tir */
  score?: ScoreLine
  /** Tahmin maç başladıktan sonra kaydedildi: gösterilir ama ölçüme girmez */
  scoreLate?: boolean
}

/**
 * "AI öneri güveni" satırı üye paketiyle gönderilen önerinin kaydı (maç + kategori başına bir tane). Yalnızca
 * kayıttır: ileride "üyeye giden AI onaylı maçlar" ile diğerlerinin isabetini karşılaştırmak için
 * tutulur; hiçbir hesabı ve gösterimi değiştirmez.
 */
export interface AiShare {
  /** matchId + categoryId; kategori bazlı karardan önceki kayıtlarda yalnızca matchId */
  id: string
  matchId: string
  /** Satırın ait olduğu liste. Eski (maç geneli) kayıtlarda yoktur. */
  categoryId?: CategoryId
  date: string
  /** Satırın ilk gittiği yayın (numara ve an) */
  firstN: number
  firstAt: string
  /** Satırın en son gittiği yayın; sonraki yayınlarda yoksa bu değer eski kalır */
  lastN: number
  lastAt: string
  /** Son gönderimdeki kararların kopyası (yalnızca seviye) */
  votes: { provider: AiProvider; decision: Exclude<AiDecision, 'reject'> }[]
  count: number
  decision: 'strong' | 'medium'
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
  /**
   * Her maç için prompttaki "Değerlendir" satırının kategorileri (matchIds ile aynı sırada).
   * Kategori bazlı karardan önce kopyalanmış promptlarda yoktur; o kayıtlar geçersiz sayılır.
   */
  categories?: CategoryId[][]
}

/** Bir gün + kategori için Story görseline girmesi seçilen maçlar. Yalnızca görsel içindir. */
export interface StorySelection {
  /** date + categoryId */
  id: string
  date: string
  categoryId: CategoryId
  matchIds: string[]
}

/**
 * İndirilen bir kategori Story görselinde yer aldığı için "paylaşıldı" sayılan öneri.
 * Kalıcı kayıttır: elle çıkarılınca silinmez, removedAt ile işaretlenir.
 */
export interface SharedPick {
  /** date + categoryId + matchId + sharedAt */
  id: string
  date: string
  categoryId: CategoryId
  matchId: string
  /** Görselin indirildiği an (ISO) */
  sharedAt: string
  /** Kayıt, maç başladıktan sonra yapıldı */
  afterKickoff: boolean
  /** Paylaşılandan elle çıkarıldığı an; yoksa kayıt geçerlidir */
  removedAt?: string
}

/**
 * "Günün öne çıkanları" seçimi: admin'in maç başlamadan önce elle işaretlediği bir öneri.
 * Yalnızca admin sitesindedir; üye paketine girmez. Maç başladıktan sonra eklenemez ve silinemez.
 */
export interface Highlight {
  /** date + matchId + categoryId */
  id: string
  date: string
  matchId: string
  categoryId: CategoryId
  /** Eklenme anı (ISO) */
  addedAt: string
  // Eklenme anındaki görünüm: maç verisi sonradan silinse de liste bu alanlardan gösterilir.
  home: string
  away: string
  /** HH:mm (Türkiye saati); saati bilinmeyen maç eklenemez */
  time: string
  league?: string
  /** Eklenme anındaki hazır yüzde (0-100) */
  percent: number
  /** Eklenme anındaki güvenilirlik seviyesi */
  reliability?: ReliabilityLevel
  /**
   * Seçimin üye paketiyle ilk yayınlandığı an (ISO). Yayınlanan seçim, maç başlamamış olsa da
   * kaldırılamaz: üyelerin gördüğü seçim sonradan sessizce kaybolmaz.
   */
  publishedAt?: string
}

/** Yapıştırılan lig tablosundan saklanan satır (yalnızca gösterim içindir) */
export interface LeagueTableRow {
  team: string
  rank: number
  /** Oynanan maç (MP) */
  played: number
  points: number
  /** Tabloda yazan maç başı puan; okunamadıysa null */
  ppg: number | null
}

/** Bir ligin en son yapıştırılan tablosu; aynı lig yeniden yapıştırılınca üzerine yazılır */
export interface LeagueTable {
  /** league ile aynı */
  id: string
  /** Maç kaydındaki lig adı ("England · Professional Development League") */
  league: string
  /** Yapıştırma anı (ISO) */
  pastedAt: string
  rows: LeagueTableRow[]
}

/** Kullanıcının "bu takım hangisi?" seçimi: CSV'deki ad -> tablodaki ad ('' = tabloda yok) */
export interface TeamAlias {
  /** league + csvTeam */
  id: string
  league: string
  csvTeam: string
  tableTeam: string
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
  /** Paylaşılan öneriler kaydı (çıkarılmış olanlar dahil); eski yedeklerde bulunmaz */
  sharedPicks?: SharedPick[]
  /** Yapıştırılan lig tabloları ve takım adı eşleştirmeleri; eski yedeklerde bulunmaz */
  leagueTables?: LeagueTable[]
  teamAliases?: TeamAlias[]
  /** "Günün öne çıkanları" seçimleri; eski yedeklerde ve hiç seçim yokken bulunmaz */
  highlights?: Highlight[]
  /** "AI öneri güveni" satırı üyeye giden maçların kaydı; eski yedeklerde ve hiç kayıt yokken bulunmaz */
  aiShares?: AiShare[]
}
