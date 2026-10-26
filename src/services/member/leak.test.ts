import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AiVerdict, BackupFile, Match } from '../../types'
import { toAppDateTime } from '../../utils/date'
import { shiftDate } from '../../utils/format'
import { memberNoteInputs } from '../notes/matchNote'
import { scanForLeaks } from '../memberAdmin/leakScan'
import { aiInputsOf, highlightInputOf, PUBLISH_DAY_COUNT, streakInputOf } from '../memberAdmin/publish'
import { analyzeDay } from '../analysis/engine'
import { MARKET_CATEGORY_IDS } from '../analysis/market'
import { estimateSampleSize, levelForSample, RELIABILITY_LIMITS } from '../analysis/reliability'
import { CATEGORIES, getCategory } from '../../config/categories'
import { TEXT_FIELDS } from '../../config/columnAliases'
import { isBackupFile } from '../data/backupFormat'
import { AI_REASON_CANARY, AI_RISK_CANARY, AI_SAVED_AT, AI_VERDICTS, dayVerdicts, DAY, dayHighlights, dayMatches, dayNotes, HIGHLIGHT_PERCENT, HIGHLIGHTS, MATCHES, memberInput, NOTE_HIDDEN_CANARY, NOTE_HIDDEN_IMAGE, NOTE_IMAGE, NOTE_UPDATED_AT, NOTES, PICKS, PREVIOUS_DAY, RAW_CANARIES, RAW_HEADERS, RAW_STAT_KEYS, RESULTS, STREAK_ADDED_AT, STREAK_INPUT, STREAK_STEPS, streakView, URL_CANARY } from './__fixtures__/rawData'
import { AI_CATEGORY_IDS, AI_DECISIONS, AI_PROVIDERS, decisionLabel } from '../../config/ai'
import { MEMBER_AI_LEVEL_LABELS, MEMBER_AI_PROVIDER_LABELS, memberAiSummary, memberAiTitle } from './labels'
import { buildMemberPayload, buildMemberPublication, MEMBER_PAYLOAD_VERSION, type MemberPayload, type MemberPayloadInput, type MemberStreak } from './payload'
import { MEMBER_AI_CATEGORIES, MEMBER_MARKET_CATEGORIES, MEMBER_AI_MAJORITY_LEVELS, MEMBER_AI_PROVIDERS, MEMBER_AI_VOTE_LEVELS, assertMemberPayload, MEMBER_KEYS, MEMBER_STREAK_LIMITS, MemberPayloadError, SAMPLE_LEVEL_LIMITS, SAMPLE_RANGE } from './schema'

/** Sürüm 13'ten eski paket: maçlarda not (note) alanı yoktur */
const withoutNote = (p: MemberPayload): void => {
  for (const d of p.days) for (const m of d.matches) delete m.note
}

/** Sürüm 11'den eski paket: önerilerde piyasa yüzdesi (mkt) alanı, dolayısıyla sürüm 13'teki not da yoktur */
const withoutMkt = (p: MemberPayload): void => {
  for (const d of p.days) for (const l of d.lists) for (const i of l.items) delete i.mkt
  withoutNote(p)
}

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
  'seq',
  'addedAt',
  'removed',
  'lastOutcome',
  'revisedAt',
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
      payload: ['v', 'n', 'publishedAt', 'texts', 'days', 'statistics', 'streak'],
      payloadV7: ['v', 'n', 'publishedAt', 'texts', 'days', 'statistics'],
      streak: ['status', 'steps', 'past', 'totals'],
      streakStep: ['date', 'home', 'away', 'league', 'time', 'categoryId', 'state', 'step'],
      streakRun: ['length', 'ended', 'last'],
      streakLast: ['home', 'away', 'league', 'categoryId'],
      streakTotals: ['longest', 'current', 'count', 'mean', 'won', 'lost', 'lowSample'],
      texts: ['disclaimer', 'account'],
      day: ['date', 'matches', 'lists', 'highlights'],
      dayV3: ['date', 'matches', 'lists'],
      highlight: ['home', 'away', 'league', 'time', 'categoryId', 'status', 'score', 'outcome'],
      match: ['home', 'away', 'league', 'time', 'status', 'score', 'homeStanding', 'awayStanding'],
      matchOptionalV9: ['homeForm', 'awayForm'],
      matchOptionalV13: ['homeForm', 'awayForm', 'note'],
      noteOptional: ['text', 'image'],
      noteImage: ['src', 'w', 'h'],
      form: ['last', 'gf', 'ga', 'cs'],
      matchOptional: ['ai'],
      ai: ['votes', 'count', 'level'],
      aiVote: ['who', 'level'],
      standing: ['rank', 'played', 'stale'],
      list: ['categoryId', 'items'],
      item: ['match', 'percent', 'model', 'conflict', 'stars', 'reliability', 'outcome', 'detail', 'others'],
      itemOptional: ['sample'],
      itemOptionalV7: ['sample', 'ai'],
      itemOptionalV11: ['sample', 'ai', 'mkt'],
      itemV1: ['match', 'percent', 'model', 'conflict', 'stars', 'reliability', 'outcome', 'detail'],
      other: ['categoryId', 'percent', 'reliability'],
      statsRoot: ['all', 'shared'],
      stats: ['main', 'overall', 'matches', 'byCategory', 'byReliability', 'daily', 'weekly', 'monthly', 'stars', 'htScoreless'],
      statsV9: ['main', 'overall', 'matches', 'byCategory', 'byReliability', 'daily', 'weekly', 'monthly', 'stars'],
      statsV2: ['overall', 'matches', 'byCategory', 'byReliability', 'daily', 'weekly', 'monthly', 'stars'],
      main: ['categories', 'overall', 'matches'],
      statsMatches: ['total', 'decided'],
      bucket: ['key', 'tally'],
      tally: ['won', 'lost', 'void', 'pending', 'decided', 'total', 'rate', 'lowSample'],
      stars: ['byStars', 'byCategory', 'recomputed', 'missing'],
      starsCategory: ['key', 'byStars'],
      htScoreless: ['n', 'over'],
    })
  })
})

