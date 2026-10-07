import { describe, expect, it } from 'vitest'
import { ACCESS_DENIED_TEXT } from './crypto'
import { MEMBER_CONFLICT_LABELS, MEMBER_ERROR_TEXTS, MEMBER_NOTICE_TEXTS, MEMBER_OUTCOMES, MEMBER_RELIABILITY_LABELS, MEMBER_STATUS_LABELS, STALE_DATA_TEXT, STALE_TABLE_LABEL, standingText } from './labels'
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
    const all = [
      ...Object.values(MEMBER_RELIABILITY_LABELS),
      ...Object.values(MEMBER_CONFLICT_LABELS),
      ...Object.values(MEMBER_OUTCOMES).map((o) => o.label),
      ...Object.values(MEMBER_STATUS_LABELS),
      ...Object.values(MEMBER_ERROR_TEXTS),
      ...Object.values(MEMBER_NOTICE_TEXTS),
      STALE_DATA_TEXT,
      STALE_TABLE_LABEL,
    ].join(' ')
    expect(all).not.toMatch(/piyasa|oran|xg|csv|kaynak|footystats|bağlantı|https?:\/\//i)
  })

  it('giriş hatasının metni tek ve geneldir; sonuç işaretleri sonuç görselindekiyle aynıdır', () => {
    expect(MEMBER_ERROR_TEXTS.credentials).toBe(ACCESS_DENIED_TEXT)
    expect(Object.values(MEMBER_OUTCOMES).map((o) => o.mark)).toEqual(['✓', '✗', '—', '···'])
  })

  it('lig sırası metni', () => {
    expect(standingText({ rank: 3, played: 8, stale: false })).toBe('3. sıra · 8 maç')
  })
})
