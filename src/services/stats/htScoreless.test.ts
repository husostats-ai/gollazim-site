import { describe, expect, it } from 'vitest'
import type { CategoryId } from '../../config/categories'
import type { MatchResult, MatchStatus, Pick, SharedPick } from '../../types'
import { sharedPicksOnly } from '../story/shared'
import { buildHtScorelessStats } from './htScoreless'
import { LOW_SAMPLE_LIMIT } from './statsEngine'

const DATE = '2026-10-06'

const pick = (matchId: string, categoryId: CategoryId = 'ht05'): Pick =>
  ({ id: `${matchId}|${categoryId}`, matchId, categoryId, date: DATE, percent: 80, threshold: 70, outcome: 'lost', frozenAt: `${DATE}T20:00:00.000Z` }) as Pick

/** score: "İY ev-dep MS ev-dep", ör. "0-0 2-1"; null = skor alanları boş */
const result = (matchId: string, score: string | null, status: MatchStatus = 'completed'): MatchResult => {
  const [ht, ft] = score ? score.split(' ').map((part) => part.split('-').map(Number)) : [null, null]
  return {
    matchId,
    status,
    htHome: ht ? ht[0] : null,
    htAway: ht ? ht[1] : null,
    ftHome: ft ? ft[0] : null,
    ftAway: ft ? ft[1] : null,
    cornersHome: null,
    cornersAway: null,
    cardsHome: null,
    cardsAway: null,
    updatedAt: `${DATE}T21:00:00.000Z`,
  }
}

describe('İY 0.5 ÜST tutmadığında 2. yarı', () => {
  it('İY 0-0 biten maçlarda maç sonu toplamı en az 2 ise 2Y 1.5 ÜST olmuş sayılır', () => {
    const scores = { a: '0-0 2-0', b: '0-0 1-1', c: '0-0 0-2', d: '0-0 3-1', e: '0-0 1-0', f: '0-0 0-1', g: '0-0 0-0' }
    const ids = Object.keys(scores) as (keyof typeof scores)[]
    const stats = buildHtScorelessStats(ids.map((id) => pick(id)), ids.map((id) => result(id, scores[id])))
    expect(stats).toEqual({ scored: 7, excluded: 0, scoreless: 7, over: 4, under: 3, rate: 57.1, lowSample: true })
  })

  it('ilk yarısında gol olan maç kapsamdadır ama N’ye girmez', () => {
    const stats = buildHtScorelessStats(
      [pick('a'), pick('b'), pick('c')],
      [result('a', '1-0 3-0'), result('b', '0-1 0-1'), result('c', '0-0 2-2')],
    )
    expect(stats).toMatchObject({ scored: 3, scoreless: 1, over: 1, under: 0, rate: 100 })
  })

  it('yalnızca İY 0.5 ÜST önerilerini sayar; önerisi olmayan maçın skoru sayılmaz', () => {
    const stats = buildHtScorelessStats(
      [pick('a'), pick('a', 'over25'), pick('b', 'sh05'), pick('c', 'ht15')],
      [result('a', '0-0 2-0'), result('b', '0-0 2-0'), result('c', '0-0 2-0'), result('d', '0-0 2-0')],
    )
    expect(stats).toMatchObject({ scored: 1, excluded: 0, scoreless: 1, over: 1 })
  })

  it('tamamlanmamış, skoru silinmiş ya da İY / MS skoru boş maçın önerisi kapsam dışı sayılır', () => {
    const noHalfTime: MatchResult = { ...result('d', '0-0 2-0'), htHome: null, htAway: null }
    const stats = buildHtScorelessStats(
      [pick('a'), pick('b'), pick('c'), pick('d'), pick('e')],
      [result('a', '0-0 2-0'), result('b', '0-0 2-0', 'postponed'), result('c', null, 'cancelled'), noHalfTime],
    )
    expect(stats).toMatchObject({ scored: 1, excluded: 4, scoreless: 1, over: 1, under: 0 })
  })

  it('öneri yoksa ya da hiçbir maç 0-0 bitmediyse oran yoktur', () => {
    expect(buildHtScorelessStats([], [])).toEqual({ scored: 0, excluded: 0, scoreless: 0, over: 0, under: 0, rate: null, lowSample: true })
    expect(buildHtScorelessStats([pick('a')], [result('a', '1-0 1-0')]).rate).toBeNull()
  })

  it(`N ${LOW_SAMPLE_LIMIT}'den azsa az örnek işaretlenir; ${LOW_SAMPLE_LIMIT} olunca kalkar`, () => {
    const ids = Array.from({ length: LOW_SAMPLE_LIMIT }, (_, i) => `m${i}`)
    const results = ids.map((id) => result(id, '0-0 1-1'))
    expect(buildHtScorelessStats(ids.slice(1).map((id) => pick(id)), results).lowSample).toBe(true)
    // İlk yarısında gol olan maçlar N'yi büyütmez.
    expect(buildHtScorelessStats([...ids.slice(1).map((id) => pick(id)), pick('x')], [...results, result('x', '1-0 1-0')]).lowSample).toBe(true)
    expect(buildHtScorelessStats(ids.map((id) => pick(id)), results)).toMatchObject({ scoreless: LOW_SAMPLE_LIMIT, rate: 100, lowSample: false })
  })

  it('Paylaşılan ölçüsünde yalnızca İY 0.5 ÜST olarak paylaşılan öneriler sayılır', () => {
    const picks = [pick('a'), pick('b'), pick('c'), pick('c', 'over25')]
    const results = [result('a', '0-0 2-0'), result('b', '0-0 0-0'), result('c', '0-0 1-0')]
    const share = (matchId: string, categoryId: CategoryId, removedAt?: string): SharedPick => ({
      id: `${DATE}|${categoryId}|${matchId}|x`,
      date: DATE,
      categoryId,
      matchId,
      sharedAt: `${DATE}T08:00:00.000Z`,
      afterKickoff: false,
      ...(removedAt && { removedAt }),
    })
    // a: paylaşıldı; b: paylaşımdan çıkarıldı; c: yalnızca 2.5 ÜST olarak paylaşıldı
    const shared = [share('a', 'ht05'), share('b', 'ht05', `${DATE}T09:00:00.000Z`), share('c', 'over25')]
    expect(buildHtScorelessStats(picks, results)).toMatchObject({ scored: 3, scoreless: 3, over: 1, under: 2 })
    expect(buildHtScorelessStats(sharedPicksOnly(picks, shared), results)).toMatchObject({ scored: 1, scoreless: 1, over: 1, under: 0, rate: 100 })
  })
})
