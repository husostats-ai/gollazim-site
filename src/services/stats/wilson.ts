// Başarı oranının iki yönlü %95 Wilson güven aralığı (yalnızca ölçüm tablolarında gösterilir).
// Analizdeki temkinli sıralamanın tek yönlü alt sınırından (analysis/cautious) bağımsızdır.

/** İki yönlü %95 güven için z değeri */
const Z = 1.959964

const round1 = (value: number): number => Math.round(value * 10) / 10

/** n sonuçlanmış öneriden won tanesi tuttuysa başarı oranının %95 aralığı (0–100, bir ondalık); n = 0 ise null */
export function wilsonInterval(won: number, n: number): { low: number; high: number } | null {
  if (n <= 0) return null
  const p = won / n
  const z2n = (Z * Z) / n
  const center = (p + z2n / 2) / (1 + z2n)
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2n / (4 * n))) / (1 + z2n)
  return { low: round1(Math.max(0, center - half) * 100), high: round1(Math.min(1, center + half) * 100) }
}
