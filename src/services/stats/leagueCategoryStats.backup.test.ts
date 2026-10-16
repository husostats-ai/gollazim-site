import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import type { BackupFile } from '../../types'
import { isBackupFile } from '../data/backupFormat'
import { sharedPicksOnly } from '../story/shared'
import { buildLeagueCategoryStats } from './leagueCategoryStats'
import { buildStats } from './statsEngine'

// Gerçek yedekle denetim; normal test çalıştırmasında atlanır. Beklenen sayılar 16 Ekim 2026 yedeğinindir.
// REF_BACKUP=samples/gollazim-yedek-2026-10-16.json npx vitest run src/services/stats/leagueCategoryStats.backup.test.ts
describe.runIf(process.env.REF_BACKUP)('lig bazlı ana kategoriler: gerçek yedek (16 Ekim 2026)', () => {
  const load = (): BackupFile => {
    const data: unknown = JSON.parse(readFileSync(process.env.REF_BACKUP!, 'utf8'))
    if (!isBackupFile(data)) throw new Error('REF_BACKUP bir GOLLAZIM yedeği değil.')
    return data
  }
  let backup: BackupFile
  beforeAll(() => {
    backup = load()
  })

  it('tüm öneriler: 293 öneri, 179 maç; kategori ve grup toplamları', () => {
    const s = buildLeagueCategoryStats(backup.picks, backup.matches)
    expect([s.total.decided, s.total.matches]).toEqual([293, 179])
    expect([s.total.cells.over25, s.total.cells.btts, s.total.cells.ht05].map((c) => [c.decided, c.won])).toEqual([
      [95, 55],
      [77, 43],
      [121, 91],
    ])
    expect(Object.fromEntries(s.groups.map((g) => [g.id, g.decided]))).toEqual({ big5: 20, euroCups: 41, youth: 54, otherAdult: 100, otherCups: 66, unsure: 12 })
    expect(s.unknown).toBeNull()
    expect(s.groups.reduce((sum, g) => sum + g.decided, 0)).toBe(293)
  })

  it('paylaşılanlar: 22 + 4 + 47; özetteki "Paylaşılanlar" sütunuyla aynı', () => {
    const shared = sharedPicksOnly(backup.picks, backup.sharedPicks ?? [])
    const s = buildLeagueCategoryStats(shared, backup.matches)
    expect([s.total.cells.over25.decided, s.total.cells.btts.decided, s.total.cells.ht05.decided]).toEqual([22, 4, 47])
    const engine = buildStats(shared).byCategory
    for (const id of ['over25', 'btts', 'ht05'] as const) expect(s.total.cells[id].decided).toBe(engine.find((b) => b.key === id)!.tally.decided)
  })
})