describe('yayın paketi: şema denetimi fazladan ya da eksik alanı reddeder', () => {
  // Her nesneyi tek tek değiştiren bu testler küçük bir paketle çalışır (iki maç); paket yine
  // her tür nesneyi içerir: maç, lig sırası, liste, öneri, diğer öneriler, istatistik dökümleri.
  const small = buildMemberPayload(memberInput({ days: [{ date: DAY, matches: dayMatches(DAY).filter((m) => ['Kuzey Yıldızı', 'Doğu Gençlik'].includes(m.home)), results: RESULTS, ai: aiInputsOf(dayMatches(DAY), dayVerdicts(DAY)).inputs, notes: memberNoteInputs(dayNotes(DAY)) }] }))
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
      // Notun iki alanı da isteğe bağlıdır (en az biri bulunur): notta ikisi birden silinir.
      const keys = Object.keys(node)
      const isNote = keys.length > 0 && keys.every((k) => (MEMBER_KEYS.noteOptional as readonly string[]).includes(k))
      for (const key of isNote ? keys : [keys[0]]) delete node[key]
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
    expect(broken((p) => void ((p as { v: number }).v = 14))).toThrow(MemberPayloadError)
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
    expect(payload.v).toBe(13)
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
    withoutMkt(v1)
    delete v1.streak
    for (const d of v1.days) for (const m of d.matches) { delete m.homeForm; delete m.awayForm }
    for (const scope of ['all', 'shared'] as const) delete v1.statistics[scope].htScoreless
    for (const scope of ['all', 'shared'] as const) delete v1.statistics[scope].main
    for (const day of v1.days) for (const list of day.lists) for (const item of list.items) delete item.others
    for (const day of v1.days) for (const list of day.lists) for (const item of list.items) delete item.sample
    for (const day of v1.days) delete day.highlights
    for (const day of v1.days) for (const list of day.lists) for (const item of list.items) delete item.ai
    expect(() => assertMemberPayload(v1)).not.toThrow()
    // Sürüm 1 pakette bu alan bulunamaz; sürüm 2 pakette bulunmak zorundadır.
    expect(rejects((p) => void ((p as { v: number }).v = 1))).toThrow(MemberPayloadError)
    const v2 = JSON.parse(JSON.stringify(v1)) as MemberPayload
    ;(v2 as { v: number }).v = 2
    withoutMkt(v2)
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
    withoutMkt(v2)
    delete v2.streak
    for (const d of v2.days) for (const m of d.matches) { delete m.homeForm; delete m.awayForm }
    for (const scope of ['all', 'shared'] as const) delete v2.statistics[scope].htScoreless
    for (const scope of ['all', 'shared'] as const) delete v2.statistics[scope].main
    for (const day of v2.days) delete day.highlights
    for (const day of v2.days) for (const list of day.lists) for (const item of list.items) delete item.sample
    for (const day of v2.days) for (const list of day.lists) for (const item of list.items) delete item.ai
    expect(() => assertMemberPayload(v2)).not.toThrow()
    // Sürüm 2 pakette bu alan bulunamaz; sürüm 3 pakette bulunmak zorundadır.
    expect(rejects((p) => void ((p as { v: number }).v = 2))).toThrow(MemberPayloadError)
    const v3 = JSON.parse(JSON.stringify(v2)) as MemberPayload
    ;(v3 as { v: number }).v = 3
    withoutMkt(v3)
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
    withoutMkt(v3)
    delete v3.streak
    for (const d of v3.days) for (const m of d.matches) { delete m.homeForm; delete m.awayForm }
    for (const scope of ['all', 'shared'] as const) delete v3.statistics[scope].htScoreless
    for (const day of v3.days) delete day.highlights
    for (const day of v3.days) for (const list of day.lists) for (const item of list.items) delete item.sample
    for (const day of v3.days) for (const list of day.lists) for (const item of list.items) delete item.ai
    expect(() => assertMemberPayload(v3)).not.toThrow()
    // Sürüm 3 pakette bu alan bulunamaz; sürüm 4 pakette bulunmak zorundadır.
    expect(rejects((p) => void ((p as { v: number }).v = 3))).toThrow(MemberPayloadError)
    const v4 = JSON.parse(JSON.stringify(v3)) as MemberPayload
    ;(v4 as { v: number }).v = 4
    withoutMkt(v4)
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
    withoutMkt(v4)
    delete v4.streak
    for (const d of v4.days) for (const m of d.matches) { delete m.homeForm; delete m.awayForm }
    for (const scope of ['all', 'shared'] as const) delete v4.statistics[scope].htScoreless
    for (const day of v4.days) for (const list of day.lists) for (const item of list.items) delete item.sample
    for (const day of v4.days) for (const list of day.lists) for (const item of list.items) delete item.ai
    expect(() => assertMemberPayload(v4)).not.toThrow()
    expect(
      rejects((p) => {
        ;(p as { v: number }).v = 4
        delete p.streak
        for (const d of p.days) for (const m of d.matches) { delete m.homeForm; delete m.awayForm }
        for (const scope of ['all', 'shared'] as const) delete p.statistics[scope].htScoreless
        for (const day of p.days) for (const list of day.lists) for (const item of list.items) delete item.ai
        withoutMkt(p)
      }),
    ).toThrow('izinli olmayan alan: sample')
    // Sürüm 5 pakette alan zorunlu değildir (sayı çıkarılamayan öneriler).
    const v5 = JSON.parse(JSON.stringify(v4)) as MemberPayload
    ;(v5 as { v: number }).v = 5
    withoutMkt(v5)
    expect(() => assertMemberPayload(v5)).not.toThrow()
  })
})

describe('yayın paketi: yalnızca izinli girdilere bağlıdır', () => {
  const withMatches = (change: (match: Match) => Match): MemberPayloadInput => {
    const input = memberInput()
    return { ...input, days: input.days.map((d) => ({ ...d, matches: d.matches.map(change) })) }
  }
  const build = (input: MemberPayloadInput) => JSON.stringify(buildMemberPayload(input))

  it('piyasa oranları değişince yalnızca mkt alanları değişir; mkt çıkarılınca paket bayt bayt aynıdır; çelişki sınırı paketi hiç değiştirmez', () => {
    // Yalnızca piyasa yüzdesine giren oranlar: analizde başka hiçbir yerde kullanılmaz.
    const marketOnly = ['Odds_Over35', 'Odds_Under35', 'Odds_Over45', 'Odds_Under45', 'Odds_BTTS_Yes', 'Odds_BTTS_No', 'Odds_1st_Half_Over05', 'Odds_1st_Half_Under05', 'Odds_1st_Half_Over15', 'Odds_1st_Half_Under15', 'Odds_2nd_Half_Over05', 'Odds_2nd_Half_Under05', 'Odds_Corners_Over85', 'Odds_Corners_Under85', 'Odds_Corners_Over95', 'Odds_Corners_Under95', 'Odds_Corners_Over105', 'Odds_Corners_Under105']
    const changed = withMatches((m) => ({ ...m, stats: { ...m.stats, ...Object.fromEntries(marketOnly.map((key, i) => [key, i % 2 === 0 ? 1.05 : 15])) } }))
    // Değişiklik gerçekten piyasa yüzdesini oynatıyor…
    const before = analyzeDay(dayMatches(DAY), memberInput().thresholds, 'percent', 25).btts.predictions.map((p) => p.market?.percent)
    const after = analyzeDay(changed.days[0].matches, changed.thresholds, 'percent', 25).btts.predictions.map((p) => p.market?.percent)
    expect(after).not.toEqual(before)
    // …paketteki mkt alanları değişiyor…
    const original = JSON.parse(text) as MemberPayload
    const next = buildMemberPayload(changed)
    const mkts = (p: MemberPayload) => p.days.flatMap((d) => d.lists.flatMap((l) => l.items.map((i) => i.mkt)))
    expect(mkts(next)).not.toEqual(mkts(original))
    // …ama mkt çıkarılınca paket bayt bayt aynı kalıyor (oran, çelişki ya da başka bir iz yok).
    withoutMkt(original)
    withoutMkt(next)
    expect(JSON.stringify(next)).toBe(JSON.stringify(original))
    // Piyasa çelişkisi pakete girmez: sınır değişince paket hiç değişmez.
    expect(build({ ...memberInput(), marketConflictLimit: 1 })).toBe(text)
    expect(build({ ...memberInput(), marketConflictLimit: 100 })).toBe(text)
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
    // Gerçek yedekte binlerce ham değer taranır; varsayılan 5 sn yetmez.
  }, 300_000)
})

// PREVIOUS_DAY yalnızca girdide ikinci günün bulunduğunu belgelemek için kullanılır.
it('veride iki gün vardır', () => expect(payload.days.map((d) => d.date)).toEqual([DAY, PREVIOUS_DAY]))

