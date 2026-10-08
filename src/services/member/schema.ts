import { CATEGORIES, getCategory, MAX_MATCHES_PER_CATEGORY, isCategoryId } from '../../config/categories'
import { MEMBER_TEXT_FIELDS } from '../../config/memberTexts'
import type { MemberPayload } from './payload'

// Yayın paketinin TAM şema denetimi. Paket şifrelenmeden hemen önce (admin) ve
// çözüldükten hemen sonra (üye) çalışır. Her nesnenin anahtar kümesi buradaki
// listeye birebir eşit olmalıdır: fazladan ya da eksik tek bir anahtar hata verir.
// Bu dosya payload.ts'teki tiplerin çalışma zamanındaki karşılığıdır.

export class MemberPayloadError extends Error {}

/** Paketteki her nesne türünün izinli anahtarları (başka hiçbir anahtar bulunamaz) */
export const MEMBER_KEYS = {
  payload: ['v', 'n', 'publishedAt', 'texts', 'days', 'statistics'],
  texts: ['disclaimer', 'account'],
  day: ['date', 'matches', 'lists', 'highlights'],
  /** Sürüm 1-3 paketlerdeki gün (highlights alanı yok) */
  dayV3: ['date', 'matches', 'lists'],
  highlight: ['home', 'away', 'league', 'time', 'categoryId', 'status', 'score', 'outcome'],
  match: ['home', 'away', 'league', 'time', 'status', 'score', 'homeStanding', 'awayStanding'],
  standing: ['rank', 'played', 'stale'],
  list: ['categoryId', 'items'],
  item: ['match', 'percent', 'model', 'conflict', 'stars', 'reliability', 'outcome', 'detail', 'others'],
  /** Sürüm 5: önerinin isteğe bağlı alanı (tahmini maç sayısı); sayı çıkarılamadıysa bulunmaz */
  itemOptional: ['sample'],
  /** Sürüm 1 paketlerdeki öneri (others alanı yok) */
  itemV1: ['match', 'percent', 'model', 'conflict', 'stars', 'reliability', 'outcome', 'detail'],
  other: ['categoryId', 'percent', 'reliability'],
  statsRoot: ['all', 'shared'],
  stats: ['main', 'overall', 'matches', 'byCategory', 'byReliability', 'daily', 'weekly', 'monthly', 'stars'],
  /** Sürüm 1 ve 2 paketlerdeki istatistik (main alanı yok) */
  statsV2: ['overall', 'matches', 'byCategory', 'byReliability', 'daily', 'weekly', 'monthly', 'stars'],
  main: ['categories', 'overall', 'matches'],
  statsMatches: ['total', 'decided'],
  bucket: ['key', 'tally'],
  tally: ['won', 'lost', 'void', 'pending', 'decided', 'total', 'rate', 'lowSample'],
  stars: ['byStars', 'byCategory', 'recomputed', 'missing'],
  starsCategory: ['key', 'byStars'],
} as const

export const MEMBER_RELIABILITY_LEVELS = ['low', 'medium', 'high', 'unknown', 'unmeasured', 'market', 'market-partial'] as const
const OUTCOMES = ['won', 'lost', 'void', 'pending']
const STATUSES = ['pending', 'completed', 'postponed', 'cancelled']
const STAR_KEYS = ['5', '4', '3', '2', '1']

const MAX_DAYS = 7
/**
 * Tahmini maç sayısının sınırları ve seviyeyle tutarlılığı. Değerler analiz tarafındaki
 * eşiklerle (8 ve 16) aynıdır; bu dosya üye sitesine girdiği için analiz kodu içe aktarılmaz,
 * eşitlik testle denetlenir.
 */
export const SAMPLE_RANGE = { min: 2, max: 40 } as const
export const SAMPLE_LEVEL_LIMITS = { medium: 8, high: 16 } as const
const levelOfSample = (sample: number): string => (sample >= SAMPLE_LEVEL_LIMITS.high ? 'high' : sample >= SAMPLE_LEVEL_LIMITS.medium ? 'medium' : 'low')
/** Bir günde pakete girebilecek en fazla öne çıkan seçim */
const MAX_HIGHLIGHTS = 60
const MAX_NAME = 120
const DATE = /^\d{4}-\d{2}-\d{2}$/
const WEEK_OR_DAY = DATE
const MONTH = /^\d{4}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/
/** formatScore çıktısı: "İY 1-0", "MS 3-1" ya da "İY 1-0 · MS 3-1" */
const SCORE = /^(İY \d{1,2}-\d{1,2}|MS \d{1,2}-\d{1,2}|İY \d{1,2}-\d{1,2} · MS \d{1,2}-\d{1,2})$/
/** resultDetail çıktısı */
const DETAIL = /^((İY|2Y) \d{1,2}-\d{1,2}|(Korner|Kart) \d{1,3})$/

