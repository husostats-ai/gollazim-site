import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AiVerdict, BackupFile, Match } from '../../types'
import { toAppDateTime } from '../../utils/date'
import { shiftDate } from '../../utils/format'
import { aiInputsOf, highlightInputOf, PUBLISH_DAY_COUNT } from '../memberAdmin/publish'
import { analyzeDay } from '../analysis/engine'
import { estimateSampleSize, levelForSample, RELIABILITY_LIMITS } from '../analysis/reliability'
import { CATEGORIES } from '../../config/categories'
import { TEXT_FIELDS } from '../../config/columnAliases'
import { isBackupFile } from '../data/backupFormat'
import { AI_REASON_CANARY, AI_RISK_CANARY, AI_SAVED_AT, AI_VERDICTS, dayVerdicts, DAY, dayHighlights, dayMatches, HIGHLIGHT_PERCENT, HIGHLIGHTS, MATCHES, memberInput, PICKS, PREVIOUS_DAY, RAW_CANARIES, RAW_HEADERS, RAW_STAT_KEYS, RESULTS, URL_CANARY } from './__fixtures__/rawData'
import { AI_DECISIONS, AI_PROVIDERS, decisionLabel } from '../../config/ai'
import { MEMBER_AI_LEVEL_LABELS, MEMBER_AI_PROVIDER_LABELS, memberAiSummary } from './labels'
import { buildMemberPayload, buildMemberPublication, type MemberPayload, type MemberPayloadInput } from './payload'
import { MEMBER_AI_MAJORITY_LEVELS, MEMBER_AI_PROVIDERS, MEMBER_AI_VOTE_LEVELS, assertMemberPayload, MEMBER_KEYS, MemberPayloadError, SAMPLE_LEVEL_LIMITS, SAMPLE_RANGE } from './schema'

// SIZINTI TESTLERİ: yayın paketinin düz hâlinde ham veriden hiçbir iz bulunmamalı.
// Veri (bkz. __fixtures__/rawData.ts) gerçek dışa aktarımın 107 kolonunu taşır ve ham
// alanların her hücresinde ayırt edici bir değer vardır.

const payload = buildMemberPayload(memberInput())
const text = JSON.stringify(payload)

/** Paketteki tüm nesne anahtarları ve yaprak değerler */
function walk(value: unknown, keys: Set<string>, numbers: number[], strings: string[]): void {
  if (Array.isArray(value)) value.forEach((v) => walk(v, keys, numbers, strings))
  else if (typeof value === 'object' && value !== null)
    for (const [k, v] of Object.entries(value)) {
      keys.add(k)
      walk(v, keys, numbers, strings)
    }
  else if (typeof value === 'number') numbers.push(value)
  else if (typeof value === 'string') strings.push(value)
}

const collect = (value: unknown) => {
  const keys = new Set<string>()
  const numbers: number[] = []
  const strings: string[] = []
  walk(value, keys, numbers, strings)
  return { keys, numbers, strings }
}

const ALLOWED_KEYS = new Set<string>(Object.values(MEMBER_KEYS).flat())

/** Maç kaydında CSV'den gelen kimlik metinleri; pakete takım, lig ve saat olarak girerler */
const IDENTITY_FIELDS: string[] = [...TEXT_FIELDS]

/** Hiçbir düzeyde anahtar olarak bulunamayacak adlar (kayıt nesnelerinin iç alanları) */
const FORBIDDEN_KEYS = [
  'stats',
  'id',
  'matchId',
  'uploadId',
  'edited',
  'scoreSnapshot',
  'basis',
  'notes',
  'title',
  'label',
  'market',
  'marketPercent',
  'marketConflict',
  'modelDrift',
  'secondPercent',
  'secondLabel',
  'cautiousPercent',
  'sampleSize',
  'threshold',
  'thresholds',
  'frozenAt',
  'sharedAt',
  'removedAt',
  'afterKickoff',
  'provider',
  'decision',
  'reason',
  'risk',
  'sideGoals',
  'goalModel',
  'calibration',
  'byConflict',
  'expectedGoals',
  'top',
  'best',
  'source',
]