describe('yayın paketi: "AI öneri güveni" satırı (kategori bazlı)', () => {
  const copy = (): MemberPayload => JSON.parse(text) as MemberPayload
  const rejects = (change: (p: MemberPayload) => void) => {
    const p = copy()
    change(p)
    expect(() => assertMemberPayload(p)).toThrow(MemberPayloadError)
  }
  type Category = (typeof CATEGORIES)[number]['id']
  /** Maçın o listedeki önerisi; listede yoksa undefined */
  const itemOf = (p: MemberPayload, home: string, categoryId: Category) => {
    const day = p.days[0]
    return day.lists.find((l) => l.categoryId === categoryId)!.items.find((i) => day.matches[i.match].home === home)
  }
  const aiOf = (p: MemberPayload, home: string, categoryId: Category) => itemOf(p, home, categoryId)!.ai
  const allAi = (p: MemberPayload) => p.days.flatMap((d) => d.lists.flatMap((l) => l.items.flatMap((i) => (i.ai ? [{ list: l.categoryId, home: d.matches[i.match].home, ai: i.ai }] : []))))
  const votes = (...levels: string[]) => levels.map((level, i) => ({ who: ['chatgpt', 'gemini', 'claude'][i], level }))

  it('örnek maç: 2.5 ÜST 3/3 Orta ve KG VAR 2/3 Orta gider; İLK YARI 0.5 ÜST (2 Zayıf + 1 Orta) gitmez', () => {
    for (const id of ['over25', 'btts', 'ht05'] as const) expect(itemOf(payload, 'Kuzey Yıldızı', id), id).toBeDefined()
    expect(aiOf(payload, 'Kuzey Yıldızı', 'over25')).toEqual({ votes: votes('medium', 'medium', 'medium'), count: 3, level: 'medium' })
    expect(aiOf(payload, 'Kuzey Yıldızı', 'btts')).toEqual({ votes: votes('medium', 'medium', 'weak'), count: 2, level: 'medium' })
    expect('ai' in itemOf(payload, 'Kuzey Yıldızı', 'ht05')!).toBe(false)
  })

  it('bir kategoride 2 Güçlü + 1 Eleme: o kategoride satır yok, aynı maçın diğer kategorisi etkilenmez', () => {
    expect('ai' in itemOf(payload, 'Doğu Gençlik', 'over25')!).toBe(false)
    expect(aiOf(payload, 'Doğu Gençlik', 'btts')).toEqual({ votes: votes('strong', 'strong', 'strong'), count: 3, level: 'strong' })
  })

  it('bir yapay zekâ kategoriyi atladıysa o kategori gitmez; cevapladığı kategori gider', () => {
    expect('ai' in itemOf(payload, 'İç Anadolu FK', 'over25')!).toBe(false)
    expect(aiOf(payload, 'İç Anadolu FK', 'ht05')).toMatchObject({ count: 3, level: 'medium' })
  })

  it('eski maç geneli karar (3/3 Orta) hiçbir kategoride gitmez ve kategori kararına çevrilmez', () => {
    expect(AI_VERDICTS.filter((v) => v.decision !== undefined && v.byCategory === undefined)).toHaveLength(3)
    expect(allAi(payload).some((row) => row.home === 'Ova Belediyespor')).toBe(false)
  })

  it('satır yalnızca karar istenen dört listede, yalnızca kendi kategorisinin kartında; maçta hiç yok', () => {
    expect(allAi(payload).map((row) => `${row.home}|${row.list}`).sort()).toEqual(['Doğu Gençlik|btts', 'Kuzey Yıldızı|btts', 'Kuzey Yıldızı|over25', 'İç Anadolu FK|ht05'].sort())
    expect([...MEMBER_AI_CATEGORIES]).toEqual([...AI_CATEGORY_IDS])
    expect(payload.days.flatMap((d) => d.matches).some((m) => 'ai' in m)).toBe(false)
    // Aynı maçın diğer listelerdeki (2. yarı, korner…) kartlarında satır yok.
    const kuzey = payload.days[0].lists.filter((l) => l.items.some((i) => payload.days[0].matches[i.match].home === 'Kuzey Yıldızı'))
    expect(kuzey.length).toBeGreaterThan(4)
    expect(kuzey.filter((l) => l.items.some((i) => payload.days[0].matches[i.match].home === 'Kuzey Yıldızı' && i.ai)).map((l) => l.categoryId)).toEqual(['over25', 'btts'])
  })

  it('gerekçe, risk, skor tahmini ve kayıt zamanı pakette yok', () => {
    expect(AI_VERDICTS.every((v) => v.reason.includes(AI_REASON_CANARY) && v.risk.includes(AI_RISK_CANARY) && v.score?.home === 7)).toBe(true)
    for (const canary of [AI_REASON_CANARY, AI_RISK_CANARY, AI_SAVED_AT, '7-6', '"score":{', '"asked"', 'reject']) expect(text).not.toContain(canary)
    // Satırdaki tek veriler: kim, hangi seviye, kaç oy.
    const { strings, numbers } = collect(allAi(payload).map((row) => row.ai))
    expect([...new Set(strings)].sort()).toEqual(['chatgpt', 'claude', 'gemini', 'medium', 'strong', 'weak'])
    expect([...new Set(numbers)].sort()).toEqual([2, 3])
  })

  it('kararlar verilmezse paket satırsız kurulur; diğer her şey aynıdır', () => {
    const without = buildMemberPayload(memberInput({ days: memberInput().days.map((d) => ({ date: d.date, matches: d.matches, results: d.results, highlights: d.highlights, notes: d.notes })) }))
    expect(allAi(without)).toEqual([])
    const stripped = copy()
    for (const d of stripped.days) for (const l of d.lists) for (const i of l.items) delete i.ai
    expect(without).toEqual(stripped)
  })

  it('pakette karşılığı olmayan satır (listede olmayan maç, karar istenmeyen liste) girmez ve gönderildi sayılmaz', () => {
    const row = aiOf(payload, 'Kuzey Yıldızı', 'over25')!
    const kuzeyId = MATCHES.find((m) => m.home === 'Kuzey Yıldızı')!.id
    const extra = [
      { matchId: 'listede-olmayan-mac', categoryId: 'over25' as const, ai: row },
      { matchId: kuzeyId, categoryId: 'sh05' as const, ai: row },
    ]
    expect(() => buildMemberPublication(memberInput({ days: memberInput().days.map((d, i) => (i === 0 ? { ...d, ai: [...(d.ai ?? []), extra[0]] } : d)) }))).not.toThrow()
    const built = buildMemberPublication(memberInput({ days: memberInput().days.map((d, i) => (i === 0 ? { ...d, ai: [...(d.ai ?? []), extra[0]] } : d)) }))
    expect(JSON.stringify(built.payload)).toBe(text)
    expect(built.aiSent).toHaveLength(4)
    // Karar istenmeyen listeye satır verilirse şema paketi reddeder (kurucu sessizce yazmaz).
    expect(() => buildMemberPayload(memberInput({ days: memberInput().days.map((d, i) => (i === 0 ? { ...d, ai: [...(d.ai ?? []), extra[1]] } : d)) }))).toThrow('bu listede bulunamaz')
  })

  it('şema: tutarsız ya da kural dışı satır reddedilir', () => {
    const row = (p: MemberPayload) => aiOf(p, 'Kuzey Yıldızı', 'over25')!
    rejects((p) => void (row(p).count = 2)) // oylarla tutmuyor
    rejects((p) => void ((row(p) as { level: string }).level = 'weak')) // çoğunluk Zayıf olamaz
    rejects((p) => void ((row(p).votes[1] as { level: string }).level = 'reject')) // Eleme oyu olamaz
    rejects((p) => void row(p).votes.pop()) // üç karar şart
    rejects((p) => void row(p).votes.reverse()) // sabit sıra
    rejects((p) => void ((row(p).votes[0] as { who: string }).who = 'baska'))
    rejects((p) => void ((row(p) as unknown as Record<string, unknown>).reason = 'gerekçe'))
    rejects((p) => void ((row(p).votes[0] as unknown as Record<string, unknown>).score = '2-1'))
    rejects((p) => void (p.days[0].matches.find((m) => m.home === 'Kuzey Yıldızı')!.time = null)) // saati bilinmeyen maçta satır olamaz
    // Karar istenmeyen listede ve maçın kendisinde satır olamaz.
    rejects((p) => void (itemOf(p, 'Kuzey Yıldızı', 'sh05')!.ai = row(p)))
    rejects((p) => void (p.days[0].matches[0].ai = row(p)))
    // 2 Orta + 1 Zayıf geçerlidir; 1 Orta + 2 Zayıf (çoğunluk Zayıf) geçersizdir.
    const ok = copy()
    row(ok).votes[2].level = 'weak'
    row(ok).count = 2
    expect(() => assertMemberPayload(ok)).not.toThrow()
    rejects((p) => {
      row(p).votes[1].level = 'weak'
      row(p).votes[2].level = 'weak'
      row(p).count = 1
    })
  })

  it('sürüm 6 paket (satır maçta) hâlâ açılır; sürümler karıştırılamaz', () => {
    const v6 = copy()
    ;(v6 as { v: number }).v = 6
    withoutMkt(v6)
    delete v6.streak
    for (const d of v6.days) for (const m of d.matches) { delete m.homeForm; delete m.awayForm }
    for (const scope of ['all', 'shared'] as const) delete v6.statistics[scope].htScoreless
    const row = aiOf(v6, 'Kuzey Yıldızı', 'over25')!
    for (const d of v6.days) for (const l of d.lists) for (const i of l.items) delete i.ai
    v6.days[0].matches.find((m) => m.home === 'Kuzey Yıldızı')!.ai = row
    expect(() => assertMemberPayload(v6)).not.toThrow()
    // Sürüm 6'da satır öneride, sürüm 7'de maçta bulunamaz; sürüm 5'te hiç bulunamaz.
    rejects((p) => void ((p as { v: number }).v = 6))
    rejects((p) => void ((p as { v: number }).v = 5))
    const v5 = copy()
    ;(v5 as { v: number }).v = 5
    withoutMkt(v5)
    delete v5.streak
    for (const d of v5.days) for (const m of d.matches) { delete m.homeForm; delete m.awayForm }
    for (const scope of ['all', 'shared'] as const) delete v5.statistics[scope].htScoreless
    for (const d of v5.days) for (const l of d.lists) for (const i of l.items) delete i.ai
    expect(() => assertMemberPayload(v5)).not.toThrow()
  })

  it('üye sitesindeki sabitler admin tarafındaki yapay zekâ ayarlarıyla aynıdır', () => {
    expect([...MEMBER_AI_PROVIDERS]).toEqual(AI_PROVIDERS.map((p) => p.id))
    expect([...MEMBER_AI_VOTE_LEVELS]).toEqual(AI_DECISIONS.filter((d) => d.id !== 'reject').map((d) => d.id))
    expect([...MEMBER_AI_MAJORITY_LEVELS]).toEqual(AI_DECISIONS.filter((d) => d.approved).map((d) => d.id))
    for (const p of AI_PROVIDERS) expect(MEMBER_AI_PROVIDER_LABELS[p.id]).toBe(p.label)
    for (const level of MEMBER_AI_VOTE_LEVELS) expect(MEMBER_AI_LEVEL_LABELS[level]).toBe(decisionLabel(level))
    expect(memberAiSummary(aiOf(payload, 'Kuzey Yıldızı', 'over25')!)).toBe('3/3 · Orta')
    expect(memberAiSummary(aiOf(payload, 'Kuzey Yıldızı', 'btts')!)).toBe('2/3 · Orta')
    expect(AI_CATEGORY_IDS.map((id) => memberAiTitle(getCategory(id).label))).toEqual(['AI öneri güveni (2.5 Üst)', 'AI öneri güveni (İlk Yarı 0.5 Üst)', 'AI öneri güveni (KG Var)', 'AI öneri güveni (2.5 Üst & KG Var)'])
  })
})

