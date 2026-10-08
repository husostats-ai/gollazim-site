import { describe, expect, it } from 'vitest'
import type { AiDecision, AiProvider } from '../../config/ai'
import { defaultThresholds } from '../../config/categories'
import type { AiShare, AiVerdict } from '../../types'
import { assembleBackup, isBackupFile } from '../data/backupFormat'
import { isLegacyShare, memberShareRow, normalizeAiShares, recordAiShares } from './memberShare'

// Maç 5 Ekim 2026, 20:00 TSİ (17:00 UTC) başlıyor.
const MATCH = { date: '2026-10-05', time: '20:00' }
const BEFORE = '2026-10-05T09:00:00.000Z'
const PROVIDERS: AiProvider[] = ['chatgpt', 'gemini', 'claude']
const verdict = (provider: AiProvider, decision: AiDecision, savedAt = BEFORE): AiVerdict => ({
  id: `m|${provider}`,
  matchId: 'm',
  date: MATCH.date,
  provider,
  byCategory: { over25: decision },
  asked: ['over25'],
  reason: 'gizli gerekçe',
  risk: 'gizli risk',
  savedAt,
  score: { home: 2, away: 1 },
})
const three = (...decisions: [AiDecision, AiDecision, AiDecision]) => decisions.map((d, i) => verdict(PROVIDERS[i], d))
const row = (...decisions: [AiDecision, AiDecision, AiDecision]) => memberShareRow(MATCH, three(...decisions), 'over25')

