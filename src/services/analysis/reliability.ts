import type { FieldKey } from '../../config/columnAliases'
import type { Match } from '../../types'
import { stat } from './stat'
import type { Reliability, ReliabilityLevel } from './types'

// CSV'de "kaç maç üzerinden hesaplandı" kolonu yok. Örneklem büyüklüğü,
// yüzdelerin alabildiği değerlerden geri çıkarılır: maç yüzdesi, ev sahibinin
// (nh maç) ve deplasmanın (na maç) yüzdelerinin ortalamasıdır; yani her değer
// (a/nh + b/na) / 2 biçiminde olmak zorundadır. Tüm gol yüzdelerini ve maç
// başı puanları (puan = PPG x maç sayısı tam sayı olmalı) açıklayan en küçük
// nh + na aranır. Sonuç bir alt sınırdır: gerçek örneklem daha büyük olabilir.

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

/** PPG iki ondalığa yuvarlandığı için puan = ppg x n tam sayıya n x 0.005 kadar yaklaşmalı */
const fitsPpg = (ppg: number | null, n: number): boolean => {
  if (ppg === null) return true
  const points = ppg * n
  return Math.abs(points - Math.round(points)) <= 0.005 * n + 1e-9
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

export const RELIABILITY_LABELS: Record<ReliabilityLevel, string> = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  unknown: 'Bilinmiyor',
  unmeasured: 'Ölçülemedi',
  market: 'Piyasa tabanlı',
  'market-partial': 'Piyasa (kısmi)',
}
