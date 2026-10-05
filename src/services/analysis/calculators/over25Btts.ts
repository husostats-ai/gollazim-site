import { probOver25AndBtts } from '../poisson'
import { stat } from '../stat'
import type { Calculator } from '../types'

/** Maç öncesi xG değerlerinden Poisson ile 2.5 Üst ve KG Var'ın birlikte gerçekleşme olasılığı. */
export const over25Btts: Calculator = {
  basis: 'Maç öncesi xG (Poisson, ortak olasılık)',
  requiredFields: ['homeXg', 'awayXg'],
  calculate(match) {
    const homeXg = stat(match, 'homeXg')
    const awayXg = stat(match, 'awayXg')
    // xG 0 gerçek bir beklenti değil, "veri yok" anlamına gelir.
    const missing = [
      ...(homeXg === null || homeXg <= 0 ? (['homeXg'] as const) : []),
      ...(awayXg === null || awayXg <= 0 ? (['awayXg'] as const) : []),
    ]
    if (missing.length > 0) return { ok: false, missing }
    return { ok: true, percent: Math.round(probOver25AndBtts(homeXg!, awayXg!) * 100) }
  },
}
