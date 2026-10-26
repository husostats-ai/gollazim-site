import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultThresholds, HT05_NOTE_SINCE, type CategoryId } from '../../config/categories'
import type { MatchResult, Pick, SharedPick } from '../../types'
import Ht05NoteRows from '../../components/stats/Ht05NoteRows'
import { PICKS, RESULTS } from '../member/__fixtures__/rawData'
import { sharedPicksOnly } from '../story/shared'
import { buildHt05NoteStats, countHt05, HT05_GROUP_LABELS, ht05Share } from './ht05NoteStats'
import { buildHtScorelessStats } from './htScoreless'
import { buildStatsSummary } from './statsSummary'

const pick = (matchId: string, categoryId: CategoryId, date = '2026-10-20', outcome: Pick['outcome'] = 'won'): Pick =>
  ({ id: `${matchId}|${categoryId}`, matchId, categoryId, date, percent: 80, threshold: 70, outcome, frozenAt: `${date}T20:00:00.000Z` }) as Pick

/** "İY ev-dep MS ev-dep", ör. "0-0 2-1"; null = skor yok */
const result = (matchId: string, score: string | null, status: MatchResult['status'] = 'completed'): MatchResult => {
  const [ht, ft] = score ? score.split(' ').map((part) => part.split('-').map(Number)) : [null, null]
  return { matchId, status, htHome: ht?.[0] ?? null, htAway: ht?.[1] ?? null, ftHome: ft?.[0] ?? null, ftAway: ft?.[1] ?? null, cornersHome: null, cornersAway: null, cardsHome: null, cardsAway: null, updatedAt: '2026-10-20T21:00:00.000Z' }
}

/** (*): İY + 2.5 ÜST + 2. YARI 0.5 ÜST; (a2): İY + 2.5 ÜST; (a1): yalnız İY (ya da İY + başka) */
const match = (id: string, categories: CategoryId[], date = '2026-10-20'): Pick[] => (['ht05', ...categories] as CategoryId[]).map((c) => pick(id, c, date))

describe('buildHt05NoteStats', () => {
  const picks = [
    ...match('s1', ['over25', 'sh05']), // (*) İY 0-0, 2Y 3 gol
    ...match('s2', ['over25', 'sh05']), // (*) İY 0-0, 2Y 1 gol
    ...match('s3', ['over25', 'sh05']), // (*) İY golle
    ...match('s4', ['over25', 'sh05', 'btts']), // (*) skor yok: kapsam dışı
    ...match('o1', ['over25']), // İY + 2.5, 0-0, 2 gol
    ...match('o2', ['over25', 'btts']), // İY + 2.5, İY golle
    ...match('i1', ['sh05']), // yalnız İY + 2Y (2.5 yok): (*) değil, İY + 2.5 de değil
    ...match('i2', []), // yalnız İY, 0-0, 0 gol
  ]
  const results = [result('s1', '0-0 2-1'), result('s2', '0-0 1-0'), result('s3', '1-0 1-0'), result('s4', null), result('o1', '0-0 1-1'), result('o2', '0-1 2-1'), result('i1', '1-1 2-2'), result('i2', '0-0 0-0')]

  it('gruplar: (*), (*) olmayan tüm İY, (*) olmayan İY + 2.5 ÜST', () => {
    const g = buildHt05NoteStats(picks, picks, results)
    expect(g.star).toEqual({ scored: 3, excluded: 1, htWon: 1, scoreless: 2, over: 1, three: 1 })
    expect(g.nonStarAll).toEqual({ scored: 4, excluded: 0, htWon: 2, scoreless: 2, over: 1, three: 0 })
    expect(g.nonStarOver25).toEqual({ scored: 2, excluded: 0, htWon: 1, scoreless: 1, over: 1, three: 0 })
  })

  it('(*) ve (*) olmayan, tüm İY sayımını tam ikiye böler; tüm İY sayımı üstteki blokla (buildHtScorelessStats) aynı', () => {
    const g = buildHt05NoteStats(picks, picks, results)
    const all = countHt05(picks, results)
    for (const k of ['scored', 'excluded', 'htWon', 'scoreless', 'over', 'three'] as const) expect(g.star[k] + g.nonStarAll[k], k).toBe(all[k])
    for (const [p, r] of [[picks, results], [PICKS, RESULTS]] as const) {
      const base = buildHtScorelessStats(p, r)
      const mine = countHt05(p, r)
      expect({ scored: mine.scored, excluded: mine.excluded, scoreless: mine.scoreless, over: mine.over }).toEqual({ scored: base.scored, excluded: base.excluded, scoreless: base.scoreless, over: base.over })
    }
  })

  it('Paylaşılan kapsamda (*) koşulu maçın TÜM önerilerinden: yalnız İY paylaşılmış olsa da (*) sayılır', () => {
    const shared: SharedPick[] = ['s1', 'i2'].map((m) => ({ id: `${m}|ht05`, date: '2026-10-20', categoryId: 'ht05', matchId: m, sharedAt: '2026-10-20T09:00:00.000Z', afterKickoff: false }))
    const scoped = sharedPicksOnly(picks, shared)
    expect(scoped.map((p) => p.id).sort()).toEqual(['i2|ht05', 's1|ht05'])
    const g = buildHt05NoteStats(scoped, picks, results)
    expect(g.star.scored).toBe(1)
    expect(g.nonStarAll.scored).toBe(1)
    // Kapsam (*) koşulunu belirleseydi s1 (*) sayılmazdı.
    expect(buildHt05NoteStats(scoped, scoped, results).star.scored).toBe(0)
  })

  it(`uyarı yayındayken satırı: ${HT05_NOTE_SINCE} dahil, bir gün öncesi değil`, () => {
    expect(HT05_NOTE_SINCE).toBe('2026-10-26')
    const p = [...match('once', ['over25', 'sh05'], '2026-10-25'), ...match('sonra', ['over25', 'sh05'], '2026-10-26')]
    const g = buildHt05NoteStats(p, p, [result('once', '0-0 2-0'), result('sonra', '0-0 2-0')])
    expect(g.star.scored).toBe(2)
    expect(g.starSince).toEqual({ scored: 1, excluded: 0, htWon: 0, scoreless: 1, over: 1, three: 0 })
  })
})

