import type { Match } from '../../types'
import { stat } from './stat'

// Maç öncesi xG'nin ve gol / kart / korner ortalamalarının GÖSTERİMİ için kullanılabilirlik
// kuralları. Hesaplardaki kurallarla aynıdır (goalModel, over25Btts, sideGoals, cardsOver).
// Kaynakta eksik değer "0" (kart ortalamasında bazen negatif) olarak geldiği için bunlar
// gerçek bir değer değil, "veri yok" demektir.
// - xG: iki takımın da xG'si sıfırdan büyük olmalıdır; biri eksikse hesaplar ikisini birden yok sayar.
// - Gol ortalaması ve kart ortalaması: sıfırdan büyük olmalıdır.
// - Korner ortalaması hiçbir hesapta kullanılmaz (korner listeleri hazır yüzdelere dayanır);
//   gösterimde aynı kural uygulanır: sıfırdan büyük olmalıdır.
// Maç başı puan (PPG) bu kuralların dışındadır: 0 gerçek bir değer olabilir.
// Bu dosya hiçbir hesabı ve saklanan hiçbir veriyi değiştirmez.

/** Gösterimde eksik değerin karşılığı */
export const STAT_MISSING_TEXT = 'veri yok'

/** İki takımın da kullanılabilir (pozitif) xG'si varsa değerler; yoksa null */
export function usableXg(match: Match): { home: number; away: number } | null {
  const home = stat(match, 'homeXg')
  const away = stat(match, 'awayXg')
  return home !== null && away !== null && home > 0 && away > 0 ? { home, away } : null
}

/** Kullanılabilir (pozitif) gol ortalaması; 0, negatif ya da boşsa null */
export function usableAvgGoals(match: Match): number | null {
  const avgGoals = stat(match, 'avgGoals')
  return avgGoals !== null && avgGoals > 0 ? avgGoals : null
}

const positive = (value: number | null): number | null => (value !== null && value > 0 ? value : null)

/** Kullanılabilir (pozitif) kart ortalaması; 0, negatif ya da boşsa null */
export const usableAvgCards = (match: Match): number | null => positive(stat(match, 'avgCards'))

/** Gösterilebilir (pozitif) korner ortalaması; 0, negatif ya da boşsa null */
export const usableAvgCorners = (match: Match): number | null => positive(stat(match, 'avgCorners'))