describe('yayın paketi: seri takibi (sürüm 8)', () => {
  const copy = (): MemberPayload => JSON.parse(text) as MemberPayload
  const rejects = (change: (streak: MemberStreak, p: MemberPayload) => void) => {
    const p = copy()
    change(p.streak!, p)
    return () => assertMemberPayload(p)
  }
  const streak = payload.streak!

  it('aktif serinin adımları, geçmiş seriler ve sayılar; paket sürümü 13', () => {
    expect(MEMBER_PAYLOAD_VERSION).toBe(13)
    expect(payload.v).toBe(13)
    expect(streak).toEqual({
      status: 'active',
      steps: [
        { date: DAY, home: 'Kuzey Yıldızı', away: expect.any(String), league: expect.any(String), time: expect.stringMatching(/^\d{2}:\d{2}$/), categoryId: 'over25', state: 'won', step: 1 },
        { date: DAY, home: 'Ova Belediyespor', away: expect.any(String), league: expect.any(String), time: expect.any(String), categoryId: 'over25', state: 'unplayed', step: null },
        { date: DAY, home: 'İç Anadolu FK', away: expect.any(String), league: expect.any(String), time: expect.any(String), categoryId: 'over25', state: 'pending', step: 2 },
      ],
      past: [{ length: 1, ended: DAY, last: { home: 'Doğu Gençlik', away: expect.any(String), league: expect.any(String), categoryId: 'over25' } }],
      totals: { longest: 1, current: 1, count: 1, mean: 1, won: 2, lost: 1, lowSample: true },
    })
  })

  it('yalnızca izinli alanlar: yüzde, geçmiş veri, skor, AI kararı, kimlik, sıra ve eklenme zamanı pakete girmez', () => {
    const { keys, numbers, strings } = collect(streak)
    expect([...keys].sort()).toEqual([...new Set([...MEMBER_KEYS.streak, ...MEMBER_KEYS.streakStep, ...MEMBER_KEYS.streakRun, ...MEMBER_KEYS.streakLast, ...MEMBER_KEYS.streakTotals])].sort())
    const streakText = JSON.stringify(streak)
    for (const word of ['percent', 'reliability', 'score', 'outcome', 'ai', 'votes', 'matchId', 'seq', 'addedAt', 'publishedAt', 'removed', 'lastOutcome', 'revisedAt']) expect(streakText).not.toContain(`"${word}"`)
    expect(text).not.toContain(STREAK_ADDED_AT)
    expect(text).not.toContain(STREAK_ADDED_AT.slice(0, 19))
    for (const step of STREAK_STEPS) {
      expect(text).not.toContain(step.id)
      expect(text).not.toContain(step.matchId)
    }
    // Skor biçiminde metin ("MS 3-1") seri alanında yoktur; sayılar yalnızca adım numarası ve sayımlardır.
    for (const value of strings) expect(value).not.toMatch(/(İY|MS) \d|^\d{1,2}-\d{1,2}$/)
    expect(Math.max(...numbers)).toBeLessThanOrEqual(2)
  })

  it('seri güne bağlı değildir: paketteki günler değişse de aynıdır; verilmezse boş seri yazılır', () => {
    const today = buildMemberPayload(memberInput({ days: memberInput().days.slice(0, 1) }))
    expect(today.streak).toEqual(streak)
    const none = buildMemberPayload(memberInput({ streak: undefined }))
    expect(none.streak).toEqual({ status: 'idle', steps: [], past: [], totals: { longest: 0, current: 0, count: 0, mean: null, won: 0, lost: 0, lowSample: true } })
    expect({ ...none, streak: undefined }).toEqual({ ...payload, streak: undefined })
  })

  it('sınır: en fazla son 100 aktif adım ve en yeni 30 geçmiş seri girer; sayılar tam kalır', () => {
    const step = STREAK_INPUT.steps[0]
    const run = STREAK_INPUT.past[0]
    const long = buildMemberPayload(
      memberInput({
        streak: {
          status: 'active',
          steps: Array.from({ length: 130 }, (_, i) => ({ ...step, home: `Ev ${i + 1}`, state: 'won' as const, step: i + 1 })),
          past: Array.from({ length: 45 }, (_, i) => ({ ...run, length: i % 3 })),
          totals: { longest: 130, current: 130, count: 45, mean: 1, won: 175, lost: 45, lowSample: false },
        },
      }),
    )
    expect(MEMBER_STREAK_LIMITS).toEqual({ steps: 100, past: 30 })
    expect(long.streak!.steps.length).toBe(100)
    expect(long.streak!.steps[0].step).toBe(31)
    expect(long.streak!.steps[99].step).toBe(130)
    expect(long.streak!.past.length).toBe(30)
    expect(long.streak!.totals).toMatchObject({ current: 130, count: 45 })
  })

  it('paket kurucunun girdisi adım kayıtlarından alan alan indirgenir; maç silinmişse adlar kayıttan gelir', () => {
    const renamed = STREAK_STEPS.map((s) => ({ ...s, home: `Kayıt ${s.seq}` }))
    expect(streakInputOf(streakView(renamed), MATCHES).steps.map((s) => s.home)).toEqual(['Kuzey Yıldızı', 'Ova Belediyespor', 'İç Anadolu FK'])
    // Maç ve önerisi silinmiş: ad kayıttan, sonuç son görülen kesin sonuçtan.
    const withOutcome = renamed.map((s) => (s.seq === 3 ? { ...s, lastOutcome: 'won' as const } : s))
    const gone = streakInputOf(streakView(withOutcome, MATCHES.filter((m) => m.home !== 'Kuzey Yıldızı'), RESULTS.filter((r) => !r.matchId.includes('Kuzey Yıldızı')), PICKS.filter((p) => !p.matchId.includes('Kuzey Yıldızı'))), MATCHES.filter((m) => m.home !== 'Kuzey Yıldızı'))
    expect(gone.steps[0]).toMatchObject({ home: 'Kayıt 3', state: 'won', step: 1 })
    expect(gone.totals).toEqual(STREAK_INPUT.totals)
  })

  it('şema: fazladan alan, bozuk değer ve tutarsız sayı reddedilir', () => {
    expect(() => assertMemberPayload(copy())).not.toThrow()
    expect(rejects((s) => void ((s.steps[0] as unknown as Record<string, unknown>).percent = 82))).toThrow('izinli olmayan alan: percent')
    expect(rejects((s) => void ((s.steps[0] as unknown as Record<string, unknown>).score = 'MS 3-1'))).toThrow('izinli olmayan alan: score')
    expect(rejects((s) => void ((s as unknown as Record<string, unknown>).addedAt = STREAK_ADDED_AT))).toThrow('izinli olmayan alan: addedAt')
    expect(rejects((s) => void ((s.past[0].last as unknown as Record<string, unknown>).time = '20:00'))).toThrow(MemberPayloadError)
    // Aktif seride tutmayan adım bulunamaz; durum serbest metin değildir.
    expect(rejects((s) => void (s.steps[0].state = 'lost'))).toThrow(MemberPayloadError)
    expect(rejects((s) => void ((s.steps[0] as { state: string }).state = 'kazandı'))).toThrow(MemberPayloadError)
    expect(rejects((s) => void (s.steps[0].time = '8:00'))).toThrow(MemberPayloadError)
    expect(rejects((s) => void (s.steps[0].date = '05.10.2026'))).toThrow(MemberPayloadError)
    expect(rejects((s) => void ((s.steps[0] as { categoryId: string }).categoryId = 'yok'))).toThrow(MemberPayloadError)
    // Adım numaraları ardışıktır; kaldırılan adımın numarası yoktur.
    expect(rejects((s) => void (s.steps[2].step = 5))).toThrow('adım numaraları ardışık olmalı')
    expect(rejects((s) => void (s.steps[1].step = 2))).toThrow('seriden kaldırılan adımın numarası olamaz')
    expect(rejects((s) => void (s.steps[0].step = null))).toThrow(MemberPayloadError)
    // Sayılar birbiriyle ve adımlarla tutarlıdır.
    expect(rejects((s) => void (s.status = 'idle'))).toThrow('adımlarla tutarlı olmalı')
    expect(rejects((s) => void (s.totals.lost = 0))).toThrow('biten seri sayısına eşit olmalı')
    expect(rejects((s) => void (s.totals.lowSample = false))).toThrow('biten seri sayısıyla tutarlı olmalı')
    expect(rejects((s) => void (s.totals.mean = 3.5))).toThrow('sayılarla tutarlı olmalı')
    expect(rejects((s) => void (s.totals.mean = null))).toThrow('sayılarla tutarlı olmalı')
    expect(rejects((s) => void (s.totals.current = 0))).toThrow(MemberPayloadError)
    expect(rejects((s) => void (s.totals.longest = 0))).toThrow(MemberPayloadError)
    expect(rejects((s) => void (s.past[0].length = 9))).toThrow(MemberPayloadError)
    expect(rejects((s) => void s.past.push(s.past[0]))).toThrow('biten seri sayısından fazla olamaz')
    expect(rejects((s) => void (s.steps = Array.from({ length: 101 }, () => s.steps[1])))).toThrow('en fazla 100 öğe olabilir')
  })

  it('sürüm 7 paket (bu alan olmadan) hâlâ açılır; sürümler karıştırılamaz', () => {
    const v7 = copy()
    ;(v7 as { v: number }).v = 7
    withoutMkt(v7)
    delete v7.streak
    for (const d of v7.days) for (const m of d.matches) { delete m.homeForm; delete m.awayForm }
    for (const scope of ['all', 'shared'] as const) delete v7.statistics[scope].htScoreless
    expect(() => assertMemberPayload(v7)).not.toThrow()
    // Sürüm 7 pakette alan bulunamaz; sürüm 8 pakette bulunmak zorundadır.
    expect(rejects((_, p) => void ((p as { v: number }).v = 7))).toThrow('izinli olmayan alan: streak')
    expect(rejects((_, p) => void delete p.streak)).toThrow('eksik alan: streak')
  })
})

