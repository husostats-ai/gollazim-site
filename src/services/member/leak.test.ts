import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AiVerdict, BackupFile, Match } from '../../types'
import { toAppDateTime } from '../../utils/date'
import { shiftDate } from '../../utils/format'
import { analyzeDay } from '../analysis/engine'
import { CATEGORIES } from '../../config/categories'
import { TEXT_FIELDS } from '../../config/columnAliases'
import { isBackupFile } from '../data/backupFormat'
import { DAY, dayMatches, MATCHES, memberInput, PREVIOUS_DAY, RAW_CANARIES, RAW_HEADERS, RAW_STAT_KEYS, RESULTS, URL_CANARY } from './__fixtures__/rawData'
import { buildMemberPayload, type MemberPayload, type MemberPayloadInput } from './payload'
import { assertMemberPayload, MEMBER_KEYS, MemberPayloadError } from './schema'

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
      day: ['date', 'matches', 'lists'],
      match: ['home', 'away', 'league', 'time', 'status', 'score', 'homeStanding', 'awayStanding'],
      standing: ['rank', 'played', 'stale'],
      list: ['categoryId', 'items'],
      item: ['match', 'percent', 'model', 'conflict', 'stars', 'reliability', 'outcome', 'detail'],
      statsRoot: ['all', 'shared'],
      stats: ['overall', 'matches', 'byCategory', 'byReliability', 'daily', 'weekly', 'monthly', 'stars'],
      statsMatches: ['total', 'decided'],
      bucket: ['key', 'tally'],
      tally: ['won', 'lost', 'void', 'pending', 'decided', 'total', 'rate', 'lowSample'],
      stars: ['byStars', 'byCategory', 'recomputed', 'missing'],
      starsCategory: ['key', 'byStars'],
    })
  })
})

describe('yayın paketi: şema denetimi fazladan ya da eksik alanı reddeder', () => {
  /** Paketteki her nesne için: o nesneye uygulanacak değişikliği yapıp kopyayı döner */
  function mutations(mutate: (node: Record<string, unknown>) => void): unknown[] {
    const variants: unknown[] = []
    const count = (function visit(value: unknown): number {
      if (Array.isArray(value)) return value.reduce<number>((sum, v) => sum + visit(v), 0)
      if (typeof value !== 'object' || value === null) return 0
      return 1 + Object.values(value).reduce<number>((sum, v) => sum + visit(v), 0)
    })(payload)
    for (let target = 0; target < count; target++) {
      const copy = JSON.parse(text) as unknown
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
    expect(broken((p) => void ((p as { v: number }).v = 2))).toThrow(MemberPayloadError)
    expect(broken((p) => void (p.days = []))).toThrow(MemberPayloadError)
    expect(broken((p) => void p.days[0].lists.reverse())).toThrow(MemberPayloadError)
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
    const dates = [day, shiftDate(day, -1)]
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
