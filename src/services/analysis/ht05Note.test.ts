import { describe, expect, it } from 'vitest'
import { CATEGORIES, defaultThresholds, HT05_NOTE, MAX_MATCHES_PER_CATEGORY, showsHt05Note, type CategoryId } from '../../config/categories'
import { DAY, memberInput } from '../member/__fixtures__/rawData'
import { buildMemberPayload } from '../member/payload'
import { analyzeDay, listedCategoriesByMatch } from './engine'
import { makeMatch } from './testUtils'

// İLK YARI 0.5 ÜST kartındaki (*) notu: yalnızca İY kartında ve aynı maçın hem 2.5 ÜST hem 2. YARI 0.5 ÜST
// listesinde önerisi varsa. Admin kartı listedCategoriesByMatch (yüzde listeleri), üye kartı paketteki others ile.

describe('showsHt05Note', () => {
  it('metin aynen; sayı ya da yüzde yok', () => {
    expect(HT05_NOTE).toBe("* İlk yarı gol olmazsa devre arasında 1.5 ÜST'e yönelebilirsiniz.")
    expect(HT05_NOTE.replace('1.5 ÜST', '')).not.toMatch(/\d|%/)
  })

  it('ikisi de var: yalnızca İY 0.5 ÜST kartında görünür', () => {
    expect(showsHt05Note('ht05', ['over25', 'sh05'])).toBe(true)
    // Kartın kendi kategorisinin listede olması sonucu değiştirmez.
    expect(showsHt05Note('ht05', ['over25', 'ht05', 'sh05'])).toBe(true)
    for (const id of CATEGORIES.map((c) => c.id).filter((c) => c !== 'ht05')) expect(showsHt05Note(id, ['over25', 'sh05', 'ht05']), id).toBe(false)
  })

  it('yalnız biri ya da hiçbiri: görünmez', () => {
    expect(showsHt05Note('ht05', ['over25'])).toBe(false)
    expect(showsHt05Note('ht05', ['sh05'])).toBe(false)
    expect(showsHt05Note('ht05', [])).toBe(false)
  })

  it('İY başka kategorilerle birlikte: ikisinden biri eksikse görünmez; ikisi de varsa fazlası sonucu değiştirmez', () => {
    const others: CategoryId[] = ['btts', 'ht15', 'over35', 'over25btts', 'corners85']
    expect(showsHt05Note('ht05', [...others, 'over25'])).toBe(false)
    expect(showsHt05Note('ht05', [...others, 'sh05'])).toBe(false)
    expect(showsHt05Note('ht05', others)).toBe(false)
    expect(showsHt05Note('ht05', [...others, 'over25', 'sh05'])).toBe(true)
  })
})

describe('admin kuralı: listede olduğu kategoriler (yüzde listeleri)', () => {
  const day = (matches: ReturnType<typeof makeMatch>[]) => listedCategoriesByMatch(analyzeDay(matches, defaultThresholds(), 'percent'))
  const card = (stats: Record<string, number>) => makeMatch({ ht05Pct: 90, ...stats }, { id: 'hedef', home: 'Hedef', away: 'Rakip' })

  it('dört kombinasyon gerçek analizle', () => {
    const note = (stats: Record<string, number>) => showsHt05Note('ht05', day([card(stats)]).get('hedef') ?? [])
    expect(note({ over25Pct: 90, sh05Pct: 90 })).toBe(true)
    expect(note({ over25Pct: 90 })).toBe(false)
    expect(note({ sh05Pct: 90 })).toBe(false)
    expect(note({})).toBe(false)
    expect(note({ over25Pct: 90, bttsPct: 90, ht15Pct: 90 })).toBe(false)
    expect(note({ over25Pct: 90, sh05Pct: 90, bttsPct: 90, ht15Pct: 90 })).toBe(true)
  })

  it('eşiği geçmek yetmez: maç 2.5 ÜST listesinin ilk 15\'ine girmiyorsa not görünmez (üye paketi ve dondurmayla aynı)', () => {
    const stronger = Array.from({ length: MAX_MATCHES_PER_CATEGORY }, (_, i) => makeMatch({ over25Pct: 99 }, { id: `guclu-${i}`, home: `Güçlü ${i}`, away: 'X' }))
    const listed = day([...stronger, card({ over25Pct: 80, sh05Pct: 90 })]).get('hedef') ?? []
    expect(listed).not.toContain('over25')
    expect(showsHt05Note('ht05', listed)).toBe(false)
  })

  it('admin kuralı ile üye paketindeki others aynı sonucu verir (görünen ve görünmeyen durum)', () => {
    const seen = new Set<boolean>()
    // İkinci girdide 2. YARI 0.5 ÜST eşiği ulaşılamaz: o liste boşalır, not hiçbir İY kartında görünmemeli.
    for (const input of [memberInput(), memberInput({ thresholds: { ...memberInput().thresholds, sh05: 101 } })]) {
      const today = buildMemberPayload(input).days[0]
      const dayMatches = input.days.find((d) => d.date === DAY)!.matches
      const listed = listedCategoriesByMatch(analyzeDay(dayMatches, input.thresholds, 'percent', input.marketConflictLimit))
      const ht05 = today.lists.find((l) => l.categoryId === 'ht05')!
      expect(ht05.items.length).toBeGreaterThan(0)
      for (const item of ht05.items) {
        const match = today.matches[item.match]
        const id = dayMatches.find((m) => m.home === match.home && m.away === match.away && (m.time ?? null) === match.time)!.id
        const member = showsHt05Note('ht05', (item.others ?? []).map((o) => o.categoryId))
        expect(member, match.home).toBe(showsHt05Note('ht05', listed.get(id) ?? []))
        seen.add(member)
      }
    }
    expect([...seen].sort()).toEqual([false, true])
  })

  it('kart notu pakete girmez: not metni yok; maçlarda ve önerilerde yeni anahtar yok (istatistikteki ht05Note sürüm 14 sayımıdır)', () => {
    const payload = buildMemberPayload(memberInput())
    expect(JSON.stringify(payload)).not.toContain('İlk yarı gol olmazsa')
    for (const day of payload.days) {
      for (const m of day.matches) expect(Object.keys(m).filter((k) => /ht05|note$/i.test(k) && k !== 'note')).toEqual([])
      for (const l of day.lists) for (const i of l.items) expect(Object.keys(i).filter((k) => /ht05|note/i.test(k))).toEqual([])
    }
  })
})