describe('yayın paketi: ham veri sızıntısı', () => {
  it('veri boş değil: sızabilecek her tür ham alan girdide gerçekten var', () => {
    expect(RAW_HEADERS).toHaveLength(107)
    expect(MATCHES.every((m) => Object.keys(m.stats).length === 107)).toBe(true)
    expect(RAW_CANARIES.length).toBeGreaterThan(400)
    expect(MATCHES.every((m) => String(m.stats['Match FootyStats URL']).includes(URL_CANARY))).toBe(true)
    // Piyasa yüzdesi ve çelişkisi analizde hesaplanıyor (kopyalansaydı pakete girerdi).
    const analysis = analyzeDay(dayMatches(DAY), memberInput().thresholds, 'percent', 25)
    expect(analysis.btts.predictions.some((p) => p.market?.percent != null)).toBe(true)
    expect(payload.days.flatMap((d) => d.lists.flatMap((l) => l.items)).length).toBeGreaterThan(50)
  })

  it('CSV başlıklarının hiçbiri pakette geçmez', () => {
    // "League" gibi tek sözcüklü başlıklar da aranır; paket anahtarları küçük harfle yazıldığı için çakışmaz.
    for (const header of RAW_HEADERS) expect(text, `başlık: ${header}`).not.toContain(header)
  })

  it('ham istatistik anahtarlarının hiçbiri pakette geçmez', () => {
    for (const key of RAW_STAT_KEYS) expect(text, `alan: ${key}`).not.toContain(key)
  })

  it('ham hücrelerdeki ayırt edici değerlerin hiçbiri pakette geçmez (metin ve sayı olarak)', () => {
    const { numbers } = collect(payload)
    const inPayload = new Set(numbers)
    for (const canary of RAW_CANARIES) {
      expect(text, `değer: ${canary}`).not.toContain(canary)
      expect(inPayload.has(Number(canary)), `sayı: ${canary}`).toBe(false)
    }
  })

  it('paketteki sayıların hepsi tam sayıdır; tek istisna bir ondalıklı başarı oranıdır', () => {
    const { numbers } = collect(payload)
    const fractional = numbers.filter((n) => !Number.isInteger(n))
    // Oran, xG, ortalama gibi ham değerler iki ve daha çok ondalıklıdır.
    for (const n of fractional) expect(Number.isInteger(Math.round(n * 10 * 1e6) / 1e6), `sayı: ${n}`).toBe(true)
  })

  it('bağlantı, kaynak adı ve ham veri terimleri pakette geçmez', () => {
    for (const pattern of [/footystats/i, /https?:/i, /www\./i, new RegExp(URL_CANARY), /odds/i, /xg/i, /csv/i, /oran/i, /piyasa/i, /ortalama/i, /kaynak/i]) expect(text).not.toMatch(pattern)
    // Maç kimliği takım adlarından türetilir ("tarih|ev|deplasman"); pakete girmez.
    for (const m of MATCHES) expect(text).not.toContain(m.id)
    expect(text).not.toContain('yukleme-kanarya')
    // Ham istatistiklerin tutulduğu alanın adı hiçbir biçimde geçmez.
    expect(text).not.toContain('"stats"')
  })

  it('TAM ANAHTAR DENETİMİ: paketteki her anahtar izinli listededir, yasak adların hiçbiri yoktur', () => {
    const { keys } = collect(payload)
    for (const key of keys) expect(ALLOWED_KEYS.has(key), `izinli olmayan anahtar: ${key}`).toBe(true)
    for (const key of FORBIDDEN_KEYS) {
      expect(keys.has(key), `yasak anahtar: ${key}`).toBe(false)
      expect(ALLOWED_KEYS.has(key), `yasak anahtar izinli listede: ${key}`).toBe(false)
    }
    // İzinli listenin tamamı kullanılıyor: listede ölü anahtar yok.
    for (const key of ALLOWED_KEYS) expect(keys.has(key), `kullanılmayan izinli anahtar: ${key}`).toBe(true)
  })

  it('izinli anahtar listesi bilinçli değişir: liste bu testte sabitlenmiştir', () => {
    expect(MEMBER_KEYS).toEqual({
      payload: ['v', 'n', 'publishedAt', 'texts', 'days', 'statistics'],
      texts: ['disclaimer', 'account'],
      day: ['date', 'matches', 'lists', 'highlights'],
      dayV3: ['date', 'matches', 'lists'],
      highlight: ['home', 'away', 'league', 'time', 'categoryId', 'status', 'score', 'outcome'],
      match: ['home', 'away', 'league', 'time', 'status', 'score', 'homeStanding', 'awayStanding'],
      matchOptional: ['ai'],
      ai: ['votes', 'count', 'level'],
      aiVote: ['who', 'level'],
      standing: ['rank', 'played', 'stale'],
      list: ['categoryId', 'items'],
      item: ['match', 'percent', 'model', 'conflict', 'stars', 'reliability', 'outcome', 'detail', 'others'],
      itemOptional: ['sample'],
      itemV1: ['match', 'percent', 'model', 'conflict', 'stars', 'reliability', 'outcome', 'detail'],
      other: ['categoryId', 'percent', 'reliability'],
      statsRoot: ['all', 'shared'],
      stats: ['main', 'overall', 'matches', 'byCategory', 'byReliability', 'daily', 'weekly', 'monthly', 'stars'],
      statsV2: ['overall', 'matches', 'byCategory', 'byReliability', 'daily', 'weekly', 'monthly', 'stars'],
      main: ['categories', 'overall', 'matches'],
      statsMatches: ['total', 'decided'],
      bucket: ['key', 'tally'],
      tally: ['won', 'lost', 'void', 'pending', 'decided', 'total', 'rate', 'lowSample'],
      stars: ['byStars', 'byCategory', 'recomputed', 'missing'],
      starsCategory: ['key', 'byStars'],
    })
  })
})

describe('yayın paketi: şema denetimi fazladan ya da eksik alanı reddeder', () => {
  // Her nesneyi tek tek değiştiren bu testler küçük bir paketle çalışır (iki maç); paket yine
  // her tür nesneyi içerir: maç, lig sırası, liste, öneri, diğer öneriler, istatistik dökümleri.
  const small = buildMemberPayload(memberInput({ days: [{ date: DAY, matches: dayMatches(DAY).filter((m) => ['Kuzey Yıldızı', 'Doğu Gençlik'].includes(m.home)), results: RESULTS, ai: aiInputsOf(dayMatches(DAY), dayVerdicts(DAY)).inputs }] }))
  const smallText = JSON.stringify(small)

  /** Paketteki her nesne için: o nesneye uygulanacak değişikliği yapıp kopyayı döner */
  function mutations(mutate: (node: Record<string, unknown>) => void): unknown[] {
    const variants: unknown[] = []
    const count = (function visit(value: unknown): number {
      if (Array.isArray(value)) return value.reduce<number>((sum, v) => sum + visit(v), 0)
      if (typeof value !== 'object' || value === null) return 0
      return 1 + Object.values(value).reduce<number>((sum, v) => sum + visit(v), 0)
    })(small)
    for (let target = 0; target < count; target++) {
      const copy = JSON.parse(smallText) as unknown
      let seen = 0
      ;(function visit(value: unknown): void {
        if (Array.isArray(value)) return value.forEach(visit)
        if (typeof value !== 'object' || value === null) return
        if (seen++ === target) mutate(value as Record<string, unknown>)
        Object.values(value).forEach(visit)
      })(copy)
      variants.push(copy)
    }
    return variants
  }

  it('geçerli paket kabul edilir (JSON gidiş-dönüşünden sonra da)', () => {
    expect(() => assertMemberPayload(payload)).not.toThrow()
    expect(() => assertMemberPayload(JSON.parse(text))).not.toThrow()
  })

  it('paketin HERHANGİ bir nesnesine eklenen fazladan alan reddedilir', () => {
    const variants = mutations((node) => {
      node.sizinti = { Odds_Home_Win: 1.737 }
    })
    expect(variants.length).toBeGreaterThan(200)
    // Küçük paket her nesne türünü içeriyor.
    const kinds = collect(small).keys
    for (const key of ALLOWED_KEYS) expect(kinds.has(key), `küçük pakette yok: ${key}`).toBe(true)
    for (const variant of variants) expect(() => assertMemberPayload(variant)).toThrow(MemberPayloadError)
  })

  it('paketin herhangi bir nesnesinden silinen alan reddedilir', () => {
    const variants = mutations((node) => {
      delete node[Object.keys(node)[0]]
    })
    for (const variant of variants) expect(() => assertMemberPayload(variant)).toThrow(MemberPayloadError)
  })

  it('biçimi tutmayan değer reddedilir: serbest metin skor/ayrıntı alanına sığamaz', () => {
    const broken = (change: (p: MemberPayload) => void) => {
      const copy = JSON.parse(text) as MemberPayload
      change(copy)
      return () => assertMemberPayload(copy)
    }
    const firstItem = (p: MemberPayload) => p.days[0].lists.find((l) => l.items.length > 0)!.items[0]
    expect(broken((p) => void (p.days[0].matches[0].score = 'oran 1.737'))).toThrow(MemberPayloadError)
    expect(broken((p) => void (firstItem(p).detail = 'xG 1.91 – 1.27'))).toThrow(MemberPayloadError)
    expect(broken((p) => void (firstItem(p).percent = 87.5))).toThrow(MemberPayloadError)
    expect(broken((p) => void (firstItem(p).stars = 6))).toThrow(MemberPayloadError)
    expect(broken((p) => void ((firstItem(p) as { reliability: string }).reliability = 'çok yüksek'))).toThrow(MemberPayloadError)
    expect(broken((p) => void (firstItem(p).match = 999))).toThrow(MemberPayloadError)
    // Çelişki türü serbest metin değildir ve kategoriyle tutarlı olmalıdır.
    expect(broken((p) => void ((firstItem(p) as { conflict: unknown }).conflict = true))).toThrow(MemberPayloadError)
    expect(broken((p) => void ((firstItem(p) as { conflict: unknown }).conflict = 'piyasa'))).toThrow(MemberPayloadError)
    expect(broken((p) => void (p.days[0].lists[0].items[0].conflict = 'hesap'))).toThrow(MemberPayloadError)
    expect(broken((p) => void (p.days[0].lists.find((l) => l.categoryId === 'homeWin15')!.items[0].conflict = 'model'))).toThrow(MemberPayloadError)
    expect(broken((p) => void ((p as { v: number }).v = 7))).toThrow(MemberPayloadError)
    expect(broken((p) => void (p.days = []))).toThrow(MemberPayloadError)
    expect(broken((p) => void p.days[0].lists.reverse())).toThrow(MemberPayloadError)
  })
})