describe('gösterim', () => {
  it('n < 20: yüzde yazılmaz, "az veri"; n ≥ 20: yüzde; n = 0: —', () => {
    expect(ht05Share(10, 19)).toBe('10/19 · az veri')
    expect(ht05Share(10, 20)).toBe('10/20 · %50')
    expect(ht05Share(73, 152)).toBe('73/152 · %48')
    expect(ht05Share(18, 36)).toBe('18/36 · %50')
    expect(ht05Share(13, 55)).toBe('13/55 · %23,6')
    expect(ht05Share(0, 0)).toBe('—')
  })

  it('kart satırları: etiketler, "2. yarıda en az 3 gol", az veri ve bağımsızlık notu; yüzde yok (n < 20)', () => {
    const p = [...match('s1', ['over25', 'sh05']), ...match('s2', ['over25', 'sh05'])]
    const markup = renderToStaticMarkup(createElement(Ht05NoteRows, { stats: buildHt05NoteStats(p, p, [result('s1', '0-0 3-0'), result('s2', '0-0 0-0')]) }))
    for (const label of Object.values(HT05_GROUP_LABELS)) expect(markup).toContain(label)
    expect(markup).toContain('2. yarıda en az 3 gol')
    expect(markup).not.toContain('2Y ≥3')
    expect(markup).toContain('1/2 · az veri')
    expect(markup).not.toMatch(/%\d/)
    expect(markup).toContain('Geçmiş maçların sayımıdır; genel oran gibi okunmamalı')
    expect(markup).toContain('bağımsız değildir')
  })

  it('dışa aktarım: bölüm, Tümü ve Paylaşılan tabloları, tüm İY satırı ve (*) satırları; skor yoksa "Skor verisi yok."', () => {
    const p = [...match('s1', ['over25', 'sh05']), ...match('i2', [])]
    const base = { now: new Date('2026-10-26T09:00:00.000Z'), today: '2026-10-26', scope: { kind: 'all' as const }, includeGuide: false, picks: p, matches: [], verdicts: [], shared: [], thresholds: defaultThresholds(), marketConflictLimit: 25 }
    const text = buildStatsSummary({ ...base, results: [result('s1', '0-0 2-1'), result('i2', '0-0 0-0')] })
    const section = text.slice(text.indexOf('## İY 0.5 ÜST tutmadığında 2. yarı'))
    expect(section).toContain('### Tümü')
    expect(section).toContain('### Paylaşılan')
    expect(section).toContain('| Tüm İY 0.5 ÜST önerileri | 2 | 0 | 2 | 1/2 · az veri | 1/2 · az veri | 1/2 · az veri | 0 |')
    expect(section).toContain(`| ${HT05_GROUP_LABELS.star} | 1 | 0 | 1 | 1/1 · az veri | 0/1 · az veri | 1/1 · az veri | 0 |`)
    expect(section).toContain(`| ${HT05_GROUP_LABELS.nonStarAll} | 1 | 0 | 1 | 0/1 · az veri |`)
    expect(section).toContain('2. yarıda en az 3 gol')
    expect(section).toContain('bağımsız değildir')
    expect(buildStatsSummary(base)).toContain('## İY 0.5 ÜST tutmadığında 2. yarı\n\nSkor verisi yok.')
  })
})
