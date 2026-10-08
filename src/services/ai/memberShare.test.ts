import { describe, expect, it } from 'vitest'
import type { AiDecision, AiProvider } from '../../config/ai'
import { defaultThresholds } from '../../config/categories'
import type { AiShare, AiVerdict } from '../../types'
import { assembleBackup, isBackupFile } from '../data/backupFormat'
import { memberShareRow, normalizeAiShares, recordAiShares } from './memberShare'

// Maç 5 Ekim 2026, 20:00 TSİ (17:00 UTC) başlıyor.
const MATCH = { date: '2026-10-05', time: '20:00' }
const BEFORE = '2026-10-05T09:00:00.000Z'
const PROVIDERS: AiProvider[] = ['chatgpt', 'gemini', 'claude']
const verdict = (provider: AiProvider, decision: AiDecision, savedAt = BEFORE): AiVerdict => ({
  id: `m|${provider}`,
  matchId: 'm',
  date: MATCH.date,
  provider,
  decision,
  reason: 'gizli gerekçe',
  risk: 'gizli risk',
  savedAt,
  score: { home: 2, away: 1 },
})
const three = (...decisions: [AiDecision, AiDecision, AiDecision]) => decisions.map((d, i) => verdict(PROVIDERS[i], d))
const row = (...decisions: [AiDecision, AiDecision, AiDecision]) => memberShareRow(MATCH, three(...decisions))

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
    expect(memberShareRow(MATCH, [verdict('chatgpt', 'medium'), verdict('gemini', 'medium')])).toBeNull()
    expect(memberShareRow(MATCH, [verdict('chatgpt', 'strong')])).toBeNull()
    expect(memberShareRow(MATCH, [])).toBeNull()
  })

  it('maç başladıktan sonra (ya da tam başlama anında) kaydedilen karar varsa gitmez', () => {
    const late = (savedAt: string) => memberShareRow(MATCH, [verdict('chatgpt', 'medium'), verdict('gemini', 'medium'), verdict('claude', 'medium', savedAt)])
    expect(late('2026-10-05T16:59:59.000Z')).not.toBeNull()
    expect(late('2026-10-05T17:00:00.000Z')).toBeNull()
    expect(late('2026-10-06T08:00:00.000Z')).toBeNull()
    expect(late('bozuk')).toBeNull()
  })

  it('saati bilinmeyen maçta gitmez', () => {
    expect(memberShareRow({ date: MATCH.date, time: undefined }, three('medium', 'medium', 'medium'))).toBeNull()
    expect(memberShareRow({ date: MATCH.date, time: 'akşam' }, three('medium', 'medium', 'medium'))).toBeNull()
  })

  it('satırda yalnızca sağlayıcı ve seviye vardır', () => {
    const text = JSON.stringify(row('medium', 'medium', 'medium'))
    for (const forbidden of ['gizli', 'reason', 'risk', 'score', 'savedAt', 'matchId']) expect(text).not.toContain(forbidden)
  })
})

describe('üyeye giden satırların kaydı', () => {
  const sent = (matchId: string, ...decisions: [AiDecision, AiDecision, AiDecision]) => ({ matchId, date: MATCH.date, row: row(...decisions)! })
  const T1 = '2026-10-05T07:00:00.000Z'
  const T2 = '2026-10-05T10:00:00.000Z'

  it('ilk gönderim: ilk ve son yayın aynıdır', () => {
    expect(recordAiShares([], [sent('a', 'medium', 'medium', 'medium')], 12, T1)).toEqual([
      { id: 'a', matchId: 'a', date: MATCH.date, firstN: 12, firstAt: T1, lastN: 12, lastAt: T1, votes: PROVIDERS.map((provider) => ({ provider, decision: 'medium' })), count: 3, decision: 'medium' },
    ])
  })

  it('yeniden gönderim: ilk yayın korunur, son yayın ve kararların kopyası güncellenir', () => {
    const first = recordAiShares([], [sent('a', 'medium', 'medium', 'medium')], 12, T1)
    const [again] = recordAiShares(first, [sent('a', 'strong', 'weak', 'strong')], 13, T2)
    expect(again).toMatchObject({ firstN: 12, firstAt: T1, lastN: 13, lastAt: T2, count: 2, decision: 'strong' })
    // Bu yayında gitmeyen maç için kayıt üretilmez (depodaki eski kayda dokunulmaz).
    expect(recordAiShares(first, [sent('b', 'strong', 'strong', 'strong')], 13, T2).map((r) => r.id)).toEqual(['b'])
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
    // Fazladan alan taşınmaz; kimlik maçtan yeniden kurulur.
    const dirty = { ...good, id: 'baska', reason: 'gerekçe' } as unknown as AiShare
    expect(normalizeAiShares([dirty])).toEqual([good])
  })
})
