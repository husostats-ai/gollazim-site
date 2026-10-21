import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Match } from '../../types'
import { makeMatch } from '../analysis/testUtils'
import { db } from '../data/dexie/db'
import { nextOddsHistory, ODDS_HISTORY_LIMIT, oddsOf } from './oddsHistory'
import { uploadCsvFile } from './uploadService'

const odds = (o: { home?: number; over25?: number; bttsYes?: number }): Match => {
  const m = makeMatch({ oddsHome: o.home ?? 2.1, oddsDraw: 3.4, oddsAway: 3.5, oddsOver25: o.over25 ?? 1.8, oddsUnder25: 2.0 })
  return { ...m, stats: { ...m.stats, Odds_BTTS_Yes: o.bttsYes ?? 1.75, Odds_BTTS_No: 2.05, Odds_1st_Half_Over05: 1.3, Odds_1st_Half_Under05: 3.2 } }
}

describe('oran geçmişi (saf)', () => {
  it('oranlar: 1X2, 2.5 Alt/Üst, KG Var/Yok, İY 0.5 Üst/Alt; geçersiz ya da eksik oran null', () => {
    expect(oddsOf(odds({}))).toEqual({ home: 2.1, draw: 3.4, away: 3.5, over25: 1.8, under25: 2, bttsYes: 1.75, bttsNo: 2.05, ht05Over: 1.3, ht05Under: 3.2 })
    const missing = makeMatch({ oddsHome: 1, oddsOver25: 0 })
    expect(oddsOf(missing)).toEqual({ home: null, draw: null, away: null, over25: null, under25: null, bttsYes: null, bttsNo: null, ht05Over: null, ht05Under: null })
  })

  it('oranlar değişince önceki oranlar önceki yüklemenin anıyla eklenir; değişmezse geçmiş aynı kalır', () => {
    const first = odds({ over25: 1.8 })
    const second = odds({ over25: 1.7 })
    expect(nextOddsHistory(first, second, '2026-10-20T05:00:00.000Z')).toEqual([{ at: '2026-10-20T05:00:00.000Z', odds: oddsOf(first) }])
    expect(nextOddsHistory(first, odds({ over25: 1.8 }), '2026-10-20T05:00:00.000Z')).toBeUndefined()
    const withHistory = { ...second, oddsHistory: [{ at: 'x', odds: oddsOf(first) }] }
    expect(nextOddsHistory(withHistory, odds({ over25: 1.7 }), 'y')).toEqual(withHistory.oddsHistory)
    // Önceki kayıtta hiç oran yoksa eklenecek bir şey yok.
    expect(nextOddsHistory(makeMatch({}), first, 'z')).toBeUndefined()
  })

  it(`en çok ${ODDS_HISTORY_LIMIT} kayıt tutulur; en eskiler düşer`, () => {
    let match: Match = odds({ home: 2.0 })
    for (let i = 1; i <= 5; i++) {
      const next = odds({ home: 2.0 + i / 10 })
      match = { ...next, oddsHistory: nextOddsHistory(match, next, `t${i}`) }
    }
    expect(match.oddsHistory!.map((e) => [e.at, e.odds.home])).toEqual([
      ['t3', 2.2],
      ['t4', 2.3],
      ['t5', 2.4],
    ])
  })
})

describe('oran geçmişi: CSV yeniden yüklenince (bellekte IndexedDB)', () => {
  const HEADER = 'date_unix,Home Team,Away Team,Over25 Average,Odds_Home_Win,Odds_Draw,Odds_Away_Win,Odds_Over25,Odds_Under25,Odds_BTTS_Yes,Odds_BTTS_No'
  const csv = (over: string, btts = '1.75') => new File([`${HEADER}\n1792609200,Aston Villa,Viking,80,1.5,4.2,6.0,${over},2.0,${btts},2.05\n`], 'gun.csv', { type: 'text/csv' })

  beforeEach(async () => {
    await db.open()
    await Promise.all(db.tables.map((table) => table.clear()))
  })
  afterAll(() => db.close())

  it('ilk yüklemede geçmiş yok; oran değişince önceki oranlar ilk yüklemenin anıyla; değişmeyen yükleme eklemez', async () => {
    const first = await uploadCsvFile(csv('1.80'))
    const [match] = await db.matches.toArray()
    expect(match.oddsHistory).toBeUndefined()

    await uploadCsvFile(csv('1.70', '1.80'))
    let [after] = await db.matches.toArray()
    expect(after.oddsHistory).toEqual([{ at: first.upload.uploadedAt, odds: { home: 1.5, draw: 4.2, away: 6, over25: 1.8, under25: 2, bttsYes: 1.75, bttsNo: 2.05, ht05Over: null, ht05Under: null } }])
    expect(after.stats.Odds_Over25 ?? after.stats.oddsOver25).toBe(1.7)

    await uploadCsvFile(csv('1.70', '1.80'))
    ;[after] = await db.matches.toArray()
    expect(after.oddsHistory).toHaveLength(1)
  })

  it('elle düzenlenmiş maçın kaydı (geçmişi dahil) değiştirilmez', async () => {
    await uploadCsvFile(csv('1.80'))
    const [match] = await db.matches.toArray()
    await db.matches.put({ ...match, edited: true })
    await uploadCsvFile(csv('1.60'))
    const [after] = await db.matches.toArray()
    expect(after.oddsHistory).toBeUndefined()
    expect(after.edited).toBe(true)
  })
})