type Obj = Record<string, unknown>

const fail = (path: string, message: string): never => {
  throw new MemberPayloadError(`Yayın paketi geçersiz (${path}): ${message}`)
}

function object(value: unknown, path: string, keys: readonly string[], optional: readonly string[] = []): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(path, 'nesne bekleniyor')
  const actual = Object.keys(value)
  const extra = actual.filter((k) => !keys.includes(k) && !optional.includes(k))
  if (extra.length > 0) return fail(path, `izinli olmayan alan: ${extra.join(', ')}`)
  const missing = keys.filter((k) => !actual.includes(k))
  if (missing.length > 0) return fail(path, `eksik alan: ${missing.join(', ')}`)
  return value as Obj
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) return fail(path, 'dizi bekleniyor')
  if (value.length > max) return fail(path, `en fazla ${max} öğe olabilir`)
  return value
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return fail(path, `${min}-${max} arası tam sayı bekleniyor`)
  return value
}

function text(value: unknown, path: string, max: number, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return fail(path, `1-${max} karakterlik metin bekleniyor`)
  if (pattern && !pattern.test(value)) return fail(path, 'biçim beklenenden farklı')
  return value
}

const nullable = <T>(value: unknown, check: (v: unknown) => T): T | null => (value === null ? null : check(value))

function oneOf(value: unknown, path: string, options: readonly string[]): string {
  if (typeof value !== 'string' || !options.includes(value)) return fail(path, `izinli değerler: ${options.join(', ')}`)
  return value
}

const COUNT_MAX = 10_000_000

function tally(value: unknown, path: string): void {
  const t = object(value, path, MEMBER_KEYS.tally)
  for (const key of ['won', 'lost', 'void', 'pending', 'decided', 'total'] as const) integer(t[key], `${path}.${key}`, 0, COUNT_MAX)
  if (t.rate !== null && (typeof t.rate !== 'number' || !Number.isFinite(t.rate) || t.rate < 0 || t.rate > 100)) fail(`${path}.rate`, '0-100 arası sayı ya da null bekleniyor')
  if (typeof t.lowSample !== 'boolean') fail(`${path}.lowSample`, 'doğru/yanlış bekleniyor')
}

function buckets(value: unknown, path: string, max: number, key: (v: unknown, p: string) => unknown): void {
  array(value, path, max).forEach((entry, i) => {
    const b = object(entry, `${path}[${i}]`, MEMBER_KEYS.bucket)
    key(b.key, `${path}[${i}].key`)
    tally(b.tally, `${path}[${i}].tally`)
  })
}

const categoryKey = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !isCategoryId(value)) return fail(path, 'bilinmeyen kategori')
  return value
}

function matchCounts(value: unknown, path: string): void {
  const m = object(value, path, MEMBER_KEYS.statsMatches)
  integer(m.total, `${path}.total`, 0, COUNT_MAX)
  integer(m.decided, `${path}.decided`, 0, COUNT_MAX)
}

function stats(value: unknown, path: string, version: number): void {
  const s = object(value, path, version >= 3 ? MEMBER_KEYS.stats : MEMBER_KEYS.statsV2)
  if (version >= 3) {
    const main = object(s.main, `${path}.main`, MEMBER_KEYS.main)
    const ids = array(main.categories, `${path}.main.categories`, CATEGORIES.length).map((id, i) => categoryKey(id, `${path}.main.categories[${i}]`))
    if (ids.length === 0 || new Set(ids).size !== ids.length) fail(`${path}.main.categories`, 'en az bir kategori, her biri bir kez bekleniyor')
    tally(main.overall, `${path}.main.overall`)
    matchCounts(main.matches, `${path}.main.matches`)
  }
  tally(s.overall, `${path}.overall`)
  matchCounts(s.matches, `${path}.matches`)
  buckets(s.byCategory, `${path}.byCategory`, CATEGORIES.length, categoryKey)
  buckets(s.byReliability, `${path}.byReliability`, MEMBER_RELIABILITY_LEVELS.length, (v, p) => oneOf(v, p, MEMBER_RELIABILITY_LEVELS))
  buckets(s.daily, `${path}.daily`, 400, (v, p) => text(v, p, 10, WEEK_OR_DAY))
  buckets(s.weekly, `${path}.weekly`, 1000, (v, p) => text(v, p, 10, WEEK_OR_DAY))
  buckets(s.monthly, `${path}.monthly`, 500, (v, p) => text(v, p, 7, MONTH))
  const st = object(s.stars, `${path}.stars`, MEMBER_KEYS.stars)
  buckets(st.byStars, `${path}.stars.byStars`, STAR_KEYS.length, (v, p) => oneOf(v, p, STAR_KEYS))
  array(st.byCategory, `${path}.stars.byCategory`, CATEGORIES.length).forEach((entry, i) => {
    const p = `${path}.stars.byCategory[${i}]`
    const c = object(entry, p, MEMBER_KEYS.starsCategory)
    categoryKey(c.key, `${p}.key`)
    array(c.byStars, `${p}.byStars`, STAR_KEYS.length).forEach((t, j) => tally(t, `${p}.byStars[${j}]`))
  })
  integer(st.recomputed, `${path}.stars.recomputed`, 0, COUNT_MAX)
  integer(st.missing, `${path}.stars.missing`, 0, COUNT_MAX)
}

