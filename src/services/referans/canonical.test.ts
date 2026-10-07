import { describe, expect, it } from 'vitest'
import type { Pick } from '../../types'
import { ABSENT, canonical, pickRecord } from './canonical'

const base: Pick = {
  id: 'm1|over25',
  matchId: 'm1',
  categoryId: 'over25',
  date: '2026-10-05',
  percent: 80,
  threshold: 75,
  outcome: 'won',
  frozenAt: '2026-10-05T18:00:00.000Z',
}

describe('pickRecord (dondurulmuş öneri dökümü)', () => {
  it('alanın yokluğu, null ve "none" üç ayrı değer olarak yazılır', () => {
    const absent = pickRecord(base)
    const asNull = pickRecord({ ...base, secondPercent: null })
    const asNone = pickRecord({ ...base, marketPercent: 'none', marketConflict: 'none', modelDrift: 'none' })

    expect(absent.secondPercent).toBe(ABSENT)
    expect(asNull.secondPercent).toBeNull()
    expect(absent.marketPercent).toBe(ABSENT)
    expect(asNone.marketPercent).toBe('none')
    expect(asNone.marketConflict).toBe('none')
    expect(asNone.modelDrift).toBe('none')

    // Dökümün metninde de üçü birbirinden ayırt edilir.
    const texts = [absent, asNull, asNone].map(canonical)
    expect(new Set(texts).size).toBe(3)
    expect(texts[0]).toContain(`"secondPercent": "${ABSENT}"`)
    expect(texts[1]).toContain('"secondPercent": null')
    expect(texts[2]).toContain('"marketPercent": "none"')
  })

  it('kayıtlı değerler değiştirilmeden yazılır: sayı, false ve 0 korunur', () => {
    const record = pickRecord({ ...base, reliability: 'medium', secondPercent: 0, conflict: false, marketPercent: 64, marketConflict: false, stars: 3, modelDrift: false })
    expect(record).toMatchObject({ secondPercent: 0, conflict: false, marketPercent: 64, marketConflict: false, stars: 3, modelDrift: false })
    expect(Object.values(record)).not.toContain(ABSENT)
  })

  it('bilinmeyen alan sessizce atılmaz, hata verir', () => {
    expect(() => pickRecord({ ...base, yeniAlan: 1 } as unknown as Pick)).toThrow('yeniAlan')
  })
})

describe('canonical', () => {
  it('anahtar sırasından bağımsızdır; dizi sırası korunur', () => {
    expect(canonical({ b: 1, a: [2, 1] })).toBe(canonical({ a: [2, 1], b: 1 }))
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]))
  })

  it('olmayan alan yazılmaz; null yazılır', () => {
    expect(canonical({ a: undefined, b: null })).toBe('{\n "b": null\n}\n')
  })
})