describe('yayın paketi: geri çekilen seri adımı (sürüm 12)', () => {
  const WITHDRAWN_AT = '2026-10-05T06:41:09.000Z'
  // Bekleyen son adım (İç Anadolu FK) yayınlandı, sonra maç başlamadan geri çekildi.
  const withdrawn = STREAK_STEPS.map((s) => (s.seq === 5 ? { ...s, publishedAt: '2026-10-05T06:00:00.000Z', removed: { at: WITHDRAWN_AT, reason: 'withdrawn' as const } } : s))
  const build = (steps: typeof STREAK_STEPS) => buildMemberPayload(memberInput({ streak: streakInputOf(streakView(steps), MATCHES) }))
  const withdrawnPayload = build(withdrawn)
  const withdrawnText = JSON.stringify(withdrawnPayload)

  it('adım "geri çekildi" olarak kalır: numara almaz, bekleyen sayılmaz, sayılar değişmez', () => {
    const streak = withdrawnPayload.streak!
    expect(streak.steps.map((s) => [s.home, s.state, s.step])).toEqual([
      ['Kuzey Yıldızı', 'won', 1],
      ['Ova Belediyespor', 'unplayed', null],
      ['İç Anadolu FK', 'withdrawn', null],
    ])
    expect(streak.steps.some((s) => s.state === 'pending')).toBe(false)
    expect(streak.status).toBe('active')
    expect(streak.totals).toEqual(payload.streak!.totals)
    expect(() => assertMemberPayload(JSON.parse(withdrawnText))).not.toThrow()
  })

  it('serinin tek adımı geri çekilirse seri başlamış sayılmaz; adım listede kalır', () => {
    const only = build(withdrawn.filter((s) => s.seq !== 3 && s.seq !== 4)).streak!
    expect(only.status).toBe('idle')
    expect(only.steps).toEqual([expect.objectContaining({ home: 'İç Anadolu FK', state: 'withdrawn', step: null })])
    expect(only.totals).toMatchObject({ current: 0, count: 1 })
  })

  it('sızıntı yok: geri çekilme ve yayın anı, kayıt alanları pakete girmez', () => {
    for (const word of ['removed', 'publishedAt', 'withdrawnAt', 'at']) expect(JSON.stringify(withdrawnPayload.streak)).not.toContain(`"${word}"`)
    expect(withdrawnText).not.toContain(WITHDRAWN_AT)
    expect(withdrawnText).not.toContain(WITHDRAWN_AT.slice(0, 19))
    expect(withdrawnText).not.toContain('2026-10-05T06:00:00')
    expect(Object.keys(withdrawnPayload.streak!.steps[2])).toEqual([...MEMBER_KEYS.streakStep])
  })

  it('şema: "withdrawn" yalnızca sürüm 12 pakette geçerlidir ve numarası olamaz', () => {
    const copy = (): MemberPayload => JSON.parse(withdrawnText) as MemberPayload
    const v11 = copy()
    ;(v11 as { v: number }).v = 11
    withoutNote(v11)
    expect(() => assertMemberPayload(v11)).toThrow(MemberPayloadError)
    const numbered = copy()
    numbered.streak!.steps[2].step = 2
    expect(() => assertMemberPayload(numbered)).toThrow('seriden kaldırılan adımın numarası olamaz')
    // Geri çekilen adımı içermeyen sürüm 11 paket hâlâ açılır.
    const old = JSON.parse(text) as MemberPayload
    ;(old as { v: number }).v = 11
    withoutNote(old)
    expect(() => assertMemberPayload(old)).not.toThrow()
  })
})

