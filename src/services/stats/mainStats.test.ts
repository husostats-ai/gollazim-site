import { describe, expect, it } from 'vitest'
import { CATEGORIES, type CategoryId } from '../../config/categories'
import { MAIN_CATEGORY_IDS } from '../../config/mainCategories'
import type { Pick, PickOutcome } from '../../types'
import { buildMainStats } from './mainStats'
import { buildStats } from './statsEngine'

let serial = 0
const pick = (matchId: string, categoryId: CategoryId, outcome: PickOutcome): Pick => ({
  id: `p${serial++}`,
  matchId,
  categoryId,
  date: '2026-10-06',
  percent: 80,
  outcome,
  home: 'Ev',
  away: 'Dep',
  frozenAt: '2026-10-06T20:00:00.000Z',
} as unknown as Pick)

describe('ana kategoriler başarısı', () => {
  it('liste sabittir: 2.5 ÜST, KG VAR, İLK YARI 0.5 ÜST; "2.5 ÜST & KG VAR" dahil değildir', () => {
    expect(MAIN_CATEGORY_IDS).toEqual(['over25', 'btts', 'ht05'])
    expect(MAIN_CATEGORY_IDS.map((id) => CATEGORIES.find((c) => c.id === id)!.label)).toEqual(['2.5 ÜST', 'KG VAR', 'İLK YARI 0.5 ÜST'])
    expect((MAIN_CATEGORY_IDS as readonly string[]).includes('over25btts')).toBe(false)
  })

  it('yalnızca üç kategorinin önerilerini sayar; benzersiz maç kuralı genel başarıdaki ile aynıdır', () => {
    const picks = [
      pick('a', 'over25', 'won'),
      pick('a', 'btts', 'lost'),
      pick('a', 'ht05', 'won'),
      pick('a', 'over25btts', 'lost'),
      pick('b', 'over25', 'pending'),
      pick('b', 'cards35', 'won'),
      pick('c', 'over25btts', 'won'),
      pick('d', 'ht05', 'void'),
      pick('e', 'corners85', 'lost'),
    ]
    const main = buildMainStats(picks)
    expect(main.categories).toEqual(['over25', 'btts', 'ht05'])
    expect(main.overall).toMatchObject({ won: 2, lost: 1, void: 1, pending: 1, decided: 3, total: 5, rate: 66.7, lowSample: true })
    // a, b, d ana kategoride önerildi; yalnızca a'nın sonuçlanmış önerisi var.
    expect(main.matches).toEqual({ total: 3, decided: 1 })
    // Tüm kategoriler değişmez.
    expect(buildStats(picks).overall).toMatchObject({ won: 4, lost: 3, decided: 7, total: 9 })
    expect(buildStats(picks).matches).toEqual({ total: 5, decided: 4 })
  })

  it('seçim sonuçlara bakmaz: üç kategori kötü, diğerleri kusursuz olsa da aynı üç kategori sayılır', () => {
    const picks = [
      ...MAIN_CATEGORY_IDS.map((id, i) => pick(`k${i}`, id, 'lost')),
      ...CATEGORIES.filter((c) => !(MAIN_CATEGORY_IDS as readonly string[]).includes(c.id)).map((c, i) => pick(`i${i}`, c.id, 'won')),
    ]
    const main = buildMainStats(picks)
    expect(main.overall).toMatchObject({ won: 0, lost: 3, rate: 0 })
    expect(main.categories).toEqual(['over25', 'btts', 'ht05'])
  })

  it('her kategori ana kategori olduğunda sonuç genel başarıya eşittir (aynı hesap)', () => {
    const picks = [pick('a', 'over25', 'won'), pick('a', 'btts', 'lost'), pick('b', 'ht05', 'won'), pick('c', 'over25', 'void')]
    const all = buildStats(picks)
    expect(buildMainStats(picks)).toEqual({ categories: ['over25', 'btts', 'ht05'], overall: all.overall, matches: all.matches })
    expect(buildMainStats([]).overall).toMatchObject({ total: 0, rate: null })
  })
})
