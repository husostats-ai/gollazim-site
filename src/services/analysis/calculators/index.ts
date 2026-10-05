import type { CategoryId } from '../../../config/categories'
import type { Calculator } from '../types'
import { cardsOver } from './cardsOver'
import { directPercent } from './directPercent'
import { over25Btts } from './over25Btts'
import { sideGoals } from './sideGoals'

// Her kategorinin yüzdesini üreten hesaplayıcı. Algoritmayı değiştirmek için
// ilgili kategorinin karşısındaki hesaplayıcıyı değiştirmek yeterlidir.
export const CALCULATORS: Record<CategoryId, Calculator> = {
  over25: directPercent('over25Pct'),
  ht05: directPercent('ht05Pct'),
  btts: directPercent('bttsPct'),
  over25btts: over25Btts,
  sh05: directPercent('sh05Pct'),
  over35: directPercent('over35Pct'),
  over45: directPercent('over45Pct'),
  ht15: directPercent('ht15Pct'),
  corners85: directPercent('corners85Pct'),
  corners95: directPercent('corners95Pct'),
  corners105: directPercent('corners105Pct'),
  cards35: cardsOver(3.5),
  cards45: cardsOver(4.5),
  homeWin15: sideGoals({ side: 'home', minGoals: 2 }),
  homeWin25: sideGoals({ side: 'home', minGoals: 3 }),
  awayWin15: sideGoals({ side: 'away', minGoals: 2 }),
  awayWin25: sideGoals({ side: 'away', minGoals: 3 }),
}
