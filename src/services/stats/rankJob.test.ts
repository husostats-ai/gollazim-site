import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import StatsSummaryPanel from '../../components/stats/StatsSummaryPanel'
import { defaultThresholds, type CategoryId } from '../../config/categories'
import { AppProvider } from '../../state/AppContext'
import type { Match, Pick } from '../../types'
import { analyzeCategory } from '../analysis/engine'
import { makeMatch } from '../analysis/testUtils'
import { dayFingerprint, startRankJob, type RankCache, type RankJobOptions, type Ranks } from './rankJob'
import { pickRanks, rankList } from './rankStats'
import { buildStatsSummary, fillRankSection, RANK_PENDING_TEXT } from './statsSummary'

// Sıra tablosunun arka plan hesabı: dilimler, iptal, yarış ve oturum önbelleği. Değerler sentetiktir.

let seq = 0
const SIDE = { oddsHome: 1.4, oddsDraw: 5, oddsAway: 8, oddsOver25: 1.6, oddsUnder25: 2.3, homeXg: 1.9, awayXg: 0.8 }
/** Bir günün maçları: İY 0.5 Üst yüzdeleri birer azalır; hepsinde Taraf & Gol için oran ve xG vardır */
const dayOf = (date: string, count = 8): Match[] =>
  Array.from({ length: count }, (_, i) => makeMatch({ ...SIDE, ht05Pct: 98 - i, homeXg: 1.9 + i / 10 }, { id: `j${++seq}`, date, time: `1${i % 10}:00` }))
/** Günün gerçek listelerinden (analizden) üretilmiş öneriler: İY 0.5 Üst ve Ev Kazanır & 1.5 Üst */
const picksOf = (matches: Match[]): Pick[] =>
  (['ht05', 'homeWin15'] as CategoryId[]).flatMap((categoryId) =>
    analyzeCategory(matches, categoryId, categoryId === 'ht05' ? 80 : 0).predictions.map((p) => ({
      id: `${p.match.id}|${categoryId}`,
      matchId: p.match.id,
      categoryId,
      date: p.match.date,
      percent: p.percent,
      threshold: categoryId === 'ht05' ? 80 : 0,
      outcome: 'won' as const,
      frozenAt: '',
    })),
  )
const DAYS = ['2026-10-01', '2026-10-02', '2026-10-03']
const fixture = () => {
  const matches = DAYS.flatMap((date) => dayOf(date))
  return { matches, picks: DAYS.flatMap((date) => picksOf(matches.filter((m) => m.date === date))) }
}
const copyOf = (matches: Match[]): Match[] => matches.map((m) => ({ ...m, stats: { ...m.stats } }))