describe('yayın paketi: "aynı maçın diğer önerileri" yalnızca paketteki önerilerden türer', () => {
  const copy = (): MemberPayload => JSON.parse(text) as MemberPayload
  const rejects = (change: (p: MemberPayload) => void) => {
    const p = copy()
    change(p)
    return () => assertMemberPayload(p)
  }
  /** Birden çok listede yer alan bir öneri */
  const multi = (p: MemberPayload) => p.days[0].lists.flatMap((l) => l.items).find((i) => (i.others ?? []).length >= 2)!

  it('her giriş, aynı maçın o listede gerçekten bulunan önerisiyle birebir aynıdır', () => {
    let entries = 0
    for (const day of payload.days)
      for (const list of day.lists)
        for (const item of list.items) {
          expect(item.others).toBeDefined()
          const expected = day.lists.flatMap((other) => {
            const same = other.categoryId === list.categoryId ? undefined : other.items.find((c) => c.match === item.match)
            return same ? [{ categoryId: other.categoryId, percent: same.percent, reliability: same.reliability }] : []
          })
          expect(item.others).toEqual(expected)
          // Kendi kategorisi tekrar edilmez.
          expect(item.others!.some((o) => o.categoryId === list.categoryId)).toBe(false)
          entries += item.others!.length
        }
    expect(entries).toBeGreaterThan(100)
    expect(payload.v).toBe(6)
  })

  it('pakete girmeyen (ilk 15 dışında kalan) öneri bu satıra da girmez', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...MATCHES[0], id: `cok-${i}`, home: `Ev ${i}`, away: `Dep ${i}`, stats: { ...MATCHES[0].stats, over25Pct: 80 + i, bttsPct: 99 - i } }))
    const day = buildMemberPayload(memberInput({ days: [{ date: DAY, matches: many, results: [] }], picks: [], shared: [], leagueTables: [] })).days[0]
    const over25 = day.lists.find((l) => l.categoryId === 'over25')!
    const btts = day.lists.find((l) => l.categoryId === 'btts')!
    // 2.5 Üst'te ilk 15'e giren ama KG Var'da ilk 15'e giremeyen maçlar: "KG VAR" satırı yok.
    const inBtts = new Set(btts.items.map((i) => i.match))
    const outside = over25.items.filter((i) => !inBtts.has(i.match))
    expect(outside.length).toBeGreaterThan(0)
    for (const item of outside) expect(item.others!.some((o) => o.categoryId === 'btts')).toBe(false)
    for (const item of over25.items.filter((i) => inBtts.has(i.match))) expect(item.others!.some((o) => o.categoryId === 'btts')).toBe(true)
  })

  it('şema: uydurma, eksik, fazla, sırasız ya da tutarsız giriş reddedilir', () => {
    expect(rejects((p) => void (multi(p).others![0].percent += 1))).toThrow(MemberPayloadError)
    expect(rejects((p) => void (multi(p).others![0].reliability = 'unmeasured'))).toThrow(MemberPayloadError)
    expect(rejects((p) => void multi(p).others!.pop())).toThrow(MemberPayloadError)
    expect(rejects((p) => void multi(p).others!.reverse())).toThrow(MemberPayloadError)
    expect(rejects((p) => void multi(p).others!.push({ categoryId: 'cards45', percent: 99, reliability: 'high' }))).toThrow(MemberPayloadError)
    expect(rejects((p) => void (p.days[0].lists[0].items[0].others = [{ categoryId: p.days[0].lists[0].categoryId, percent: p.days[0].lists[0].items[0].percent, reliability: p.days[0].lists[0].items[0].reliability }]))).toThrow(MemberPayloadError)
    expect(rejects((p) => void ((multi(p).others![0] as unknown as Record<string, unknown>).odds = 1.737))).toThrow(MemberPayloadError)
    expect(rejects((p) => void ((multi(p).others![0] as unknown as Record<string, unknown>).categoryId = 'Odds_BTTS_Yes'))).toThrow(MemberPayloadError)
    expect(rejects((p) => void ((multi(p) as unknown as Record<string, unknown>).others = null))).toThrow(MemberPayloadError)
    expect(rejects((p) => void delete multi(p).others)).toThrow(MemberPayloadError)
    expect(rejects(() => undefined)).not.toThrow()
  })

  it('sürüm 1 paket (bu alan olmadan) hâlâ kabul edilir; sürümler karıştırılamaz', () => {
    const v1 = copy()
    ;(v1 as { v: number }).v = 1
    for (const scope of ['all', 'shared'] as const) delete v1.statistics[scope].main
    for (const day of v1.days) for (const list of day.lists) for (const item of list.items) delete item.others
    for (const day of v1.days) for (const list of day.lists) for (const item of list.items) delete item.sample
    for (const day of v1.days) delete day.highlights
    for (const day of v1.days) for (const match of day.matches) delete match.ai
    expect(() => assertMemberPayload(v1)).not.toThrow()
    // Sürüm 1 pakette bu alan bulunamaz; sürüm 2 pakette bulunmak zorundadır.
    expect(rejects((p) => void ((p as { v: number }).v = 1))).toThrow(MemberPayloadError)
    const v2 = JSON.parse(JSON.stringify(v1)) as MemberPayload
    ;(v2 as { v: number }).v = 2
    expect(() => assertMemberPayload(v2)).toThrow(MemberPayloadError)
  })
})

