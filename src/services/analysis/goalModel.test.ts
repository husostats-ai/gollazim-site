import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATEGORIES } from '../../config/categories'
import { importCsv } from '../csv/importer'
import { CALCULATORS } from './calculators'
import { expectedTotalGoals, goalModelPercent, hasGoalModel } from './goalModel'
import { makeMatch } from './testUtils'

const pct = (stats: Record<string, number | null>, id: Parameters<typeof goalModelPercent>[1]) =>
  goalModelPercent(makeMatch(stats), id)

describe('beklenen toplam gol', () => {
  it('xG toplamını kullanır', () => {
    expect(expectedTotalGoals(makeMatch({ homeXg: 1.6, awayXg: 1.2, avgGoals: 4 }))).toEqual({ total: 2.8, source: 'xg' })
  })

  it('xG yoksa ya da geçersizse gol ortalamasına düşer', () => {
    expect(expectedTotalGoals(makeMatch({ avgGoals: 3.2 }))).toEqual({ total: 3.2, source: 'avgGoals' })
    expect(expectedTotalGoals(makeMatch({ homeXg: 1.5, awayXg: null, avgGoals: 3.2 }))?.source).toBe('avgGoals')
    expect(expectedTotalGoals(makeMatch({ homeXg: 0, awayXg: 1.2, avgGoals: 3.2 }))?.source).toBe('avgGoals')
    expect(expectedTotalGoals(makeMatch({ homeXg: -1, awayXg: 1.2, avgGoals: 2 }))?.total).toBe(2)
  })

  it('ikisi de yoksa hesap yapılmaz', () => {
    expect(expectedTotalGoals(makeMatch({}))).toBeNull()
    expect(expectedTotalGoals(makeMatch({ homeXg: 0, awayXg: 0, avgGoals: 0 }))).toBeNull()
  })
})

describe('model yüzdesi', () => {
  it('2.5 / 3.5 / 4.5 Üst: toplam gol beklentisinden Poisson', () => {
    // Toplam 3,0 için bilinen değerler: P(>=3)=0,5768  P(>=4)=0,3528  P(>=5)=0,1847
    const stats = { homeXg: 1.8, awayXg: 1.2 }
    expect(pct(stats, 'over25')).toEqual({ percent: 58, source: 'xg' })
    expect(pct(stats, 'over35')).toEqual({ percent: 35, source: 'xg' })
    expect(pct(stats, 'over45')).toEqual({ percent: 18, source: 'xg' })
  })

  it('çizgi yükseldikçe yüzde düşer; beklenti arttıkça yükselir', () => {
    const low = { homeXg: 1.0, awayXg: 0.8 }
    const high = { homeXg: 2.2, awayXg: 1.6 }
    for (const stats of [low, high]) {
      expect(pct(stats, 'over25')!.percent).toBeGreaterThan(pct(stats, 'over35')!.percent)
      expect(pct(stats, 'over35')!.percent).toBeGreaterThan(pct(stats, 'over45')!.percent)
    }
    expect(pct(high, 'over25')!.percent).toBeGreaterThan(pct(low, 'over25')!.percent)
  })

  it('xG yokken gol ortalamasıyla aynı formül', () => {
    expect(pct({ avgGoals: 3 }, 'over25')).toEqual({ percent: 58, source: 'avgGoals' })
    expect(pct({ avgGoals: 3 }, 'over45')).toEqual({ percent: 18, source: 'avgGoals' })
  })

  it('KG Var: iki takımın gol atma olasılıklarının çarpımı (bağımsız Poisson)', () => {
    // (1 - e^-1,5) x (1 - e^-1,0) = 0,7769 x 0,6321 = 0,4911
    expect(pct({ homeXg: 1.5, awayXg: 1.0 }, 'btts')).toEqual({ percent: 49, source: 'xg' })
    // taraflar yer değiştirince sonuç aynı
    expect(pct({ homeXg: 1.0, awayXg: 1.5 }, 'btts')!.percent).toBe(49)
  })

  it('KG Var takım bazında beklenti ister: xG yoksa gol ortalamasından hesaplanmaz', () => {
    expect(pct({ avgGoals: 3.4 }, 'btts')).toBeNull()
    expect(pct({ homeXg: 1.5, awayXg: 0, avgGoals: 3.4 }, 'btts')).toBeNull()
  })

  it('veri yoksa null döner; uydurma değer üretmez', () => {
    for (const id of ['over25', 'over35', 'over45', 'btts'] as const) expect(pct({}, id)).toBeNull()
  })

  it('yalnızca dört ana gol kategorisinde hesaplanır; yarı kategorilerine dokunmaz', () => {
    const withModel = CATEGORIES.filter((c) => hasGoalModel(c.id)).map((c) => c.id)
    expect(withModel).toEqual(['over25', 'btts', 'over35', 'over45'])
    const stats = { homeXg: 1.8, awayXg: 1.2, avgGoals: 3 }
    for (const id of ['ht05', 'ht15', 'sh05', 'over25btts', 'corners85', 'cards35', 'homeWin15'] as const) {
      expect(pct(stats, id)).toBeNull()
    }
  })
})

// Geliştirme aracı, normal test çalıştırmasında atlanır.
// REPORT_MODEL=rapor.txt npm test -- goalModel : samples/ altındaki CSV için
// hazır yüzde ile model yüzdesini yan yana verilen dosyaya yazar.
it.runIf(process.env.REPORT_MODEL && existsSync('samples'))('hazır yüzde ve model dökümü', () => {
  const file = readdirSync('samples').find((f) => f.endsWith('.csv'))!
  const { matches } = importCsv(readFileSync(`samples/${file}`, 'utf8'), 'u1')
  const ids = ['over25', 'over35', 'over45', 'btts'] as const
  const lines = matches.map((m) => {
    const cells = ids.map((id) => {
      const ready = CALCULATORS[id].calculate(m)
      const model = goalModelPercent(m, id)
      return `${id}=${ready.ok ? ready.percent : '-'}|${model ? model.percent : '-'}`
    })
    const total = expectedTotalGoals(m)
    return `${m.home} - ${m.away} ; toplam=${total ? total.total.toFixed(2) : '-'} (${total?.source ?? '-'}) ; xG=${m.stats.homeXg}/${m.stats.awayXg} ; ort=${m.stats.avgGoals} ; ${cells.join(' ; ')}`
  })
  writeFileSync(process.env.REPORT_MODEL!, lines.join('\n') + '\n')
})
