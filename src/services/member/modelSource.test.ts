import { describe, expect, it } from 'vitest'
import { analyzeDay } from '../analysis/engine'
import { syntheticMatches } from '../analysis/sourceFixtures'
import { DAY, dayMatches, MARKET_LIMIT, memberInput, PICKS, RESULTS, THRESHOLDS } from './__fixtures__/rawData'
import { buildMemberPayload, MEMBER_PAYLOAD_VERSION } from './payload'
import { assertMemberPayload } from './schema'

// Model %'nin kaynağı yalnızca admin içindir: üye paketine alan olarak da metin olarak da girmez.

const FORBIDDEN = ['modelSource', 'secondSource', 'avgGoals', 'ort. gol', 'Model: veri yok']

describe('üye paketi: model kaynağı sızmaz', () => {
  // xG'si olan, olmayan ve hiç model verisi olmayan maçlar (analizde üç kaynak da var).
  // Sentetik maçların takım adları veri durumunu içerir ("Ev avgGoals full"); üyeye giden adlar nötr yapılır.
  const matches = [...dayMatches(DAY), ...syntheticMatches().map((m, i) => ({ ...m, home: `Deneme Ev ${i}`, away: `Deneme Dep ${i}` }))]
  const analysis = analyzeDay(matches, THRESHOLDS, 'percent', MARKET_LIMIT)
  const sources = new Set(Object.values(analysis).flatMap((a) => a.predictions.map((p) => p.secondSource)))
  const days = memberInput().days.map((d) => (d.date === DAY ? { ...d, matches } : d))
  // Kaynak alanı yazılmış öneri kayıtları (yeni dondurmalar gibi)
  const sourced = PICKS.map((p, i) => ({ ...p, modelSource: (['xg', 'avgGoals', 'none'] as const)[i % 3] }))
  const payload = buildMemberPayload(memberInput({ days, picks: sourced }))
  const text = JSON.stringify(payload)

  it('deney gerçekten üç kaynağı da kapsıyor ve pakette model yüzdesi olan / olmayan öğeler var', () => {
    expect(sources).toEqual(new Set(['xg', 'avgGoals', 'none', undefined]))
    const items = payload.days[0].lists.flatMap((l) => l.items)
    expect(items.some((i) => i.model === null)).toBe(true)
    expect(items.some((i) => typeof i.model === 'number')).toBe(true)
    expect(RESULTS.length).toBeGreaterThan(0)
  })

  it('pakette kaynak alanı da kaynak metni de yoktur', () => {
    for (const term of FORBIDDEN) expect(text).not.toContain(term)
  })

  it('öneri kayıtlarındaki kaynak alanı paketi değiştirmez: alan varken ve yokken paket bayt bayt aynı', () => {
    expect(JSON.stringify(buildMemberPayload(memberInput({ days, picks: PICKS })))).toBe(text)
  })

  it('paket sürümü 11; şema denetimi geçer ve bilinmeyen alanı reddeder', () => {
    expect(MEMBER_PAYLOAD_VERSION).toBe(11)
    expect(payload.v).toBe(11)
    expect(() => assertMemberPayload(JSON.parse(text))).not.toThrow()
    const leaked = JSON.parse(text)
    leaked.days[0].lists.find((l: { items: unknown[] }) => l.items.length > 0).items[0].modelSource = 'xg'
    expect(() => assertMemberPayload(leaked)).toThrow()
  })
})
