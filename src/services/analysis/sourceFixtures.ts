import type { Match } from '../../types'

// Model kaynağı testlerinin sentetik maçları: model verisinin her durumu x oranların her durumu.
// Değişmezlik anlık görüntüsü (sourceInvariance) bu maçlarla üretildi; değerler değiştirilmemelidir.

const DAY = '2026-10-05'
const READY = { over25Pct: 88, over35Pct: 74, over45Pct: 63, bttsPct: 84, ht05Pct: 86, ht15Pct: 66, sh05Pct: 90, corners85Pct: 80, corners95Pct: 75, corners105Pct: 71, avgCards: 5.2, avgCorners: 10.4, homePpg: 1.9, awayPpg: 1.1 }

/** Model verisinin durumları */
export const MODEL_DATA = {
  /** (a) xG var (gol ortalaması da var: xG önceliklidir) */
  xg: { homeXg: 1.7, awayXg: 1.2, avgGoals: 3.4 },
  /** (b) xG yok, gol ortalaması var */
  avgGoals: { avgGoals: 3.4 },
  /** (c) ikisi de yok */
  none: {},
  /** (d) xG 0 geliyor ("veri yok"), gol ortalaması var */
  zeroXg: { homeXg: 0, awayXg: 0, avgGoals: 2.2 },
  /** (d) yalnızca bir takımın xG'si 0 */
  halfXg: { homeXg: 1.5, awayXg: 0, avgGoals: 2.9 },
  /** (d) xG de gol ortalaması da 0 */
  zeroBoth: { homeXg: 0, awayXg: 0, avgGoals: 0 },
} as const
const ODDS = {
  full: { oddsHome: 1.6, oddsDraw: 4.2, oddsAway: 5.5, oddsOver25: 1.7, oddsUnder25: 2.15 },
  side: { oddsHome: 2.4, oddsDraw: 3.3, oddsAway: 2.9 },
  none: {},
} as const

export type ModelDataKind = keyof typeof MODEL_DATA
export const syntheticId = (data: ModelDataKind, odds: keyof typeof ODDS): string => `${DAY}|${data}|${odds}`

/** 6 veri durumu x 3 oran durumu = 18 maç; hazır yüzdeler maçtan maça birer puan değişir (sıra belirli olsun) */
export const syntheticMatches = (): Match[] =>
  (Object.keys(MODEL_DATA) as ModelDataKind[]).flatMap((data, i) =>
    (Object.keys(ODDS) as (keyof typeof ODDS)[]).map((odds, j) => {
      const shift = i * 3 + j
      return {
        id: syntheticId(data, odds),
        uploadId: 'u1',
        date: DAY,
        time: `${String(12 + (shift % 9)).padStart(2, '0')}:00`,
        league: 'Deneme Ligi',
        home: `Ev ${data} ${odds}`,
        away: `Dep ${data} ${odds}`,
        stats: { ...READY, over25Pct: READY.over25Pct - shift, over35Pct: READY.over35Pct - shift, over45Pct: READY.over45Pct - shift, bttsPct: READY.bttsPct - (shift % 5), ...MODEL_DATA[data], ...ODDS[odds] },
      }
    }),
  )
