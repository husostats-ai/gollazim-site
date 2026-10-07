import type { Match } from '../../types'
import { stat } from './stat'

// Maç öncesi xG'nin ve gol ortalamasının GÖSTERİMİ için kullanılabilirlik kuralları.
// Hesaplardaki kurallarla aynıdır (goalModel, over25Btts, sideGoals). Kaynakta eksik değer
// "0" olarak geldiği için 0 gerçek bir değer değil, "veri yok" demektir.
// - xG: iki takımın da xG'si sıfırdan büyük olmalıdır; biri eksikse hesaplar ikisini birden yok sayar.
// - Gol ortalaması: sıfırdan büyük olmalıdır.
// Bu dosya hiçbir hesabı değiştirmez.

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