describe('yayın paketi: ana kategorilerin toplu başarısı (sürüm 3)', () => {
  const copy = (): MemberPayload => JSON.parse(text) as MemberPayload
  const rejects = (mutate: (p: MemberPayload) => void) => () => {
    const p = copy()
    mutate(p)
    assertMemberPayload(p)
  }
  type Loose = Record<string, unknown>

  it('alan yalnızca kategori kimlikleri ve sayım içerir; fazladan alan, bilinmeyen ya da yinelenen kategori reddedilir', () => {
    for (const scope of ['all', 'shared'] as const) {
      const main = payload.statistics[scope].main!
      expect(Object.keys(main)).toEqual(['categories', 'overall', 'matches'])
      expect(main.categories).toEqual(['over25', 'btts', 'ht05'])
    }
    expect(rejects((p) => void ((p.statistics.all.main as unknown as Loose).odds = 1.737))).toThrow(MemberPayloadError)
    expect(rejects((p) => void ((p.statistics.all.main!.overall as unknown as Loose).avgGoals = 2.61))).toThrow(MemberPayloadError)
    expect(rejects((p) => void ((p.statistics.all.main!.categories as string[])[0] = 'Odds_BTTS_Yes'))).toThrow(MemberPayloadError)
    expect(rejects((p) => void p.statistics.all.main!.categories.push('over25'))).toThrow(MemberPayloadError)
    expect(rejects((p) => void (p.statistics.all.main!.categories = []))).toThrow(MemberPayloadError)
    expect(rejects((p) => void ((p.statistics.shared as unknown as Loose).main = null))).toThrow(MemberPayloadError)
    expect(rejects((p) => void delete p.statistics.shared.main)).toThrow(MemberPayloadError)
    expect(rejects(() => undefined)).not.toThrow()
  })

  it('sürüm 2 paket (bu alan olmadan) hâlâ kabul edilir; sürümler karıştırılamaz', () => {
    const v2 = copy()
    ;(v2 as { v: number }).v = 2
    for (const scope of ['all', 'shared'] as const) delete v2.statistics[scope].main
    for (const day of v2.days) delete day.highlights
    for (const day of v2.days) for (const list of day.lists) for (const item of list.items) delete item.sample
    for (const day of v2.days) for (const match of day.matches) delete match.ai
    expect(() => assertMemberPayload(v2)).not.toThrow()
    // Sürüm 2 pakette bu alan bulunamaz; sürüm 3 pakette bulunmak zorundadır.
    expect(rejects((p) => void ((p as { v: number }).v = 2))).toThrow(MemberPayloadError)
    const v3 = JSON.parse(JSON.stringify(v2)) as MemberPayload
    ;(v3 as { v: number }).v = 3
    expect(() => assertMemberPayload(v3)).toThrow(MemberPayloadError)
  })
})

describe('yayın paketi: günün öne çıkanları (sürüm 4)', () => {
  const copy = (): MemberPayload => JSON.parse(text) as MemberPayload
  const rejects = (mutate: (p: MemberPayload) => void) => () => {
    const p = copy()
    mutate(p)
    assertMemberPayload(p)
  }
  type Loose = Record<string, unknown>
  const today = payload.days[0].highlights!
  const find = (home: string, categoryId: string) => today.find((h) => h.home === home && h.categoryId === categoryId)!

  it('her günün seçimleri o günle birlikte, saat sırasıyla; yalnızca sekiz izinli alan', () => {
    expect(payload.days.map((d) => d.highlights!.length)).toEqual([dayHighlights(DAY).length, dayHighlights(PREVIOUS_DAY).length])
    expect(today.map((h) => h.time)).toEqual([...today.map((h) => h.time)].sort())
    for (const day of payload.days) for (const h of day.highlights!) expect(Object.keys(h)).toEqual(['home', 'away', 'league', 'time', 'categoryId', 'status', 'score', 'outcome'])
    expect(find('Kuzey Yıldızı', 'over25')).toEqual({ home: 'Kuzey Yıldızı', away: 'Güney Spor', league: 'Testland · Deneme Ligi', time: dayMatches(DAY).find((m) => m.home === 'Kuzey Yıldızı')!.time, categoryId: 'over25', status: 'completed', score: 'İY 1-0 · MS 3-1', outcome: 'won' })
  })

  it('sonuç mevcut değerlendirmeyle gelir: tuttu, tutmadı, bekliyor', () => {
    expect(find('Kuzey Yıldızı', 'over25').outcome).toBe('won')
    expect(find('Kuzey Yıldızı', 'corners85').outcome).toBe('won')
    expect(find('Doğu Gençlik', 'over25')).toMatchObject({ outcome: 'lost', score: 'İY 0-0 · MS 0-0' })
    expect(find('İç Anadolu FK', 'over25')).toMatchObject({ outcome: 'pending', status: null, score: null })
    expect(payload.days[1].highlights![0]).toMatchObject({ home: 'Dünkü Ev', categoryId: 'btts', outcome: 'won' })
    // Dondurulmuş önerinin sonucuyla aynı.
    for (const record of dayHighlights(DAY)) {
      const pick = PICKS.find((p) => p.matchId === record.matchId && p.categoryId === record.categoryId)
      if (pick) expect(find(record.home, record.categoryId).outcome).toBe(pick.outcome)
    }
  })

  it('yüzde, güvenilirlik, eklenme zamanı ve kayıt kimlikleri pakete girmez', () => {
    // Kurucunun girdisi kayıttan indirgenir: o alanlar kurucuya hiç verilmez.
    for (const record of HIGHLIGHTS) expect(Object.keys(highlightInputOf({ ...record, publishedAt: '2026-10-05T07:00:00.000Z' }))).toEqual(['matchId', 'categoryId', 'home', 'away', 'time', 'league'])
    const section = JSON.stringify(payload.days.map((d) => d.highlights))
    const { keys, numbers, strings } = collect(payload.days.map((d) => d.highlights))
    for (const key of ['percent', 'reliability', 'addedAt', 'publishedAt', 'id', 'matchId', 'date']) expect(keys.has(key), key).toBe(false)
    // Öne çıkan satırlarında hiç sayı yoktur; kayıttaki yüzde (43) ve güvenilirlik (ölçülemedi) de geçmez.
    expect(numbers).toEqual([])
    expect(HIGHLIGHTS.every((h) => h.percent === HIGHLIGHT_PERCENT && h.reliability === 'unmeasured')).toBe(true)
    expect(section).not.toContain('unmeasured')
    for (const record of HIGHLIGHTS) {
      expect(strings).not.toContain(record.id)
      expect(strings).not.toContain(record.matchId)
      expect(section).not.toContain(record.addedAt)
    }
    // Kayıttaki yüzde, güvenilirlik ve eklenme zamanı değişince paket değişmez.
    const altered = memberInput({ days: memberInput().days.map((d) => ({ ...d, highlights: dayHighlights(d.date).map((h) => highlightInputOf({ ...h, percent: 99, reliability: 'low', addedAt: '2026-01-01T00:00:00.000Z' })) })) })
    expect(JSON.stringify(buildMemberPayload(altered))).toBe(text)
  })

  it('maç verisi silinmişse seçim kayıttaki adlarla girer; sonuç dondurulmuş öneriden gelir', () => {
    const input = memberInput()
    const gone = dayHighlights(DAY).find((h) => h.home === 'Kuzey Yıldızı' && h.categoryId === 'over25')!
    const without = buildMemberPayload({ ...input, days: input.days.map((d) => ({ ...d, matches: d.matches.filter((m) => m.id !== gone.matchId), results: d.results.filter((r) => r.matchId !== gone.matchId) })) })
    expect(without.days[0].highlights!.find((h) => h.home === 'Kuzey Yıldızı' && h.categoryId === 'over25')).toEqual({ home: 'Kuzey Yıldızı', away: 'Güney Spor', league: gone.league, time: gone.time, categoryId: 'over25', status: null, score: null, outcome: 'won' })
  })

  it('seçim verilmeyen günde alan boş dizidir', () => {
    const none = buildMemberPayload(memberInput({ days: memberInput().days.map(({ date, matches, results }) => ({ date, matches, results })) }))
    expect(none.days.map((d) => d.highlights)).toEqual([[], []])
    expect(() => assertMemberPayload(JSON.parse(JSON.stringify(none)))).not.toThrow()
  })

  it('şema: fazladan alan (yüzde, güvenilirlik), bozuk değer ve yinelenen seçim reddedilir', () => {
    const first = (p: MemberPayload) => p.days[0].highlights![0] as unknown as Loose
    expect(rejects((p) => void (first(p).percent = 80))).toThrow('izinli olmayan alan: percent')
    expect(rejects((p) => void (first(p).reliability = 'high'))).toThrow('izinli olmayan alan: reliability')
    expect(rejects((p) => void (first(p).addedAt = '2026-10-05T06:00:00.000Z'))).toThrow(MemberPayloadError)
    expect(rejects((p) => void delete first(p).outcome)).toThrow('eksik alan: outcome')
    expect(rejects((p) => void (first(p).outcome = null))).toThrow(MemberPayloadError)
    expect(rejects((p) => void (first(p).outcome = 'kazandı'))).toThrow(MemberPayloadError)
    expect(rejects((p) => void (first(p).time = 'akşam'))).toThrow(MemberPayloadError)
    expect(rejects((p) => void (first(p).categoryId = 'yok'))).toThrow(MemberPayloadError)
    expect(rejects((p) => void (first(p).score = '%80 ihtimal'))).toThrow(MemberPayloadError)
    expect(rejects((p) => void p.days[0].highlights!.push({ ...p.days[0].highlights![0] }))).toThrow('aynı seçim bir günde iki kez yer alamaz')
    expect(rejects((p) => void ((p.days[0] as unknown as Loose).highlights = 'yok'))).toThrow(MemberPayloadError)
  })

  it('sürüm 3 paket (bu alan olmadan) hâlâ kabul edilir; sürümler karıştırılamaz', () => {
    const v3 = copy()
    ;(v3 as { v: number }).v = 3
    for (const day of v3.days) delete day.highlights
    for (const day of v3.days) for (const list of day.lists) for (const item of list.items) delete item.sample
    for (const day of v3.days) for (const match of day.matches) delete match.ai
    expect(() => assertMemberPayload(v3)).not.toThrow()
    // Sürüm 3 pakette bu alan bulunamaz; sürüm 4 pakette bulunmak zorundadır.
    expect(rejects((p) => void ((p as { v: number }).v = 3))).toThrow(MemberPayloadError)
    const v4 = JSON.parse(JSON.stringify(v3)) as MemberPayload
    ;(v4 as { v: number }).v = 4
    expect(() => assertMemberPayload(v4)).toThrow('eksik alan: highlights')
  })
})

