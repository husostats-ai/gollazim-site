import { poissonAtLeast } from '../poisson'
import { stat } from '../stat'
import type { Calculator } from '../types'

/**
 * Maç başı kart ortalamasından Poisson ile "çizgi üstü" olasılığı.
 * Örn. çizgi 3.5 ise P(kart >= 4).
 */
export const cardsOver = (line: number): Calculator => ({
  basis: `Kart ortalaması (Poisson, ${line} üst)`,
  requiredFields: ['avgCards'],
  calculate(match) {
    const average = stat(match, 'avgCards')
    // Ortalama 0 gerçek bir değer değil, "veri yok" anlamına gelir.
    if (average === null || average <= 0) return { ok: false, missing: ['avgCards'] }
    return { ok: true, percent: Math.round(poissonAtLeast(Math.floor(line) + 1, average) * 100) }
  },
})
