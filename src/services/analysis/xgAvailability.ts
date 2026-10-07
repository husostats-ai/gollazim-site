import type { Match } from '../../types'
import { stat } from './stat'

// Maç öncesi xG'nin GÖSTERİMİ için kullanılabilirlik kuralı. Hesaplardaki kuralla aynıdır
// (goalModel, over25Btts, sideGoals): iki takımın da xG'si sıfırdan büyük olmalıdır. Kaynakta
// eksik xG "0" olarak geldiği için 0 gerçek bir beklenti değil, "veri yok" demektir; biri
// eksikse hesaplar ikisini birden yok sayar. Bu dosya hiçbir hesabı değiştirmez.

/** Gösterimde eksik xG'nin karşılığı */
export const XG_MISSING_TEXT = 'veri yok'

/** İki takımın da kullanılabilir (pozitif) xG'si varsa değerler; yoksa null */
export function usableXg(match: Match): { home: number; away: number } | null {
  const home = stat(match, 'homeXg')
  const away = stat(match, 'awayXg')
  return home !== null && away !== null && home > 0 && away > 0 ? { home, away } : null
}