describe('"AI öneri güveni" satırı üyeye gider mi', () => {
  it('3/3 Orta ya da Güçlü: gider', () => {
    expect(row('medium', 'medium', 'medium')).toEqual({ votes: PROVIDERS.map((provider) => ({ provider, decision: 'medium' })), count: 3, decision: 'medium' })
    expect(row('strong', 'strong', 'strong')).toMatchObject({ count: 3, decision: 'strong' })
  })

  it('2/3 Orta ya da Güçlü: gider; azınlıktaki karar da satırda durur', () => {
    expect(row('strong', 'weak', 'strong')).toEqual({
      votes: [{ provider: 'chatgpt', decision: 'strong' }, { provider: 'gemini', decision: 'weak' }, { provider: 'claude', decision: 'strong' }],
      count: 2,
      decision: 'strong',
    })
    expect(row('medium', 'medium', 'strong')).toMatchObject({ count: 2, decision: 'medium' })
    expect(row('strong', 'medium', 'strong')).toMatchObject({ count: 2, decision: 'strong' })
  })

  it('çoğunluk Zayıf ya da Eleme: gitmez', () => {
    expect(row('weak', 'weak', 'medium')).toBeNull()
    expect(row('weak', 'weak', 'weak')).toBeNull()
    expect(row('reject', 'reject', 'strong')).toBeNull()
  })

  it('çoğunluk yok (üç farklı karar): gitmez; iki onay farklı seviyedeyse de gitmez', () => {
    expect(row('strong', 'medium', 'weak')).toBeNull()
  })

  it('herhangi biri "Eleme" dediyse çoğunluk Orta ya da Güçlü olsa da gitmez', () => {
    expect(row('medium', 'medium', 'reject')).toBeNull()
    expect(row('reject', 'strong', 'strong')).toBeNull()
  })

  it('üç yapay zekânın da kararı şart: iki karar aynı olsa da gitmez', () => {
    expect(memberShareRow(MATCH, [verdict('chatgpt', 'medium'), verdict('gemini', 'medium')], 'over25')).toBeNull()
    expect(memberShareRow(MATCH, [verdict('chatgpt', 'strong')], 'over25')).toBeNull()
    expect(memberShareRow(MATCH, [], 'over25')).toBeNull()
  })

  it('maç başladıktan sonra (ya da tam başlama anında) kaydedilen karar varsa gitmez', () => {
    const late = (savedAt: string) => memberShareRow(MATCH, [verdict('chatgpt', 'medium'), verdict('gemini', 'medium'), verdict('claude', 'medium', savedAt)], 'over25')
    expect(late('2026-10-05T16:59:59.000Z')).not.toBeNull()
    expect(late('2026-10-05T17:00:00.000Z')).toBeNull()
    expect(late('2026-10-06T08:00:00.000Z')).toBeNull()
    expect(late('bozuk')).toBeNull()
  })

  it('saati bilinmeyen maçta gitmez', () => {
    expect(memberShareRow({ date: MATCH.date, time: undefined }, three('medium', 'medium', 'medium'), 'over25')).toBeNull()
    expect(memberShareRow({ date: MATCH.date, time: 'akşam' }, three('medium', 'medium', 'medium'), 'over25')).toBeNull()
  })

  it('karar kategoriye aittir: her kategori ayrı değerlendirilir, biri diğerini etkilemez', () => {
    const multi = (byCategory: Record<string, [AiDecision | null, AiDecision | null, AiDecision | null]>): AiVerdict[] =>
      PROVIDERS.map((provider, i) => ({
        ...verdict(provider, 'medium'),
        asked: Object.keys(byCategory) as AiVerdict['asked'],
        byCategory: Object.fromEntries(Object.entries(byCategory).flatMap(([id, three]) => (three[i] ? [[id, three[i]]] : []))),
      }))
    // Kullanıcının örneği: 2.5 ÜST 3/3 Orta, KG VAR 2 Orta + 1 Zayıf, İY 0.5 ÜST 2 Zayıf + 1 Orta
    const sample = multi({ over25: ['medium', 'medium', 'medium'], btts: ['medium', 'medium', 'weak'], ht05: ['weak', 'weak', 'medium'] })
    expect(memberShareRow(MATCH, sample, 'over25')).toMatchObject({ count: 3, decision: 'medium' })
    expect(memberShareRow(MATCH, sample, 'btts')).toMatchObject({ count: 2, decision: 'medium' })
    expect(memberShareRow(MATCH, sample, 'ht05')).toBeNull()
    expect(memberShareRow(MATCH, sample, 'over25btts')).toBeNull() // hiç karar yok
    // Bir kategoride Eleme: yalnızca o kategori düşer.
    const reject = multi({ over25: ['strong', 'strong', 'reject'], btts: ['strong', 'strong', 'strong'] })
    expect(memberShareRow(MATCH, reject, 'over25')).toBeNull()
    expect(memberShareRow(MATCH, reject, 'btts')).toMatchObject({ count: 3, decision: 'strong' })
    // Bir yapay zekâ kategoriyi atladı: o kategori gitmez, cevapladığı gider.
    const skipped = multi({ over25: ['medium', 'medium', null], ht05: ['medium', 'medium', 'medium'] })
    expect(memberShareRow(MATCH, skipped, 'over25')).toBeNull()
    expect(memberShareRow(MATCH, skipped, 'ht05')).not.toBeNull()
  })

  it('karar istenmeyen kategoride (2. yarı, korner…) satır hiç gitmez', () => {
    const everywhere = PROVIDERS.map((provider) => ({ ...verdict(provider, 'strong'), byCategory: { over25: 'strong', sh05: 'strong', corners85: 'strong' } }) as AiVerdict)
    expect(memberShareRow(MATCH, everywhere, 'over25')).not.toBeNull()
    for (const id of ['sh05', 'corners85', 'cards35', 'homeWin15'] as const) expect(memberShareRow(MATCH, everywhere, id), id).toBeNull()
  })

  it('eski maç geneli karar hiçbir kategoride gitmez; yeni cevapta saklanan eski karar da hesaba girmez', () => {
    const legacy = PROVIDERS.map((provider): AiVerdict => ({ id: `m|${provider}`, matchId: 'm', date: MATCH.date, provider, decision: 'strong', reason: 'r', risk: 'k', savedAt: BEFORE }))
    for (const id of ['over25', 'ht05', 'btts', 'over25btts'] as const) expect(memberShareRow(MATCH, legacy, id), id).toBeNull()
    // Eski karar Güçlü olarak saklı, yeni kategori kararı Zayıf: yalnızca kategori kararı sayılır.
    const kept = PROVIDERS.map((provider) => ({ ...verdict(provider, 'weak'), decision: 'strong' as const }))
    expect(memberShareRow(MATCH, kept, 'over25')).toBeNull()
  })

  it('satırda yalnızca sağlayıcı ve seviye vardır', () => {
    const text = JSON.stringify(row('medium', 'medium', 'medium'))
    for (const forbidden of ['gizli', 'reason', 'risk', 'score', 'savedAt', 'matchId']) expect(text).not.toContain(forbidden)
  })
})

