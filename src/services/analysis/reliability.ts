import type { FieldKey } from '../../config/columnAliases'
import type { Match } from '../../types'
import { stat } from './stat'
import type { Reliability, ReliabilityLevel } from './types'

// CSV'de "kaç maç üzerinden hesaplandı" kolonu yok. Örneklem büyüklüğü,
// yüzdelerin alabildiği değerlerden geri çıkarılır: maç yüzdesi, ev sahibinin
// (nh maç) ve deplasmanın (na maç) yüzdelerinin ortalamasıdır; yani her değer
// (a/nh + b/na) / 2 biçiminde olmak zorundadır. Tüm gol yüzdelerini ve maç
// başı puanları (puan = PPG x maç sayısı, o kadar maçta alınabilecek bir puan
// olmalı) açıklayan en küçük nh + na aranır. Sonuç bir alt sınırdır ve ev sahibinin
// iç saha + deplasmanın dış saha maçlarını sayar; lig tablosundaki toplam değildir.

const PERCENT_FIELDS: FieldKey[] = [
  'bttsPct',
  'over05Pct',
  'over15Pct',
  'over25Pct',
  'over35Pct',
  'over45Pct',
  'ht05Pct',
  'ht15Pct',
  'sh05Pct',
  'sh15Pct',
]

const MAX_TOTAL = 40
/** CSV'deki yüzdeler tam sayıya yuvarlandığı için tolerans */
const PERCENT_TOLERANCE = 1
/** Güvenilir bir tahmin için gereken en az yüzde kolonu */
const MIN_PERCENT_VALUES = 4

/** Örneklem sayısının neyi ifade ettiği; kartta ipucu olarak, prompt ve özette açıklama olarak kullanılır */
export const SAMPLE_HINT =
  'Ev sahibinin iç saha + deplasmanın dış saha maçları, CSV yüzdelerinden çıkarılan tahmini alt sınır. Lig tablosundaki toplam oynanan maç sayısı değildir.'

/** Kartta ve prompt'ta örneklem sayısının yazımı */
export const sampleText = (sampleSize: number): string => `en az ${sampleSize} saha maçı (tahmini)`

export const RELIABILITY_LIMITS = { medium: 8, high: 16 } as const

const achievableCache = new Map<string, number[]>()
const achievable = (nh: number, na: number): number[] => {
  const key = `${nh}:${na}`
  let values = achievableCache.get(key)
  if (!values) {
    values = []
    for (let a = 0; a <= nh; a++) for (let b = 0; b <= na; b++) values.push((100 * a) / nh / 2 + (100 * b) / na / 2)
    achievableCache.set(key, values)
  }
  return values
}

const fitsPercents = (percents: number[], nh: number, na: number): boolean => {
  const values = achievable(nh, na)
  return percents.every((p) => values.some((v) => Math.abs(p - v) <= PERCENT_TOLERANCE))
}

/**
 * n maçta toplanabilecek bir puan mı: puan = 3 x galibiyet + beraberlik ve
 * galibiyet + beraberlik <= n olmalı. 0..3n arasındaki tam sayılardan yalnızca
 * 3n - 1 üretilemez (ör. 1 maçta 2 puan, 2 maçta 5 puan alınamaz).
 */
export const isPossiblePoints = (points: number, n: number): boolean =>
  Number.isInteger(points) && points >= 0 && points <= 3 * n && points !== 3 * n - 1

/**
 * PPG iki ondalığa yuvarlandığı için puan = ppg x n bir tam sayıya n x 0.005 kadar
 * yaklaşmalı; o tam sayı da n maçta gerçekten alınabilecek bir puan olmalı.
 */
export const fitsPpg = (ppg: number | null, n: number): boolean => {
  if (ppg === null) return true
  const points = ppg * n
  const rounded = Math.round(points)
  return Math.abs(points - rounded) <= 0.005 * n + 1e-9 && isPossiblePoints(rounded, n)
}

export const levelForSample = (sampleSize: number | null): ReliabilityLevel => {
  if (sampleSize === null) return 'unknown'
  if (sampleSize >= RELIABILITY_LIMITS.high) return 'high'
  if (sampleSize >= RELIABILITY_LIMITS.medium) return 'medium'
  return 'low'
}

export function estimateSampleSize(match: Match): number | null {
  const percents = PERCENT_FIELDS.map((f) => stat(match, f)).filter((v): v is number => v !== null)
  if (percents.length < MIN_PERCENT_VALUES) return null
  const homePpg = stat(match, 'homePpg')
  const awayPpg = stat(match, 'awayPpg')

  for (let total = 2; total <= MAX_TOTAL; total++) {
    for (let nh = 1; nh < total; nh++) {
      const na = total - nh
      if (fitsPpg(homePpg, nh) && fitsPpg(awayPpg, na) && fitsPercents(percents, nh, na)) return total
    }
  }
  return null
}

export const assessReliability = (match: Match): Reliability => {
  const sampleSize = estimateSampleSize(match)
  return { level: levelForSample(sampleSize), sampleSize }
}

export const UNMEASURED: Reliability = { level: 'unmeasured', sampleSize: null }

/**
 * Arayüzde görünen ad ve seviye etiketleri. Seviye, yüzdenin kaç maçlık veriye dayandığını
 * anlatır; maçın sonucuna duyulan güveni değil. Mantık, eşikler ve yıldız sınırları aynıdır;
 * yalnızca görünen metin budur.
 */
export const DATA_TERM = 'Geçmiş veri'
export const DATA_LABELS: Record<ReliabilityLevel, string> = {
  low: 'Az',
  medium: 'Orta',
  high: 'Çok',
  unknown: 'Bilinmiyor',
  unmeasured: 'Ölçülemedi',
  market: 'Piyasa tabanlı',
  'market-partial': 'Piyasa (kısmi)',
}

/**
 * AI ANALİZİ promptunda ve "Analiz için özet" metninde kullanılan ESKİ etiketler. Bu iki metin
 * yapay zekâya girdi olduğu için bilerek değiştirilmedi; arayüz DATA_LABELS kullanır.
 */
export const RELIABILITY_LABELS: Record<ReliabilityLevel, string> = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  unknown: 'Bilinmiyor',
  unmeasured: 'Ölçülemedi',
  market: 'Piyasa tabanlı',
  'market-partial': 'Piyasa (kısmi)',
}
