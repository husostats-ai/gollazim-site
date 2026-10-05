import type { CategoryId } from '../../config/categories'
import type { FieldKey } from '../../config/columnAliases'
import type { Match } from '../../types'

/** Kartta rozet olarak gösterilen kısa uyarı */
export interface PredictionNote {
  kind: 'conflict' | 'weak-xg' | 'model-drift'
  label: string
  /** Üzerine gelince görünen açıklama */
  title: string
}

/** Hesaplayıcının yüzde dışında verebildiği ek bilgiler */
export interface CalcExtras {
  /** Farklı bir yöntemle (xG) hesaplanan ikinci yüzde */
  secondPercent?: number | null
  /** İkinci yüzdenin kartta görünen adı; verilmezse "xG modeli" */
  secondLabel?: string
  /** İki yüzde arasındaki fark çelişki sınırını aşıyor */
  conflict?: boolean
  /** Bu maç için yüzdenin kaynağı; verilmezse hesaplayıcının genel basis değeri */
  basis?: string
  /** Verilirse örneklem tabanlı güvenilirliğin yerine geçer */
  reliability?: Reliability
  /** Yıldız üst sınırı (güvenilirlik sınırına ek olarak) */
  maxStars?: number
  notes?: PredictionNote[]
}

export type CalcResult =
  | { ok: true; percent: number; extras?: CalcExtras }
  /** Gerekli istatistik bu maçta yok; yüzde üretilmez */
  | { ok: false; missing: FieldKey[] }

export interface Calculator {
  /** Yüzdenin neye dayandığı; kartta ve admin panelinde gösterilir */
  basis: string
  requiredFields: FieldKey[]
  calculate(match: Match): CalcResult
}

/**
 * unknown: örneklem bu maç için çıkarılamadı.
 * unmeasured: kategorinin verisi (korner, kart) için örneklem ölçülemiyor.
 * market: yüzde 1X2 ve Alt/Üst oranlarına kalibre edildi.
 * market-partial: yalnızca 1X2 oranı var; toplam gol tahmin edildi.
 */
export type ReliabilityLevel = 'low' | 'medium' | 'high' | 'unknown' | 'unmeasured' | 'market' | 'market-partial'

export type SortMode = 'percent' | 'cautious'

export interface Reliability {
  level: ReliabilityLevel
  /** Yüzdelerin dayandığı tahmini en az maç sayısı (ev + deplasman); çıkarılamadıysa null */
  sampleSize: number | null
}

export interface Prediction {
  match: Match
  categoryId: CategoryId
  /** 0-100, tam sayı */
  percent: number
  /**
   * Örnekleme göre düzeltilmiş yüzde (0-100, tam sayı); sadece temkinli
   * sıralamada kullanılır. Örneklem bilinmiyorsa null. Ham yüzdeyi değiştirmez.
   */
  cautiousPercent: number | null
  /** 1-5 */
  stars: number
  reliability: Reliability
  basis: string
  /** Yalnızca ikinci hesabı olan kategorilerde (Taraf & Gol, ana gol kategorileri) */
  secondPercent?: number | null
  secondLabel: string
  conflict?: boolean
  notes: PredictionNote[]
}

export interface CategoryAnalysis {
  categoryId: CategoryId
  threshold: number
  sortMode: SortMode
  /** Eşiği geçen, seçilen sıralamaya göre dizili, en fazla MAX_MATCHES_PER_CATEGORY öneri */
  predictions: Prediction[]
  /** Eşiği geçen toplam maç (liste kısaltılmadan önce) */
  qualifiedCount: number
  /** Yüzdesi hesaplanabilen maç sayısı */
  evaluatedCount: number
  /** Gerekli istatistik olmadığı için değerlendirilemeyen maç sayısı */
  unavailableCount: number
  /** Değerlendirilemeyen maçlarda eksik olan alanlar */
  missingFields: FieldKey[]
}