describe('yayın paketi: tahmini maç sayısı (sürüm 5)', () => {
  const copy = (): MemberPayload => JSON.parse(text) as MemberPayload
  const rejects = (mutate: (p: MemberPayload) => void) => () => {
    const p = copy()
    mutate(p)
    assertMemberPayload(p)
  }
  type Loose = Record<string, unknown>
  const items = payload.days.flatMap((day) => day.lists.flatMap((list) => list.items.map((item) => ({ day, list, item }))))
  const withSample = (p: MemberPayload) => p.days[0].lists.flatMap((l) => l.items).find((i) => i.sample !== undefined)!
  const withoutSample = (p: MemberPayload) => p.days[0].lists.flatMap((l) => l.items).find((i) => i.sample === undefined)!

  it('sayı, analizdeki tahmini örneklemin aynısıdır; seviye ondan çıkar', () => {
    let counted = 0
    for (const { day, item } of items) {
      if (item.sample === undefined) continue
      const shown = day.matches[item.match]
      const match = dayMatches(day.date).find((m) => m.home === shown.home && m.away === shown.away)!
      expect(item.sample).toBe(estimateSampleSize(match))
      expect(item.reliability).toBe(levelForSample(item.sample))
      counted++
    }
    expect(counted).toBeGreaterThan(30)
  })

  it('sayı çıkarılamayan öneride alan hiç yoktur (null ya da 0 yazılmaz)', () => {
    for (const { item } of items) {
      const measured = item.reliability === 'low' || item.reliability === 'medium' || item.reliability === 'high'
      expect('sample' in item, `${item.reliability}`).toBe(measured)
      if (measured) expect(Number.isInteger(item.sample) && item.sample! >= SAMPLE_RANGE.min && item.sample! <= SAMPLE_RANGE.max).toBe(true)
    }
    // Korner / kart (ölçülemedi) ve Taraf & Gol (model tabanlı) listelerinde sayı yok.
    expect(items.filter(({ item }) => item.reliability === 'unmeasured').length).toBeGreaterThan(0)
    expect(items.filter(({ item }) => item.reliability === 'market' || item.reliability === 'market-partial').length).toBeGreaterThan(0)
  })

  it('sayı yalnızca önerinin kendisinde: diğer öneriler satırına, öne çıkanlara ve istatistiğe girmez', () => {
    for (const { item } of items) for (const other of item.others!) expect(Object.keys(other)).toEqual(['categoryId', 'percent', 'reliability'])
    const elsewhere = collect([payload.days.map((d) => d.highlights), payload.days.map((d) => d.matches), payload.statistics, payload.texts])
    expect(elsewhere.keys.has('sample')).toBe(false)
    // Pakete bu sürümde başka hiçbir yeni alan girmedi: izinli anahtarlara eklenen tek ad budur.
    expect(MEMBER_KEYS.itemOptional).toEqual(['sample'])
    expect(MEMBER_KEYS.highlight).toEqual(['home', 'away', 'league', 'time', 'categoryId', 'status', 'score', 'outcome'])
  })

  it('şema: alan isteğe bağlıdır; seviyeyle tutarsız, aralık dışı ya da tam sayı olmayan değer reddedilir', () => {
    expect(() => assertMemberPayload(copy())).not.toThrow()
    expect(rejects((p) => void delete withSample(p).sample)).not.toThrow()
    expect(rejects((p) => void (withSample(p).sample = 4.5))).toThrow(MemberPayloadError)
    expect(rejects((p) => void (withSample(p).sample = 1))).toThrow(MemberPayloadError)
    expect(rejects((p) => void (withSample(p).sample = 41))).toThrow(MemberPayloadError)
    expect(rejects((p) => void ((withSample(p) as unknown as Loose).sample = '12'))).toThrow(MemberPayloadError)
    expect(rejects((p) => void ((withSample(p) as unknown as Loose).sample = null))).toThrow(MemberPayloadError)
    // Seviye sayıdan çıkar: uyuşmayan çift kabul edilmez.
    expect(rejects((p) => void (withSample(p).sample = withSample(p).reliability === 'high' ? 4 : 30))).toThrow('seviyeyle tutarlı olmalı')
    // Sayısı olamayacak seviyede (ölçülemedi, model tabanlı) sayı bulunamaz.
    expect(rejects((p) => void (withoutSample(p).sample = 12))).toThrow('seviyeyle tutarlı olmalı')
    // Başka nesnelere eklenemez.
    expect(rejects((p) => void ((p.days[0].highlights![0] as unknown as Loose).sample = 12))).toThrow('izinli olmayan alan: sample')
    expect(rejects((p) => void ((p.days[0].matches[0] as unknown as Loose).sample = 12))).toThrow('izinli olmayan alan: sample')
  })

  it('seviye sınırları analizdeki eşiklerle aynıdır (8 ve 16)', () => {
    expect(SAMPLE_LEVEL_LIMITS).toEqual(RELIABILITY_LIMITS)
    expect(SAMPLE_LEVEL_LIMITS).toEqual({ medium: 8, high: 16 })
    for (const n of [2, 7, 8, 15, 16, 40]) {
      const p = copy()
      const item = withSample(p)
      const day = p.days[0]
      const level = levelForSample(n)
      // Aynı maçın diğer listelerdeki satırları da tutarlı kalsın diye yalnızca bu öneri ve ona bakan satırlar değişir.
      const listIndex = day.lists.findIndex((l) => l.items.includes(item))
      for (const list of day.lists) for (const entry of list.items) for (const other of entry.others!) if (entry.match === item.match && other.categoryId === day.lists[listIndex].categoryId) other.reliability = level
      item.sample = n
      item.reliability = level
      expect(() => assertMemberPayload(p), `${n} -> ${level}`).not.toThrow()
    }
  })

  it('sürüm 4 paket (bu alan olmadan) hâlâ kabul edilir; sürüm 4 pakette alan bulunamaz', () => {
    const v4 = copy()
    ;(v4 as { v: number }).v = 4
    for (const day of v4.days) for (const list of day.lists) for (const item of list.items) delete item.sample
    for (const day of v4.days) for (const match of day.matches) delete match.ai
    expect(() => assertMemberPayload(v4)).not.toThrow()
    expect(
      rejects((p) => {
        ;(p as { v: number }).v = 4
        for (const day of p.days) for (const match of day.matches) delete match.ai
      }),
    ).toThrow('izinli olmayan alan: sample')
    // Sürüm 5 pakette alan zorunlu değildir (sayı çıkarılamayan öneriler).
    const v5 = JSON.parse(JSON.stringify(v4)) as MemberPayload
    ;(v5 as { v: number }).v = 5
    expect(() => assertMemberPayload(v5)).not.toThrow()
  })
})