function standing(value: unknown, path: string): void {
  const s = object(value, path, MEMBER_KEYS.standing)
  integer(s.rank, `${path}.rank`, 1, 200)
  integer(s.played, `${path}.played`, 0, 200)
  if (typeof s.stale !== 'boolean') fail(`${path}.stale`, 'doğru/yanlış bekleniyor')
}

function day(value: unknown, path: string, version: number): void {
  const d = object(value, path, version >= 4 ? MEMBER_KEYS.day : MEMBER_KEYS.dayV3)
  text(d.date, `${path}.date`, 10, DATE)
  const matches = array(d.matches, `${path}.matches`, CATEGORIES.length * MAX_MATCHES_PER_CATEGORY)
  matches.forEach((entry, i) => {
    const p = `${path}.matches[${i}]`
    const m = object(entry, p, MEMBER_KEYS.match)
    text(m.home, `${p}.home`, MAX_NAME)
    text(m.away, `${p}.away`, MAX_NAME)
    nullable(m.league, (v) => text(v, `${p}.league`, MAX_NAME))
    nullable(m.time, (v) => text(v, `${p}.time`, 5, TIME))
    nullable(m.status, (v) => oneOf(v, `${p}.status`, STATUSES))
    nullable(m.score, (v) => text(v, `${p}.score`, 20, SCORE))
    nullable(m.homeStanding, (v) => standing(v, `${p}.homeStanding`))
    nullable(m.awayStanding, (v) => standing(v, `${p}.awayStanding`))
  })
  if (version >= 4) {
    const seen = new Set<string>()
    array(d.highlights, `${path}.highlights`, MAX_HIGHLIGHTS).forEach((entry, i) => {
      const p = `${path}.highlights[${i}]`
      const h = object(entry, p, MEMBER_KEYS.highlight)
      text(h.home, `${p}.home`, MAX_NAME)
      text(h.away, `${p}.away`, MAX_NAME)
      nullable(h.league, (v) => text(v, `${p}.league`, MAX_NAME))
      text(h.time, `${p}.time`, 5, TIME)
      categoryKey(h.categoryId, `${p}.categoryId`)
      nullable(h.status, (v) => oneOf(v, `${p}.status`, STATUSES))
      nullable(h.score, (v) => text(v, `${p}.score`, 20, SCORE))
      oneOf(h.outcome, `${p}.outcome`, OUTCOMES)
      const key = [h.home, h.away, h.time, h.categoryId].join('|')
      if (seen.has(key)) fail(p, 'aynı seçim bir günde iki kez yer alamaz')
      seen.add(key)
    })
  }
  const lists = array(d.lists, `${path}.lists`, CATEGORIES.length)
  if (lists.length !== CATEGORIES.length) fail(`${path}.lists`, 'her kategori için bir liste bekleniyor')
  /** "liste sırası:maç sırası" -> o listedeki yüzde ve seviye (others alanının çapraz denetimi için) */
  const placed = new Map<string, { percent: number; reliability: string }>()
  const claimed: { path: string; list: number; match: number; others: unknown }[] = []
  lists.forEach((entry, i) => {
    const p = `${path}.lists[${i}]`
    const l = object(entry, p, MEMBER_KEYS.list)
    if (l.categoryId !== CATEGORIES[i].id) fail(`${p}.categoryId`, 'kategoriler kayıt defterindeki sırada olmalı')
    array(l.items, `${p}.items`, MAX_MATCHES_PER_CATEGORY).forEach((raw, j) => {
      const q = `${p}.items[${j}]`
      const item = object(raw, q, version === 1 ? MEMBER_KEYS.itemV1 : MEMBER_KEYS.item, version >= 5 ? MEMBER_KEYS.itemOptional : [])
      integer(item.match, `${q}.match`, 0, matches.length - 1)
      integer(item.percent, `${q}.percent`, 0, 100)
      nullable(item.model, (v) => integer(v, `${q}.model`, 0, 100))
      // Çelişki türü kategoriye bağlıdır: Taraf & Gol'de 'hesap', diğerlerinde 'model'.
      nullable(item.conflict, (v) => oneOf(v, `${q}.conflict`, [getCategory(CATEGORIES[i].id).group === 'sidegoals' ? 'hesap' : 'model']))
      integer(item.stars, `${q}.stars`, 1, 5)
      oneOf(item.reliability, `${q}.reliability`, MEMBER_RELIABILITY_LEVELS)
      // Tahmini maç sayısı yalnızca seviyesi ondan çıkan öneride bulunur ve seviyeyle tutarlıdır.
      if (item.sample !== undefined && levelOfSample(integer(item.sample, `${q}.sample`, SAMPLE_RANGE.min, SAMPLE_RANGE.max)) !== item.reliability) fail(`${q}.sample`, 'seviyeyle tutarlı olmalı')
      nullable(item.outcome, (v) => oneOf(v, `${q}.outcome`, OUTCOMES))
      nullable(item.detail, (v) => text(v, `${q}.detail`, 20, DETAIL))
      if (placed.has(`${i}:${item.match}`)) fail(`${q}.match`, 'aynı maç bir listede iki kez yer alamaz')
      placed.set(`${i}:${item.match}`, { percent: item.percent as number, reliability: item.reliability as string })
      if (version !== 1) claimed.push({ path: `${q}.others`, list: i, match: item.match as number, others: item.others })
    })
  })

  // others: biçim denetimi ve çapraz denetim. Her giriş, aynı maçın o listede GERÇEKTEN bulunan
  // önerisinin yüzdesi ve seviyesiyle birebir aynı olmalı; eksik ya da fazla giriş olamaz.
  for (const claim of claimed) {
    const others = array(claim.others, claim.path, CATEGORIES.length - 1).map((raw, k) => {
      const q = `${claim.path}[${k}]`
      const other = object(raw, q, MEMBER_KEYS.other)
      return { categoryId: categoryKey(other.categoryId, `${q}.categoryId`), percent: integer(other.percent, `${q}.percent`, 0, 100), reliability: oneOf(other.reliability, `${q}.reliability`, MEMBER_RELIABILITY_LEVELS) }
    })
    const expected = CATEGORIES.flatMap((category, index) => {
      const found = index === claim.list ? undefined : placed.get(`${index}:${claim.match}`)
      return found ? [{ categoryId: category.id as string, percent: found.percent, reliability: found.reliability }] : []
    })
    if (JSON.stringify(others) !== JSON.stringify(expected)) fail(claim.path, 'aynı maçın paketteki diğer önerileriyle birebir aynı olmalı')
  }
}

/** Paketi şemaya karşı denetler; uymuyorsa MemberPayloadError fırlatır. */
export function assertMemberPayload(value: unknown): asserts value is MemberPayload {
  const p = object(value, 'paket', MEMBER_KEYS.payload)
  if (p.v !== 1 && p.v !== 2 && p.v !== 3 && p.v !== 4 && p.v !== 5) fail('paket.v', 'desteklenmeyen paket sürümü')
  integer(p.n, 'paket.n', 1, COUNT_MAX)
  text(p.publishedAt, 'paket.publishedAt', 24, ISO)
  const texts = object(p.texts, 'paket.texts', MEMBER_KEYS.texts)
  for (const { key, maxLength } of MEMBER_TEXT_FIELDS) text(texts[key], `paket.texts.${key}`, maxLength)
  const days = array(p.days, 'paket.days', MAX_DAYS)
  if (days.length === 0) fail('paket.days', 'en az bir gün bekleniyor')
  days.forEach((d, i) => day(d, `paket.days[${i}]`, p.v as number))
  const root = object(p.statistics, 'paket.statistics', MEMBER_KEYS.statsRoot)
  stats(root.all, 'paket.statistics.all', p.v as number)
  stats(root.shared, 'paket.statistics.shared', p.v as number)
}