describe('yayın paketi: lig tablosundan form, gol ve gol yemediği maç (sürüm 9)', () => {
  const copy = (): MemberPayload => JSON.parse(text) as MemberPayload
  const today = payload.days[0]
  const matchOf = (p: MemberPayload, home: string) => p.days[0].matches.find((m) => m.home === home)!
  const rejects = (change: (p: MemberPayload) => void) => {
    const p = copy()
    change(p)
    return () => assertMemberPayload(p)
  }

  it('doğrulanan maçta iki tarafın satırı; yalnızca dört alan', () => {
    const match = matchOf(payload, 'Kuzey Yıldızı')
    expect(match.homeForm).toEqual({ last: 'WWDWW', gf: 18, ga: 6, cs: 50 })
    expect(match.awayForm).toEqual({ last: 'LWDWL', gf: 10, ga: 9, cs: 29 })
    expect(MEMBER_KEYS.form).toEqual(['last', 'gf', 'ga', 'cs'])
    // Kuzey Yıldızı'nın notu da var (sürüm 13); not bu testin konusu değildir.
    const keysOf = (m: object) => Object.keys(m).filter((k) => k !== 'note')
    expect(keysOf(match)).toEqual([...MEMBER_KEYS.match, ...MEMBER_KEYS.matchOptionalV9])
    // Satır yalnızca doluyken yazılır: diğer maçlarda anahtar hiç yoktur (null da yazılmaz); başka tablo alanı da yoktur.
    for (const day of payload.days) for (const m of day.matches) if (m !== match) expect(keysOf(m)).toEqual(MEMBER_KEYS.match)
    expect(text).not.toMatch(/"(home|away)Form":null/)
  })

  it('tablo eski olabilir (PPG farklı), takım tabloda yok ya da tablo yok: anahtar hiç yazılmaz', () => {
    // Doğu Gençlik: CSV genel PPG 1.25, tablo 0.75. Batı Akademi tabloda yok. Sıra satırı da aynı kuralla düşer (null).
    const stale = matchOf(payload, 'Doğu Gençlik')
    expect(stale.homeStanding).toBeNull()
    expect(stale).not.toHaveProperty('homeForm')
    expect(stale).not.toHaveProperty('awayForm')
    // CSV'de genel PPG olmayan maçlar doğrulanamaz.
    expect(today.matches.filter((m) => m.homeForm || m.awayForm).map((m) => m.home)).toEqual(['Kuzey Yıldızı'])
    const none = buildMemberPayload(memberInput({ leagueTables: [], leagueTableSnapshots: [] }))
    for (const day of none.days) for (const m of day.matches) expect(Object.keys(m).filter((k) => k !== 'note')).toEqual(MEMBER_KEYS.match)
    expect(() => assertMemberPayload(none)).not.toThrow()
    // Tablosu olmayan sürüm 9 paket, sürüm numarası dışında sürüm 8 paketle aynı biçimdedir.
    expect(JSON.stringify(none)).not.toMatch(/Form/)
  })

  it('görüntü maçtan sonra yapıştırıldıysa ya da maçtan 7 günden eskiyse satır pakete girmez', () => {
    const [table] = memberInput().leagueTableSnapshots!
    const at = (pastedAt: string) => matchOf(buildMemberPayload(memberInput({ leagueTableSnapshots: [{ ...table, id: `${table.league}|${pastedAt}`, pastedAt }] })), 'Kuzey Yıldızı').homeForm
    expect(at('2026-10-05T08:59:00.000Z')).toBeDefined() // maç 09:00 UTC
    expect(at('2026-10-05T09:00:00.000Z')).toBeUndefined()
    expect(at('2026-10-06T08:00:00.000Z')).toBeUndefined()
    expect(at('2026-09-28T08:00:00.000Z')).toBeDefined() // tam 7 gün
    expect(at('2026-09-27T08:00:00.000Z')).toBeUndefined()
  })

  it('tablonun kalan sütunları pakette hiçbir biçimde yoktur', () => {
    const rows = memberInput().leagueTableSnapshots!.flatMap((s) => s.rows)
    expect(rows.length).toBeGreaterThan(0)
    const numbers = new Set<number>()
    const keys = new Set<string>()
    ;(function collect(value: unknown): void {
      if (typeof value === 'number') numbers.add(value)
      else if (Array.isArray(value)) value.forEach(collect)
      else if (typeof value === 'object' && value !== null)
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key)
          collect(inner)
        }
    })(payload)
    // Ayırt edici (ondalıklı) değerler: xGF, kart, korner, AVG ve PPG
    for (const row of rows) for (const value of [row.xgf, row.cards, row.corners, row.avgGoals, row.ppg]) if (typeof value === 'number' && !Number.isInteger(value * 10)) expect(numbers.has(value), `${row.team} ${value}`).toBe(false)
    // Tablo satırının alan adlarından hiçbiri paketin anahtarı değildir (form alanları kendi adlarıyla gider).
    // (rank, played: sıra satırının; won, lost: istatistik sayaçlarının; cs: form satırının kendi anahtarlarıdır.)
    for (const key of Object.keys(rows[0]).filter((k) => !['rank', 'played', 'won', 'lost', 'cs'].includes(k))) expect(keys.has(key), key).toBe(false)
    for (const key of ['blocked', 'pastedAt', 'lastSeenAt']) expect(keys.has(key), key).toBe(false)
    expect(Object.keys(rows[0])).toEqual(expect.arrayContaining(['ppg', 'btts', 'xgf', 'cards', 'corners', 'over15', 'over25', 'avgGoals', 'last5', 'goalsFor', 'goalsAgainst', 'cs']))
  })

  it('şema: fazla alan, eksik alan ve biçimi tutmayan değer reddedilir', () => {
    const form = (p: MemberPayload) => matchOf(p, 'Kuzey Yıldızı').homeForm as unknown as Record<string, unknown>
    expect(rejects((p) => void (form(p).btts = 63))).toThrow('izinli olmayan alan: btts')
    expect(rejects((p) => void (form(p).ppg = 2.5))).toThrow('izinli olmayan alan: ppg')
    expect(rejects((p) => void delete form(p).cs)).toThrow('eksik alan: cs')
    for (const bad of ['WWXWW', 'WWWWWW', '', 'ggbbm', 5]) expect(rejects((p) => void (form(p).last = bad)), String(bad)).toThrow(MemberPayloadError)
    for (const bad of [-1, 1.5, 1000, '6', null]) expect(rejects((p) => void (form(p).gf = bad)), String(bad)).toThrow(MemberPayloadError)
    for (const bad of [-1, 101, 12.5, '%50']) expect(rejects((p) => void (form(p).cs = bad)), String(bad)).toThrow(MemberPayloadError)
    // Form ve gol yememe yüzdesi boş olabilir.
    expect(rejects((p) => void Object.assign(form(p), { last: null, cs: null }))).not.toThrow()
    // Satırın kendisi isteğe bağlıdır: anahtar olmayabilir ama null olamaz.
    expect(rejects((p) => void delete matchOf(p, 'Kuzey Yıldızı').homeForm)).not.toThrow()
    expect(rejects((p) => void (delete matchOf(p, 'Kuzey Yıldızı').homeForm, delete matchOf(p, 'Kuzey Yıldızı').awayForm))).not.toThrow()
    expect(rejects((p) => void ((matchOf(p, 'Kuzey Yıldızı') as { homeForm: unknown }).homeForm = null))).toThrow(MemberPayloadError)
    expect(rejects((p) => void ((matchOf(p, 'Doğu Gençlik') as { awayForm: unknown }).awayForm = null))).toThrow(MemberPayloadError)
    // Satır herhangi bir maçta bulunabilir; biçimi yine denetlenir.
    expect(rejects((p) => void (matchOf(p, 'Doğu Gençlik').homeForm = { last: 'LLDDL', gf: 5, ga: 12, cs: 13 }))).not.toThrow()
    expect(rejects((p) => void ((matchOf(p, 'Doğu Gençlik') as { homeForm: unknown }).homeForm = { last: 'LLDDL', gf: 5, ga: 12 }))).toThrow('eksik alan: cs')
  })

  it('sürüm 8 paket (bu alanlar olmadan) hâlâ açılır; sürümler karıştırılamaz', () => {
    const v8 = copy()
    ;(v8 as { v: number }).v = 8
    withoutMkt(v8)
    for (const d of v8.days) for (const m of d.matches) { delete m.homeForm; delete m.awayForm }
    for (const scope of ['all', 'shared'] as const) delete v8.statistics[scope].htScoreless
    expect(() => assertMemberPayload(v8)).not.toThrow()
    for (const d of v8.days) for (const m of d.matches) expect(Object.keys(m)).toEqual(MEMBER_KEYS.match)
    // Sürüm 8 pakette alan bulunamaz; sürüm 9 pakette isteğe bağlıdır.
    expect(rejects((p) => void ((p as { v: number }).v = 8))).toThrow('izinli olmayan alan: homeForm, awayForm')
    expect(rejects((p) => void ((p as { v: number }).v = 14))).toThrow('desteklenmeyen paket sürümü')
  })
})

