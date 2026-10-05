import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { CATEGORIES, defaultThresholds } from '../../config/categories'
import { importCsv } from '../csv/importer'
import { CALCULATORS } from './calculators'
import { analyzeDay } from './engine'
import { assessReliability } from './reliability'

// Geliştirme aracı, normal test çalıştırmasında atlanır.
// REPORT=rapor.txt npm test -- sampleReport : samples/ altındaki CSV'nin (repoda
// tutulmaz, kendi dosyanızı koyun) analiz dökümünü verilen dosyaya yazar.
it.runIf(process.env.REPORT)('örnek CSV dökümü', () => {
  const file = readdirSync('samples').find((f) => f.endsWith('.csv'))!
  const { matches } = importCsv(readFileSync(`samples/${file}`, 'utf8'), 'u1')
  const lines: string[] = []
  lines.push(['MAÇ'.padEnd(34), 'n', ...CATEGORIES.map((c) => c.id)].join(' | '))
  for (const m of matches) {
    const cells = CATEGORIES.map((c) => {
      const r = CALCULATORS[c.id].calculate(m)
      return (r.ok ? String(r.percent) : '-').padStart(c.id.length)
    })
    const n = assessReliability(m).sampleSize
    lines.push([`${m.home} - ${m.away}`.slice(0, 34).padEnd(34), String(n ?? '?').padStart(2), ...cells].join(' | '))
  }
  lines.push('')
  const day = analyzeDay(matches, defaultThresholds())
  for (const c of CATEGORIES) {
    const a = day[c.id]
    lines.push(`${c.label} (eşik %${a.threshold}): ${a.predictions.length} öneri, ${a.unavailableCount} maç veri yok`)
    for (const p of a.predictions)
      lines.push(`   %${p.percent} ${'★'.repeat(p.stars)} n≥${p.reliability.sampleSize} ${p.match.home} - ${p.match.away}`)
  }
  writeFileSync(process.env.REPORT!, lines.join('\n') + '\n')
})