describe('yayın paketi: yalnızca izinli girdilere bağlıdır', () => {
  const withMatches = (change: (match: Match) => Match): MemberPayloadInput => {
    const input = memberInput()
    return { ...input, days: input.days.map((d) => ({ ...d, matches: d.matches.map(change) })) }
  }
  const build = (input: MemberPayloadInput) => JSON.stringify(buildMemberPayload(input))

  it('piyasa oranları değişince paket değişmez (piyasa yüzdesi ve çelişkisi pakete girmiyor)', () => {
    // Yalnızca piyasa yüzdesine giren oranlar: analizde başka hiçbir yerde kullanılmaz.
    const marketOnly = ['Odds_Over35', 'Odds_Under35', 'Odds_Over45', 'Odds_Under45', 'Odds_BTTS_Yes', 'Odds_BTTS_No', 'Odds_1st_Half_Over05', 'Odds_1st_Half_Under05', 'Odds_1st_Half_Over15', 'Odds_1st_Half_Under15', 'Odds_2nd_Half_Over05', 'Odds_2nd_Half_Under05', 'Odds_Corners_Over85', 'Odds_Corners_Under85', 'Odds_Corners_Over95', 'Odds_Corners_Under95', 'Odds_Corners_Over105', 'Odds_Corners_Under105']
    const changed = withMatches((m) => ({ ...m, stats: { ...m.stats, ...Object.fromEntries(marketOnly.map((key, i) => [key, i % 2 === 0 ? 1.05 : 15])) } }))
    // Değişiklik gerçekten piyasa yüzdesini oynatıyor…
    const before = analyzeDay(dayMatches(DAY), memberInput().thresholds, 'percent', 25).btts.predictions.map((p) => p.market?.percent)
    const after = analyzeDay(changed.days[0].matches, changed.thresholds, 'percent', 25).btts.predictions.map((p) => p.market?.percent)
    expect(after).not.toEqual(before)
    // …ama paket bayt bayt aynı kalıyor.
    expect(build(changed)).toBe(text)
    expect(build({ ...memberInput(), marketConflictLimit: 1 })).toBe(text)
  })

  it('bağlantı, tanınmayan kolonlar ve kayıt iç alanları değişince paket değişmez', () => {
    const unknownColumns = RAW_HEADERS.filter((h) => /Shots|Possession|Offsides|Yellow|Red Cards|Game Week|DoubleChance|DrawNoBet|Match Status|URL|Current|Overall|Under\d\d Average|1H BTTS|Corners_(Over|Under)(75|115)|More_Corners|Same_Corners/.test(h))
    expect(unknownColumns.length).toBeGreaterThan(30)
    const changed = withMatches((m) => ({
      ...m,
      uploadId: 'baska-yukleme',
      edited: true,
      scoreSnapshot: { source: 'market', takenAt: '2026-10-05T19:00:00.000Z', best: { home: 2, away: 1 }, expectedGoals: 2.917 },
      stats: { ...m.stats, ...Object.fromEntries(unknownColumns.map((key) => [key, key.includes('URL') ? 'https://footystats.org/baska' : 73.9173])) },
    }))
    expect(build(changed)).toBe(text)
  })

  it('duyarlılık denetimi: izinli bir girdi (hazır yüzde) değişince paket değişir', () => {
    expect(build(withMatches((m) => ({ ...m, stats: { ...m.stats, over25Pct: 99 } })))).not.toBe(text)
  })

  it('yapay zekâ kararları ve ayarlar kurucunun girdisi değildir (derleme hatası)', () => {
    const verdict: AiVerdict = { id: 'x|chatgpt', matchId: 'x', date: DAY, provider: 'chatgpt', decision: 'strong', reason: 'kanarya gerekçe', risk: 'kanarya risk', savedAt: DAY }
    // @ts-expect-error aiVerdicts izinli bir girdi değil
    const withAi: MemberPayloadInput = { ...memberInput(), aiVerdicts: [verdict] }
    // @ts-expect-error storyTexts izinli bir girdi değil
    const withSettings: MemberPayloadInput = { ...memberInput(), storyTexts: { telegram: 'kanarya-telegram' } }
    // Tip denetimi atlanıp verilse bile pakete girmez.
    expect(build(withAi)).toBe(text)
    expect(build(withSettings)).toBe(text)
  })

  it('girdi olarak verilen sonuçlar dışında skor üretilmez', () => {
    const noResults = buildMemberPayload({ ...memberInput(), days: memberInput().days.map((d) => ({ ...d, results: [] })) })
    expect(noResults.days.flatMap((d) => d.matches).every((m) => m.status === null && m.score === null)).toBe(true)
    expect(RESULTS.length).toBeGreaterThan(0)
  })
})