describe('yayın paketi: İY 0.5 ÜST tutmadığında 2. yarı (sürüm 10)', () => {
  it('istatistikte yalnızca iki sayı vardır; skorlar, maçlar ve öneri kimlikleri pakete girmez', () => {
    for (const scope of ['all', 'shared'] as const) {
      const ht = payload.statistics[scope].htScoreless!
      expect(Object.keys(ht)).toEqual(MEMBER_KEYS.htScoreless)
      expect(Number.isInteger(ht.n)).toBe(true)
      // Az maçta oran gösterilmez; hesaplanabileceği sayı da pakette yoktur.
      expect(ht.over).toBeNull()
    }
    // Sayım için kullanılan öneri ve skor kayıtlarından hiçbir kimlik pakette geçmez.
    for (const pick of PICKS) expect(text).not.toContain(pick.id)
    for (const result of RESULTS) expect(text).not.toContain(result.matchId)
    expect(text).not.toMatch(/"(scored|excluded|scoreless|under|htHome|htAway|ftHome|ftAway|matchId)"/)
  })
})

describe('yayın paketi: piyasa yüzdesi (sürüm 11)', () => {
  const payload = buildMemberPayload(memberInput())
  const input = memberInput()
  const copy = (): MemberPayload => JSON.parse(JSON.stringify(payload)) as MemberPayload
  const rejects = (change: (p: MemberPayload) => void) => {
    const p = copy()
    change(p)
    return () => assertMemberPayload(p)
  }
  const listOf = (p: MemberPayload, categoryId: string) => p.days[0].lists.find((l) => l.categoryId === categoryId)!

  it('şemadaki kategori listesi analizdeki oranlı kategorilerle birebir aynıdır', () => {
    expect([...MEMBER_MARKET_CATEGORIES].sort()).toEqual([...MARKET_CATEGORY_IDS].sort())
    expect(MEMBER_MARKET_CATEGORIES).toHaveLength(10)
  })

  it('mkt analizdeki marjı çıkarılmış piyasa yüzdesiyle aynıdır; değer yoksa ve oransız listede alan hiç yoktur', () => {
    let written = 0
    payload.days.forEach((day, d) => {
      const analysis = analyzeDay(input.days[d].matches, input.thresholds, 'percent', input.marketConflictLimit)
      for (const list of day.lists) {
        list.items.forEach((item, j) => {
          const market = analysis[list.categoryId].predictions[j].market
          if (!MEMBER_MARKET_CATEGORIES.includes(list.categoryId)) {
            expect(market).toBeUndefined()
            expect('mkt' in item, `${list.categoryId} #${j + 1}`).toBe(false)
          } else if (market?.percent == null) {
            expect('mkt' in item, `${list.categoryId} #${j + 1}`).toBe(false)
          } else {
            written++
            expect(item.mkt, `${list.categoryId} #${j + 1}`).toBe(market.percent)
            expect(Number.isInteger(item.mkt)).toBe(true)
          }
        })
      }
    })
    expect(written).toBeGreaterThan(20)
    // "Diğer öneriler" satırına girmez.
    for (const day of payload.days) for (const list of day.lists) for (const item of list.items) for (const other of item.others ?? []) expect(Object.keys(other)).toEqual(MEMBER_KEYS.other)
    // Paket metninde değer yoksa bile null yazılmaz.
    expect(JSON.stringify(payload)).not.toContain('"mkt":null')
  })

  it('iki yönlü oranın biri eksikse alan yazılmaz', () => {
    const without = memberInput()
    const missing = { ...without, days: without.days.map((d) => ({ ...d, matches: d.matches.map((m) => ({ ...m, stats: Object.fromEntries(Object.entries(m.stats).filter(([key]) => key !== 'Odds_BTTS_No')) })) })) }
    const p = buildMemberPayload(missing)
    expect(listOf(p, 'btts').items.length).toBeGreaterThan(0)
    expect(listOf(p, 'btts').items.every((i) => !('mkt' in i))).toBe(true)
    // Diğer listeler etkilenmez.
    expect(listOf(p, 'over35').items.some((i) => i.mkt !== undefined)).toBe(listOf(payload, 'over35').items.some((i) => i.mkt !== undefined))
  })

  it('şema: ondalık, aralık dışı, null, metin, yanlış kategori ve eski sürüm reddedilir', () => {
    const withMkt = (p: MemberPayload) => p.days[0].lists.flatMap((l) => l.items).find((i) => i.mkt !== undefined)!
    expect(withMkt(payload)).toBeDefined()
    expect(() => assertMemberPayload(copy())).not.toThrow()
    for (const bad of [54.5, 101, -1, null, '54', true]) expect(rejects((p) => void ((withMkt(p) as unknown as Record<string, unknown>).mkt = bad)), String(bad)).toThrow(MemberPayloadError)
    for (const categoryId of ['over25btts', 'cards35', 'homeWin15']) {
      const target = (p: MemberPayload) => listOf(p, categoryId).items[0]
      expect(target(payload), categoryId).toBeDefined()
      expect(rejects((p) => void (target(p).mkt = 50)), categoryId).toThrow('bu listede bulunamaz')
    }
    // Sürüm 10 pakette alan bulunamaz.
    expect(
      rejects((p) => {
        ;(p as { v: number }).v = 10
        withoutNote(p)
      }),
    ).toThrow('izinli olmayan alan: mkt')
  })
})

