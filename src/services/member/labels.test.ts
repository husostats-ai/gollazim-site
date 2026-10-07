import { describe, expect, it } from 'vitest'
import { MEMBER_CONFLICT_LABELS, MEMBER_RELIABILITY_LABELS, standingText } from './labels'
import { MEMBER_RELIABILITY_LEVELS } from './schema'

describe('üye etiketleri', () => {
  it('her güvenilirlik seviyesinin etiketi var; Taraf & Gol seviyeleri "Model tabanlı" görünür', () => {
    expect(Object.keys(MEMBER_RELIABILITY_LABELS).sort()).toEqual([...MEMBER_RELIABILITY_LEVELS].sort())
    expect(MEMBER_RELIABILITY_LABELS.market).toBe('Model tabanlı')
    expect(MEMBER_RELIABILITY_LABELS['market-partial']).toBe('Model tabanlı (kısmi)')
  })

  it('çelişki etiketleri türe göre ayrılır', () => {
    expect(MEMBER_CONFLICT_LABELS).toEqual({ model: 'Model çelişkisi', hesap: 'Hesaplar çelişiyor' })
  })

  it('üyeye görünen hiçbir etiket ham veriye ya da oranlara değinmez', () => {
    const all = [...Object.values(MEMBER_RELIABILITY_LABELS), ...Object.values(MEMBER_CONFLICT_LABELS)].join(' ')
    expect(all).not.toMatch(/piyasa|oran|xg|csv/i)
  })

  it('lig sırası metni', () => {
    expect(standingText({ rank: 3, played: 8, stale: false })).toBe('3. sıra · 8 maç')
  })
})