/** Sayaçlı ve elle yürütülen ortam: her dilim hemen dolar, söz verme sayılır */
function harness(extra: RankJobOptions = {}) {
  const calls: { size: number; categoryId: CategoryId }[] = []
  let clock = 0
  let pauses = 0
  const cache: RankCache = new Map()
  const options: RankJobOptions = {
    cache,
    now: () => (clock += 100),
    pause: async () => {
      pauses++
    },
    buildList: (day, categoryId, threshold) => {
      calls.push({ size: day.length, categoryId })
      return rankList(day, categoryId, threshold)
    },
    ...extra,
  }
  return { options, cache, calls, pauses: () => pauses }
}
/** Elle açılan kapı: bekleyen söz verme yalnızca release() çağrılınca devam eder */
function gate() {
  let waiting: (() => void)[] = []
  return {
    pause: () => new Promise<void>((resolve) => waiting.push(resolve)),
    release: async () => {
      const now = waiting
      waiting = []
      now.forEach((resolve) => resolve())
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
    pending: () => waiting.length,
  }
}

describe('arka plan hesabının sonucu', () => {
  it('eşzamanlı hesapla (pickRanks) birebir aynıdır; Taraf & Gol önerileri de sıralanır', async () => {
    const { matches, picks } = fixture()
    expect(picks.filter((p) => p.categoryId === 'homeWin15').length).toBeGreaterThan(0)
    const ranks = await startRankJob(picks, matches, harness().options).done
    expect(ranks).not.toBeNull()
    expect([...ranks!.entries()].sort()).toEqual([...pickRanks(picks, matches).entries()].sort())
    expect([...ranks!.values()].every((rank) => rank !== null)).toBe(true)
  })

  it('varsayılan ortamda (gerçek zamanlayıcı ve oturum önbelleği) da aynı sonucu verir', async () => {
    const { matches, picks } = fixture()
    const ranks = await startRankJob(picks, matches).done
    expect([...ranks!.entries()].sort()).toEqual([...pickRanks(picks, matches).entries()].sort())
  })

  it('öneri yoksa ya da günün maç kaydı yoksa: boş sonuç / doğrulanamayan sıra', async () => {
    const { matches, picks } = fixture()
    expect((await startRankJob([], matches, harness().options).done)!.size).toBe(0)
    const none = await startRankJob(picks, [], harness().options).done
    expect([...none!.values()].every((rank) => rank === null)).toBe(true)
    expect(none!.size).toBe(picks.length)
  })
})

describe('sayfayı bekletmeme', () => {
  it('iş, ilk söz verildikten sonra başlar: başlatıldığı anda hiçbir hesap yapılmamıştır', async () => {
    const { matches, picks } = fixture()
    const door = gate()
    const env = harness({ pause: door.pause })
    const job = startRankJob(picks, matches, env.options)
    await Promise.resolve()
    expect(env.calls).toHaveLength(0)
    expect(door.pending()).toBe(1)
    job.cancel()
    await door.release()
    expect(await job.done).toBeNull()
    expect(env.calls).toHaveLength(0)
  })

  it('dilim dolunca söz verilir: Taraf & Gol modeli maç maç hazırlanır, her maçtan sonra tarayıcıya dönülür', async () => {
    const { matches, picks } = fixture()
    const env = harness()
    await startRankJob(picks, matches, env.options).done
    // Her gün: 8 tek maçlık hazırlık + 2 tam liste (İY 0.5 Üst, Ev Kazanır & 1.5 Üst).
    expect(env.calls.filter((c) => c.size === 1)).toHaveLength(24)
    expect(env.calls.filter((c) => c.size === 8)).toHaveLength(6)
    // Tek seferde en çok bir günün tek listesi hesaplanır; her adımdan sonra söz verilir.
    expect(env.pauses()).toBeGreaterThanOrEqual(30)
  })

  it('dilim dolmadıysa söz verilmez (gereksiz bekleme yok)', async () => {
    const { matches, picks } = fixture()
    const env = harness({ now: () => 0 })
    await startRankJob(picks, matches, env.options).done
    expect(env.pauses()).toBe(1)
  })

  it('Taraf & Gol önerisi olmayan günde maç maç hazırlık yapılmaz: yalnızca gereken listeler hesaplanır', async () => {
    const { matches, picks } = fixture()
    const env = harness()
    await startRankJob(picks.filter((p) => p.categoryId === 'ht05'), matches, env.options).done
    expect(env.calls).toEqual(DAYS.map(() => ({ size: 8, categoryId: 'ht05' })))
  })
})

describe('iptal ve yarış', () => {
  it('iptal edilen iş durur: sonucu null olur, sonraki dilim çalışmaz', async () => {
    const { matches, picks } = fixture()
    const door = gate()
    const env = harness({ pause: door.pause })
    const job = startRankJob(picks, matches, env.options)
    for (let i = 0; i < 5; i++) await door.release()
    const before = env.calls.length
    expect(before).toBeGreaterThan(0)
    job.cancel()
    for (let i = 0; i < 100 && door.pending() > 0; i++) await door.release()
    expect(await job.done).toBeNull()
    expect(env.calls.length).toBe(before)
  })

  it('yarım kalan iş önbelleğe yarım liste bırakmaz: sonraki iş doğru sonucu verir', async () => {
    const { matches, picks } = fixture()
    const door = gate()
    const env = harness({ pause: door.pause })
    const job = startRankJob(picks, matches, env.options)
    for (let i = 0; i < 12; i++) await door.release()
    job.cancel()
    await door.release()
    await job.done
    const again = await startRankJob(picks, matches, { ...harness().options, cache: env.cache }).done
    expect([...again!.entries()].sort()).toEqual([...pickRanks(picks, matches).entries()].sort())
  })

  it('kapsam değişimi: eski hesap iptal edilir ve sonucu yeni kapsamın üstüne yazılmaz (eski iş sonradan bitse bile)', async () => {
    const { matches, picks } = fixture()
    const last = picks.filter((p) => p.date === DAYS[2])
    // Paneldeki düzen: sonuç yalnızca iptal edilmemiş işten gelir ve gösterilen her zaman son istektir.
    const shown: { scope: string; ranks: Ranks }[] = []
    const start = (scope: string, scoped: Pick[], options: RankJobOptions) => {
      const job = startRankJob(scoped, matches, options)
      void job.done.then((ranks) => ranks && shown.push({ scope, ranks }))
      return job
    }
    // "Tümü" hesabı ağır ilerliyor (kapı elle açılıyor); kullanıcı "Son 7 gün"e geçiyor.
    const slow = gate()
    const all = start('all', picks, harness({ pause: slow.pause }).options)
    for (let i = 0; i < 4; i++) await slow.release()
    all.cancel()
    const recent = start('last7', last, harness().options)
    await recent.done
    // Eski iş bundan SONRA devam etmeye çalışıyor.
    for (let i = 0; i < 100 && slow.pending() > 0; i++) await slow.release()
    expect(await all.done).toBeNull()
    expect(shown.map((s) => s.scope)).toEqual(['last7'])
    expect(shown[0].ranks.size).toBe(last.length)
  })

  it('iptal edilmeyen iki iş de kendi sonucunu verir; sonuçlar birbirine karışmaz', async () => {
    const { matches, picks } = fixture()
    const cache: RankCache = new Map()
    const [a, b] = await Promise.all([
      startRankJob(picks.filter((p) => p.date === DAYS[0]), matches, { ...harness().options, cache }).done,
      startRankJob(picks.filter((p) => p.date !== DAYS[0]), matches, { ...harness().options, cache }).done,
    ])
    const expected = pickRanks(picks, matches)
    expect(a!.size + b!.size).toBe(picks.length)
    for (const [id, rank] of [...a!, ...b!]) expect(rank).toBe(expected.get(id))
  })
})

describe('oturum önbelleği', () => {
  it('aynı veriyle ikinci hesapta hiçbir liste yeniden hesaplanmaz (kayıtlar yeniden okunmuş, yeni nesneler olsa da)', async () => {
    const { matches, picks } = fixture()
    const first = harness()
    const ranks = await startRankJob(picks, matches, first.options).done
    const second = harness({ cache: first.cache })
    const again = await startRankJob(picks, copyOf(matches), second.options).done
    expect(second.calls).toHaveLength(0)
    expect([...again!.entries()].sort()).toEqual([...ranks!.entries()].sort())
  })

  it('kapsam daralınca da önbellek kullanılır; genişleyince yalnızca eksik günler hesaplanır', async () => {
    const { matches, picks } = fixture()
    const first = harness()
    await startRankJob(picks.filter((p) => p.date === DAYS[2]), matches, first.options).done
    const second = harness({ cache: first.cache })
    await startRankJob(picks, matches, second.options).done
    expect(second.calls.filter((c) => c.size === 8)).toHaveLength(4)
    const third = harness({ cache: first.cache })
    await startRankJob(picks.filter((p) => p.date === DAYS[0]), matches, third.options).done
    expect(third.calls).toHaveLength(0)
  })

  it('bir maç kaydı değişirse yalnızca o günün önbelleği geçersiz olur ve sonuç yeni kayda göredir', async () => {
    const { matches, picks } = fixture()
    const first = harness()
    await startRankJob(picks, matches, first.options).done
    // 2. günün en yüksek yüzdeli maçı düzenlendi: yüzdesi değişti.
    const target = matches.find((m) => m.date === DAYS[1])!
    const edited = copyOf(matches).map((m) => (m.id === target.id ? { ...m, stats: { ...m.stats, ht05Pct: 81 } } : m))
    const second = harness({ cache: first.cache })
    const ranks = await startRankJob(picks, edited, second.options).done
    expect(second.calls.filter((c) => c.size === 8)).toHaveLength(2)
    expect([...ranks!.entries()].sort()).toEqual([...pickRanks(picks, edited).entries()].sort())
    // Düzenlenen maçın önerisi artık doğrulanmaz; aynı günün diğer önerileri bir sıra yukarı çıkar.
    expect(ranks!.get(`${target.id}|ht05`)).toBeNull()
    const next = matches.filter((m) => m.date === DAYS[1])[1]
    expect(ranks!.get(`${next.id}|ht05`)).toBe(1)
  })

  it('maç silinirse ya da eklenirse o günün önbelleği geçersiz olur', async () => {
    const { matches, picks } = fixture()
    const first = harness()
    await startRankJob(picks, matches, first.options).done
    const removed = matches.filter((m) => m.id !== matches[0].id)
    const second = harness({ cache: first.cache })
    const afterRemove = await startRankJob(picks, removed, second.options).done
    expect(second.calls.filter((c) => c.size === 7)).toHaveLength(2)
    expect([...afterRemove!.entries()].sort()).toEqual([...pickRanks(picks, removed).entries()].sort())
    expect(afterRemove!.get(`${matches[0].id}|ht05`)).toBeNull()

    const added = [...matches, makeMatch({ ...SIDE, ht05Pct: 99 }, { id: 'sonradan', date: DAYS[0], time: '09:00' })]
    const third = harness({ cache: first.cache })
    const afterAdd = await startRankJob(picks, added, third.options).done
    expect(third.calls.filter((c) => c.size === 9)).toHaveLength(2)
    expect([...afterAdd!.entries()].sort()).toEqual([...pickRanks(picks, added).entries()].sort())
    // Sonradan eklenen daha yüksek yüzdeli maç, günün İY 0.5 Üst sırasını bir kaydırır.
    expect(afterAdd!.get(`${matches[0].id}|ht05`)).toBe(2)
  })

  it('kayıt özeti: sıradan bağımsızdır; herhangi bir alan, ekleme ya da silme özeti değiştirir', () => {
    const matches = dayOf('2026-10-09', 4)
    const base = dayFingerprint(matches)
    expect(dayFingerprint([...matches].reverse())).toBe(base)
    expect(dayFingerprint(copyOf(matches))).toBe(base)
    expect(dayFingerprint(matches.map((m, i) => (i === 2 ? { ...m, stats: { ...m.stats, ht05Pct: 50 } } : m)))).not.toBe(base)
    expect(dayFingerprint(matches.map((m, i) => (i === 2 ? { ...m, time: '23:59' } : m)))).not.toBe(base)
    expect(dayFingerprint(matches.map((m, i) => (i === 0 ? { ...m, edited: true } : m)))).not.toBe(base)
    expect(dayFingerprint(matches.slice(1))).not.toBe(base)
    expect(dayFingerprint([...matches, makeMatch({}, { id: 'ek', date: '2026-10-09' })])).not.toBe(base)
  })
})

describe('özet: tablo hazır olmadan', () => {
  const { matches, picks } = fixture()
  const input = (ranks?: Ranks | 'pending') =>
    buildStatsSummary({ now: new Date('2026-10-10T09:30:00.000Z'), today: '2026-10-10', scope: { kind: 'all' }, includeGuide: false, picks, matches, dayMatches: matches, verdicts: [], shared: [], thresholds: defaultThresholds(), marketConflictLimit: 25, ...(ranks && { ranks }) })
  const section = (text: string) => text.slice(text.indexOf('## Sıraya göre başarı'), text.indexOf('## Eşik üstü puana göre başarı'))

  it('hesap sürerken bölümün yerinde "Sıra tablosu hesaplanıyor…" yazar; tablo ve sayılar yoktur', () => {
    const pending = section(input('pending'))
    expect(pending).toBe(`## Sıraya göre başarı (yeniden hesaplanmış ve doğrulanmış sıra)\n\n${RANK_PENDING_TEXT}\n\n`)
    expect(input('pending')).toContain('## Eşik üstü puana göre başarı')
    expect(input('pending')).toContain('## Günlük sonuçlar')
  })

  it('hesap bitince bölüm, eşzamanlı hesaplanan özetle harfi harfine aynıdır', async () => {
    const ranks = await startRankJob(picks, matches, harness().options).done
    expect(input(ranks!)).toBe(input())
    expect(section(input(ranks!))).toContain('| Tüm kategoriler |')
    expect(input(ranks!)).not.toContain(RANK_PENDING_TEXT)
  })

  it('yer tutuculu özete tablo sonradan yerleştirilince sonuç, baştan üretilen özetle aynıdır (kapsam dahil)', async () => {
    const ranks = (await startRankJob(picks, matches, harness().options).done)!
    expect(fillRankSection(input('pending'), { picks, scope: { kind: 'all' }, today: '2026-10-10' }, ranks)).toBe(input())
    // Dar kapsam: yalnızca o günlerin önerileri tabloya girer.
    const range = { kind: 'range', from: DAYS[2], to: DAYS[2] } as const
    const scoped = (ranksOf?: Ranks | 'pending') =>
      buildStatsSummary({ now: new Date('2026-10-10T09:30:00.000Z'), today: '2026-10-10', scope: range, includeGuide: true, picks, matches, dayMatches: matches, verdicts: [], shared: [], thresholds: defaultThresholds(), marketConflictLimit: 25, ...(ranksOf && { ranks: ranksOf }) })
    expect(fillRankSection(scoped('pending'), { picks, scope: range, today: '2026-10-10' }, ranks)).toBe(scoped())
    expect(scoped()).not.toBe(input())
    // Sonuçlanmış öneri yokken bölüm de yer tutucu da yoktur: metin değişmez.
    const none = buildStatsSummary({ now: new Date(), today: '2026-10-10', scope: { kind: 'all' }, includeGuide: false, picks: [], matches: [], verdicts: [], shared: [], thresholds: defaultThresholds(), marketConflictLimit: 25, ranks: 'pending' })
    expect(fillRankSection(none, { picks: [], scope: { kind: 'all' }, today: '2026-10-10' }, new Map())).toBe(none)
  })

  it('panel ilk çizimde (tablo hazır değilken) "Özeti kopyala" ve "İndir (.txt)" kapalıdır; CSV indirme etkilenmez', () => {
    const markup = renderToStaticMarkup(createElement(AppProvider, null, createElement(StatsSummaryPanel, { picks, matches, dayMatches: matches, results: [], verdicts: [], shared: [] })))
    const button = (testId: string) => markup.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))![0]
    expect(button('summary-copy')).toContain('disabled=""')
    expect(button('summary-download')).toContain('disabled=""')
    expect(button('summary-csv')).not.toContain('disabled=""')
    expect(markup).toContain('data-testid="summary-pending"')
    expect(markup).toContain('data-ready="false"')
    expect(markup).toContain(RANK_PENDING_TEXT)
  })
})
