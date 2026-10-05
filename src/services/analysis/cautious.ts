/** Tek taraflı %95 güven için z değeri */
const Z = 1.645

/**
 * Temkinli yüzde: Wilson güven aralığının alt sınırı. "n maçta bu oran
 * gözlendiyse, gerçek oran %95 olasılıkla en az kaçtır" sorusunun cevabıdır;
 * örneklem küçüldükçe değer düşer. Örn. 4 maçta %100 -> %60, 18 maçta %84 -> %66.
 * Örneklem bilinmiyorsa null döner.
 */
export const cautiousPercent = (percent: number, sampleSize: number | null): number | null => {
  if (sampleSize === null || sampleSize <= 0) return null
  const p = percent / 100
  const z2n = (Z * Z) / sampleSize
  const center = p + z2n / 2
  const margin = Z * Math.sqrt((p * (1 - p)) / sampleSize + z2n / (4 * sampleSize))
  return Math.round((Math.max(0, center - margin) / (1 + z2n)) * 100)
}