describe('yayın paketi: maç notu (sürüm 13)', () => {
  const copy = (): MemberPayload => JSON.parse(text) as MemberPayload
  const matchOf = (p: MemberPayload, home: string) => p.days.flatMap((d) => d.matches).find((m) => m.home === home)!
  const notesOf = (p: MemberPayload) => p.days.flatMap((d) => d.matches.filter((m) => m.note !== undefined).map((m) => m.home))
  const rejects = (change: (p: MemberPayload) => void) => {
    const p = copy()
    change(p)
    return () => assertMemberPayload(p)
  }
  const kuzeyNote = (p: MemberPayload) => matchOf(p, 'Kuzey Yıldızı').note!

  it('"Üyelere göster" açık not maçında: yalnızca metin ve görsel (src, w, h)', () => {
    expect(MEMBER_PAYLOAD_VERSION).toBe(13)
    const note = kuzeyNote(payload)
    expect(note).toEqual({ text: 'Kadro haberi maçtan önce bekleniyor.\nİki oyuncu sakat.', image: { src: NOTE_IMAGE.dataUrl, w: 4, h: 3 } })
    expect(Object.keys(note)).toEqual(['text', 'image'])
    expect(Object.keys(note.image!)).toEqual([...MEMBER_KEYS.noteImage])
    // Dünün notu yalnızca metin: görsel anahtarı hiç yazılmaz.
    expect(matchOf(payload, 'Dünkü Ev').note).toEqual({ text: 'Dünkü maç için kısa not.' })
    expect(notesOf(payload).sort()).toEqual(['Dünkü Ev', 'Kuzey Yıldızı'])
    // Notu olmayan maçta anahtar yoktur (null da yazılmaz).
    expect(text).not.toContain('"note":null')
  })

  it('SIZINTI: "Üyelere göster" kapalı notun metni ve görseli pakette yok; maçın kendisi pakette', () => {
    const hidden = NOTES.find((n) => !n.publish)!
    expect(hidden.text).toContain(NOTE_HIDDEN_CANARY)
    const dogu = matchOf(payload, 'Doğu Gençlik')
    expect(dogu).toBeDefined()
    expect(dogu).not.toHaveProperty('note')
    expect(text).not.toContain(NOTE_HIDDEN_CANARY)
    expect(text).not.toContain(NOTE_HIDDEN_IMAGE.dataUrl.slice('data:image/png;base64,'.length))
    expect(text).not.toContain('İç not')
  })

  it('SIZINTI: notun iç alanları (işaret, değişiklik anı, kimlik, dataUrl) pakette yok', () => {
    const { keys } = collect(payload)
    for (const key of ['publish', 'updatedAt', 'matchId', 'dataUrl', 'notes']) expect(keys.has(key), key).toBe(false)
    expect(text).not.toContain(NOTE_UPDATED_AT)
    expect(text).not.toContain(NOTE_UPDATED_AT.slice(0, 19))
    for (const n of NOTES) expect(text).not.toContain(n.matchId)
  })

  it('kurucuya "Üyelere göster" kapalı not hiç verilmez (süzme kurucudan önce)', () => {
    expect(memberNoteInputs(NOTES).map((n) => n.matchId)).toEqual(NOTES.filter((n) => n.publish).map((n) => n.matchId))
    for (const input of memberNoteInputs(NOTES)) expect(Object.keys(input).every((k) => ['matchId', 'text', 'image'].includes(k))).toBe(true)
  })

  it('yalnızca pakette yer alan maçların notu girer', () => {
    const kuzey = MATCHES.find((m) => m.home === 'Kuzey Yıldızı')!
    const day = memberInput().days[0]
    // Listelerde hiç yer almayan maç: analize girmeyen (istatistiği boş) bir maç günün maçlarına eklenir.
    const outside: Match = { ...kuzey, id: `${DAY}|liste-disi|mac`, home: 'Liste Dışı', away: 'Hiçbir Liste', stats: {} }
    const lists = analyzeDay([...day.matches, outside], memberInput().thresholds, 'percent', 25)
    expect(CATEGORIES.some((c) => lists[c.id].predictions.slice(0, 15).some((p) => p.match.id === outside.id))).toBe(false)
    const notes = [...day.notes!, { matchId: outside.id, text: 'Listede olmayan maçın notu' }, { matchId: `${PREVIOUS_DAY}|baska|gun`, text: 'Başka günün notu' }]
    const built = buildMemberPayload(memberInput({ days: [{ ...day, matches: [...day.matches, outside], notes }, memberInput().days[1]] }))
    const builtText = JSON.stringify(built)
    expect(builtText).not.toContain('Liste Dışı')
    expect(builtText).not.toContain('Listede olmayan')
    expect(builtText).not.toContain('Başka günün')
    expect(notesOf(built).sort()).toEqual(['Dünkü Ev', 'Kuzey Yıldızı'])
    // Notun maçı başka bir günde: o günün maçına yazılmaz.
    const swapped = buildMemberPayload(memberInput({ days: [{ ...day, notes: [] }, { ...memberInput().days[1], notes: day.notes }] }))
    expect(notesOf(swapped)).toEqual([])
  })

  it('not verilmezse paket notsuz kurulur; diğer her şey aynıdır', () => {
    const without = buildMemberPayload(memberInput({ days: memberInput().days.map((d) => ({ ...d, notes: undefined })) }))
    const stripped = copy()
    withoutNote(stripped)
    expect(without).toEqual(stripped)
    expect(notesOf(without)).toEqual([])
  })

  it('şema: not yalnızca sürüm 13 pakette; sürüm 12 paket (notsuz) hâlâ açılır', () => {
    expect(rejects((p) => void ((p as { v: number }).v = 12))).toThrow('izinli olmayan alan: note')
    const v12 = copy()
    ;(v12 as { v: number }).v = 12
    withoutNote(v12)
    expect(() => assertMemberPayload(v12)).not.toThrow()
    expect(rejects((p) => void ((p as { v: number }).v = 14))).toThrow('desteklenmeyen paket sürümü')
  })

  it('şema: boş not, sınırı aşan ya da biçimsiz metin ve görsel, fazladan alan reddedilir', () => {
    const set = (change: (note: Record<string, unknown>) => void) => rejects((p) => change(kuzeyNote(p) as unknown as Record<string, unknown>))
    const image = (change: (img: Record<string, unknown>) => void) => set((note) => change(note.image as Record<string, unknown>))
    expect(set((n) => void (delete n.text, delete n.image))).toThrow('metin ya da görsel bekleniyor')
    expect(set((n) => void (n.text = ''))).toThrow(MemberPayloadError)
    expect(set((n) => void (n.text = 'a'.repeat(601)))).toThrow('1-600 karakterlik metin')
    expect(() => rejects((p) => void (kuzeyNote(p).text = 'a'.repeat(600)))()).not.toThrow()
    expect(set((n) => void (n.text = 5))).toThrow(MemberPayloadError)
    expect(set((n) => void (n.publish = true))).toThrow('izinli olmayan alan: publish')
    expect(set((n) => void (n.updatedAt = NOTE_UPDATED_AT))).toThrow('izinli olmayan alan: updatedAt')
    expect(image((i) => void (i.dataUrl = i.src))).toThrow('izinli olmayan alan: dataUrl')
    for (const src of ['data:image/gif;base64,R0lGODlhAQABAAAAACw=', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'https://example.org/x.png', 'javascript:alert(1)', 'data:image/png;base64,abc', 'data:image/png,ham-metin', `${NOTE_IMAGE.dataUrl}"`])
      expect(image((i) => void (i.src = src)), src).toThrow(MemberPayloadError)
    // 300 KB'ı aşan görsel (base64 çözülmüş boyut).
    expect(image((i) => void (i.src = `data:image/jpeg;base64,${'A'.repeat(Math.ceil((300 * 1024 + 3) / 3) * 4)}`))).toThrow('görsel en fazla')
    expect(() => rejects((p) => void (kuzeyNote(p).image!.src = `data:image/jpeg;base64,${'A'.repeat((300 * 1024 / 3) * 4)}`))()).not.toThrow()
    for (const [w, h] of [[901, 10], [10, 901], [0, 10], [1.5, 10], [null, 10]]) expect(image((i) => void ((i.w = w), (i.h = h))), `${w}x${h}`).toThrow(MemberPayloadError)
  })

  it('yayın anı sızıntı denetimi: not görseli taramayı bozmaz; notun metnindeki bağlantı yakalanır', () => {
    expect(scanForLeaks(payload, MATCHES).problems).toEqual([])
    const linked = copy()
    kuzeyNote(linked).text = 'Ayrıntı: https://ornek.test/haber'
    expect(scanForLeaks(linked, MATCHES).problems).toContain('bağlantı geçiyor')
  })
})