describe('üyeye giden satırların kaydı', () => {
  const sent = (matchId: string, ...decisions: [AiDecision, AiDecision, AiDecision]) => ({ matchId, categoryId: 'over25' as const, date: MATCH.date, row: row(...decisions)! })
  const T1 = '2026-10-05T07:00:00.000Z'
  const T2 = '2026-10-05T10:00:00.000Z'

  it('ilk gönderim: ilk ve son yayın aynıdır', () => {
    expect(recordAiShares([], [sent('a', 'medium', 'medium', 'medium')], 12, T1)).toEqual([
      { id: 'a|over25', matchId: 'a', categoryId: 'over25', date: MATCH.date, firstN: 12, firstAt: T1, lastN: 12, lastAt: T1, votes: PROVIDERS.map((provider) => ({ provider, decision: 'medium' })), count: 3, decision: 'medium' },
    ])
  })

  it('yeniden gönderim: ilk yayın korunur, son yayın ve kararların kopyası güncellenir', () => {
    const first = recordAiShares([], [sent('a', 'medium', 'medium', 'medium')], 12, T1)
    const [again] = recordAiShares(first, [sent('a', 'strong', 'weak', 'strong')], 13, T2)
    expect(again).toMatchObject({ firstN: 12, firstAt: T1, lastN: 13, lastAt: T2, count: 2, decision: 'strong' })
    // Bu yayında gitmeyen maç için kayıt üretilmez (depodaki eski kayda dokunulmaz).
    expect(recordAiShares(first, [sent('b', 'strong', 'strong', 'strong')], 13, T2).map((r) => r.id)).toEqual(['b|over25'])
    // Aynı maçın başka kategorisi ayrı kayıttır.
    const other = recordAiShares(first, [{ ...sent('a', 'strong', 'strong', 'strong'), categoryId: 'btts' as const }], 13, T2)
    expect(other.map((r) => [r.id, r.firstN])).toEqual([['a|btts', 13]])
  })

  it('yedek: kayıtlar isteğe bağlı alandır; kayıt yoksa alan yazılmaz, eski yedek geçerlidir', () => {
    const base = { uploads: [], matches: [], results: [], picks: [], thresholds: defaultThresholds() }
    const shares = recordAiShares([], [sent('a', 'medium', 'medium', 'medium')], 12, T1)
    const withShares = assembleBackup({ ...base, aiShares: shares }, new Date(T1))
    expect(withShares.aiShares).toEqual(shares)
    expect(withShares.version).toBe(1)
    expect(isBackupFile(JSON.parse(JSON.stringify(withShares)))).toBe(true)
    expect('aiShares' in assembleBackup({ ...base, aiShares: [] }, new Date(T1))).toBe(false)
    expect('aiShares' in assembleBackup(base, new Date(T1))).toBe(false)
    expect(isBackupFile({ ...withShares, aiShares: 'x' })).toBe(false)
  })

  it('yedekten gelen kayıtlar doğrulanır: bozuk ve kural dışı satırlar atılır', () => {
    const [good] = recordAiShares([], [sent('a', 'strong', 'weak', 'strong')], 12, T1)
    const bad: unknown[] = [
      null,
      'x',
      { ...good, matchId: 5 },
      { ...good, firstN: 1.5 },
      { ...good, lastAt: 'bozuk' },
      { ...good, decision: 'weak' },
      { ...good, count: 3 },
      { ...good, votes: good.votes.slice(0, 2) },
      { ...good, votes: [...good.votes].reverse() },
      { ...good, votes: good.votes.map((v, i) => (i === 1 ? { ...v, decision: 'reject' } : v)) },
    ]
    expect(normalizeAiShares([...bad, good])).toEqual([good])
    expect(normalizeAiShares(undefined)).toEqual([])
    // Fazladan alan taşınmaz; kimlik maç + kategoriden yeniden kurulur.
    const dirty = { ...good, id: 'baska', reason: 'gerekçe' } as unknown as AiShare
    expect(normalizeAiShares([dirty])).toEqual([good])
    expect(normalizeAiShares([{ ...good, categoryId: 'corners85' }, { ...good, categoryId: 'yok' }])).toEqual([])
    // Kategori bazlı karardan önceki (maç geneli) kayıt korunur: kategorisi yok, kimliği maç.
    const { categoryId: _, ...rest } = good
    const legacy = { ...rest, id: 'a' } as AiShare
    expect(normalizeAiShares([legacy, good])).toEqual([legacy, good])
    expect(isLegacyShare(legacy)).toBe(true)
    expect(isLegacyShare(good)).toBe(false)
  })
})
