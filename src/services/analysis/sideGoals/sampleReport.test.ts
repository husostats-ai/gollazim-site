import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { importCsv } from '../../csv/importer'
import { outcomeProbs } from './scoreModel'
import { buildSideGoalsModel, evaluateSideGoals, type SideGoalsLine } from './sideGoals'

// Geliştirme aracı, normal test çalıştırmasında atlanır.
// REPORT_SIDE=rapor.txt npm test -- sideGoals/sampleReport : samples/ altındaki
// CSV için iki yöntemin sonuçlarını verilen dosyaya yazar.
const LINES: [string, SideGoalsLine][] = [
  ['Ev&1.5', { side: 'home', minGoals: 2 }],
  ['Ev&2.5', { side: 'home', minGoals: 3 }],
  ['Dep&1.5', { side: 'away', minGoals: 2 }],
  ['Dep&2.5', { side: 'away', minGoals: 3 }],
]

it.runIf(process.env.REPORT_SIDE && existsSync('samples'))('taraf & gol dökümü', () => {
  const file = readdirSync('samples').find((f) => f.endsWith('.csv'))!
  const { matches } = importCsv(readFileSync(`samples/${file}`, 'utf8'), 'u1')
  const pct = (v: number) => String(Math.round(v * 100)).padStart(3)
  const out: string[] = []
  for (const m of matches) {
    const model = buildSideGoalsModel(m)
    out.push(`${m.home} - ${m.away}`)
    if (!model) {
      out.push('   veri yok')
      continue
    }
    const fit = outcomeProbs(model.main.home, model.main.away)
    out.push(
      `   kaynak=${model.source} piyasa 1/X/2=${model.market ? [model.market.home, model.market.draw, model.market.away].map(pct).join('/') : '-'}` +
        ` model 1/X/2=${[fit.home, fit.draw, fit.away].map(pct).join('/')}` +
        ` gol beklentisi=${model.main.home.toFixed(2)}-${model.main.away.toFixed(2)}` +
        ` xG=${model.second ? `${model.second.home}-${model.second.away}` : '-'}`,
    )
    out.push(
      '   ' +
        LINES.map(([label, line]) => {
          const r = evaluateSideGoals(model, line)
          return `${label}: ${r.percent}|${r.secondPercent ?? '-'}${r.conflict ? ' ÇELİŞKİ' : ''}`
        }).join('   '),
    )
  }
  writeFileSync(process.env.REPORT_SIDE!, out.join('\n') + '\n')
})