describe('yayın paketi: kaynak kodu kuralları', () => {
  const dir = 'src/services/member'
  const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  const code = (file: string) =>
    readFileSync(join(dir, file), 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
      .join('\n')

  it('paket kurucuda nesne yayma (...) kullanılmaz: her alan adıyla yazılır', () => {
    expect(code('payload.ts')).not.toContain('...')
  })

  it('üye modülü ham veri, yapay zekâ, veri deposu ve uygulama durumu modüllerini içe aktarmaz', () => {
    const forbidden = [/services\/data|\.\.\/data\//, /\.\.\/csv\//, /\.\.\/ai\//, /\/state\//, /analysis\/market/, /analysis\/scoreForecast/, /analysis\/summary/, /analysis\/stat'/, /columnAliases/, /dexie/]
    expect(sources.length).toBeGreaterThan(0)
    for (const file of sources) {
      const imports = code(file).split('\n').filter((line) => /^\s*import\b|\bfrom\s+'/.test(line)).join('\n')
      for (const pattern of forbidden) expect(imports, `${file} içe aktarıyor: ${pattern}`).not.toMatch(pattern)
    }
  })
})

// Gerçek veriyle denetim; normal test çalıştırmasında atlanır.
// UYE_BACKUP=samples/gollazim-yedek-….json npx vitest run src/services/member
describe.runIf(process.env.UYE_BACKUP)('yayın paketi: gerçek yedekle', () => {
  const load = (): BackupFile => {
    const data: unknown = JSON.parse(readFileSync(process.env.UYE_BACKUP!, 'utf8'))
    if (!isBackupFile(data)) throw new Error('UYE_BACKUP bir GOLLAZIM yedeği değil.')
    return data
  }

  it('listeler analizle aynı; ham değerlerin hiçbiri pakette yok', async () => {
    const b = load()
    const day = toAppDateTime(new Date(b.exportedAt)).date
    const dates = Array.from({ length: PUBLISH_DAY_COUNT }, (_, back) => shiftDate(day, -back))
    const limit = b.marketConflictLimit ?? 25
    const real = buildMemberPayload({
      n: 1,
      publishedAt: b.exportedAt,
      texts: memberInput().texts,
      thresholds: b.thresholds,
      marketConflictLimit: limit,
      days: dates.map((date) => {
        const matches = b.matches.filter((m) => m.date === date)
        return { date, matches, results: b.results.filter((r) => matches.some((m) => m.id === r.matchId)) }
      }),
      leagueTables: b.leagueTables ?? [],
      teamAliases: b.teamAliases ?? [],
      picks: b.picks,
      shared: b.sharedPicks ?? [],
    })
    const realText = JSON.stringify(real)

    dates.forEach((date, d) => {
      const analysis = analyzeDay(b.matches.filter((m) => m.date === date), b.thresholds, 'percent', limit)
      for (const [c, category] of CATEGORIES.entries()) {
        const expected = analysis[category.id].predictions.map((p) => [p.match.home, p.match.away, p.percent, p.stars, p.reliability.level])
        const actual = real.days[d].lists[c].items.map((i) => [real.days[d].matches[i.match].home, real.days[d].matches[i.match].away, i.percent, i.stars, i.reliability])
        expect(actual).toEqual(expected)
      }
    })

    const { keys, numbers } = collect(real)
    for (const key of keys) expect(ALLOWED_KEYS.has(key), `izinli olmayan anahtar: ${key}`).toBe(true)
    const inPayload = new Set(numbers)
    let checked = 0
    for (const match of b.matches) {
      expect(realText).not.toContain(match.id)
      for (const [key, value] of Object.entries(match.stats)) {
        if (key.length > 6) expect(realText, `alan: ${key}`).not.toContain(key)
        // İki ve daha çok ondalıklı her ham sayı (oran, xG, ortalama) ve uzun metinler (bağlantı)
        if (typeof value === 'number' && !Number.isInteger(value * 10)) {
          expect(inPayload.has(value), `ham sayı: ${key}=${value}`).toBe(false)
          expect(realText, `ham sayı: ${key}=${value}`).not.toContain(`:${value},`)
          checked++
        }
        // Kimlik metinleri (takım, lig, ülke) pakete girer; onların dışındaki uzun metinler (bağlantı) girmez.
        if (typeof value === 'string' && value.length >= 16 && !IDENTITY_FIELDS.includes(key)) expect(realText, `ham metin: ${key}`).not.toContain(value)
      }
    }
    for (const verdict of b.aiVerdicts ?? []) for (const s of [verdict.reason, verdict.risk]) if (s.length >= 12) expect(realText).not.toContain(s)
    expect(realText).not.toMatch(/footystats|https?:/i)
    expect(checked).toBeGreaterThan(1000)

    if (process.env.UYE_OUT) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(process.env.UYE_OUT, JSON.stringify(real, null, 1) + '\n')
      writeFileSync(`${process.env.UYE_OUT}.boyut.txt`, `düz JSON: ${Buffer.byteLength(realText)} bayt\ngünler: ${dates.join(', ')}\nlistelenen öneri: ${real.days.map((x) => x.lists.reduce((s, l) => s + l.items.length, 0)).join(' + ')}\nmaç: ${real.days.map((x) => x.matches.length).join(' + ')}\n`)
    }
  })
})

// PREVIOUS_DAY yalnızca girdide ikinci günün bulunduğunu belgelemek için kullanılır.
it('veride iki gün vardır', () => expect(payload.days.map((d) => d.date)).toEqual([DAY, PREVIOUS_DAY]))

describe('yayın paketi: "AI öneri güveni" satırı', () => {
  const copy = (): MemberPayload => JSON.parse(text) as MemberPayload
  const rejects = (change: (p: MemberPayload) => void) => {
    const p = copy()
    change(p)
    expect(() => assertMemberPayload(p)).toThrow(MemberPayloadError)
  }
  const matchOf = (p: MemberPayload, home: string) => p.days[0].matches.find((m) => m.home === home)!
  const withAi = (p: MemberPayload) => matchOf(p, 'Kuzey Yıldızı').ai!

  it('dört örnek: 3/3 Orta ve 2/3 Güçlü + 1 Zayıf gider; 2/3 Zayıf ve 2 Orta + 1 Eleme gitmez', () => {
    // Dört maç da pakette (listelerde) duruyor: değişen yalnızca satırın varlığı.
    for (const home of ['Kuzey Yıldızı', 'Doğu Gençlik', 'İç Anadolu FK', 'Ova Belediyespor']) expect(matchOf(payload, home), home).toBeDefined()
    expect(matchOf(payload, 'Kuzey Yıldızı').ai).toEqual({ votes: [{ who: 'chatgpt', level: 'medium' }, { who: 'gemini', level: 'medium' }, { who: 'claude', level: 'medium' }], count: 3, level: 'medium' })
    expect(matchOf(payload, 'Doğu Gençlik').ai).toEqual({ votes: [{ who: 'chatgpt', level: 'strong' }, { who: 'gemini', level: 'weak' }, { who: 'claude', level: 'strong' }], count: 2, level: 'strong' })
    expect('ai' in matchOf(payload, 'İç Anadolu FK')).toBe(false)
    expect('ai' in matchOf(payload, 'Ova Belediyespor')).toBe(false)
    expect(payload.days.flatMap((d) => d.matches).filter((m) => m.ai).length).toBe(2)
  })

  it('gerekçe, risk, skor tahmini ve kayıt zamanı pakette yok', () => {
    expect(AI_VERDICTS.every((v) => v.reason.includes(AI_REASON_CANARY) && v.risk.includes(AI_RISK_CANARY) && v.score?.home === 7)).toBe(true)
    for (const canary of [AI_REASON_CANARY, AI_RISK_CANARY, AI_SAVED_AT, '7-6', '"score":{']) expect(text).not.toContain(canary)
    // Satırdaki tek veriler: kim, hangi seviye, kaç oy.
    const { strings, numbers } = collect(payload.days.flatMap((d) => d.matches.flatMap((m) => (m.ai ? [m.ai] : []))))
    expect([...new Set(strings)].sort()).toEqual(['chatgpt', 'claude', 'gemini', 'medium', 'strong', 'weak'])
    expect([...new Set(numbers)].sort()).toEqual([2, 3])
  })

  it('satır olmayan maçın kaydı, satır olan maçınkiyle aynı anahtarları taşır (yalnızca ai eksik)', () => {
    expect(Object.keys(matchOf(payload, 'İç Anadolu FK'))).toEqual([...MEMBER_KEYS.match])
    expect(Object.keys(matchOf(payload, 'Kuzey Yıldızı'))).toEqual([...MEMBER_KEYS.match, 'ai'])
  })

  it('kararlar verilmezse paket satırsız kurulur; diğer her şey aynıdır', () => {
    const without = buildMemberPayload(memberInput({ days: memberInput().days.map((d) => ({ date: d.date, matches: d.matches, results: d.results, highlights: d.highlights })) }))
    expect(without.days.flatMap((d) => d.matches).some((m) => 'ai' in m)).toBe(false)
    const stripped = copy()
    for (const d of stripped.days) for (const m of d.matches) delete m.ai
    expect(without).toEqual(stripped)
  })

  it('listelerde geçmeyen maçın satırı pakete girmez ve gönderildi sayılmaz', () => {
    const ghost = { matchId: 'listede-olmayan-mac', ai: withAi(payload) }
    const built = buildMemberPublication(memberInput({ days: memberInput().days.map((d, i) => (i === 0 ? { ...d, ai: [...(d.ai ?? []), ghost] } : d)) }))
    expect(JSON.stringify(built.payload)).toBe(text)
    expect(built.aiMatchIds).toHaveLength(2)
    expect(built.aiMatchIds).not.toContain('listede-olmayan-mac')
  })

  it('şema: tutarsız ya da kural dışı satır reddedilir', () => {
    rejects((p) => void (withAi(p).count = 2)) // oylarla tutmuyor
    rejects((p) => void ((withAi(p) as { level: string }).level = 'weak')) // çoğunluk Zayıf olamaz
    rejects((p) => void ((withAi(p).votes[1] as { level: string }).level = 'reject')) // Eleme oyu olamaz
    rejects((p) => void withAi(p).votes.pop()) // üç karar şart
    rejects((p) => void withAi(p).votes.reverse()) // sabit sıra
    rejects((p) => void ((withAi(p).votes[0] as { who: string }).who = 'baska'))
    rejects((p) => void ((withAi(p) as unknown as Record<string, unknown>).reason = 'gerekçe'))
    rejects((p) => void ((withAi(p).votes[0] as unknown as Record<string, unknown>).score = '2-1'))
    rejects((p) => void (matchOf(p, 'Kuzey Yıldızı').time = null)) // saati bilinmeyen maçta satır olamaz
    // 2 Orta + 1 Zayıf geçerlidir; 1 Orta + 2 Zayıf (çoğunluk Zayıf) geçersizdir.
    const ok = copy()
    withAi(ok).votes[2].level = 'weak'
    withAi(ok).count = 2
    expect(() => assertMemberPayload(ok)).not.toThrow()
    rejects((p) => {
      withAi(p).votes[1].level = 'weak'
      withAi(p).votes[2].level = 'weak'
      withAi(p).count = 1
    })
  })

  it('sürüm 5 pakette satır bulunamaz; satırsız sürüm 5 paket hâlâ açılır', () => {
    rejects((p) => void ((p as { v: number }).v = 5))
    const v5 = copy()
    ;(v5 as { v: number }).v = 5
    for (const d of v5.days) for (const m of d.matches) delete m.ai
    expect(() => assertMemberPayload(v5)).not.toThrow()
  })

  it('üye sitesindeki sabitler admin tarafındaki yapay zekâ ayarlarıyla aynıdır', () => {
    expect([...MEMBER_AI_PROVIDERS]).toEqual(AI_PROVIDERS.map((p) => p.id))
    expect([...MEMBER_AI_VOTE_LEVELS]).toEqual(AI_DECISIONS.filter((d) => d.id !== 'reject').map((d) => d.id))
    expect([...MEMBER_AI_MAJORITY_LEVELS]).toEqual(AI_DECISIONS.filter((d) => d.approved).map((d) => d.id))
    for (const p of AI_PROVIDERS) expect(MEMBER_AI_PROVIDER_LABELS[p.id]).toBe(p.label)
    for (const level of MEMBER_AI_VOTE_LEVELS) expect(MEMBER_AI_LEVEL_LABELS[level]).toBe(decisionLabel(level))
    expect(memberAiSummary(withAi(payload))).toBe('3/3 · Orta')
    expect(memberAiSummary(matchOf(payload, 'Doğu Gençlik').ai!)).toBe('2/3 · Güçlü')
  })
})
