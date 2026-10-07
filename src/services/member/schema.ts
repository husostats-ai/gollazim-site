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
} as const

export const MEMBER_RELIABILITY_LEVELS = ['low', 'medium', 'high', 'unknown', 'unmeasured', 'market', 'market-partial'] as const
const OUTCOMES = ['won', 'lost', 'void', 'pending']
const STATUSES = ['pending', 'completed', 'postponed', 'cancelled']
const STAR_KEYS = ['5', '4', '3', '2', '1']

const MAX_DAYS = 7
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

function object(value: unknown, path: string, keys: readonly string[]): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(path, 'nesne bekleniyor')
  const actual = Object.keys(value)
  const extra = actual.filter((k) => !keys.includes(k))
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

function stats(value: unknown, path: string): void {
  const s = object(value, path, MEMBER_KEYS.stats)
  tally(s.overall, `${path}.overall`)
  const m = object(s.matches, `${path}.matches`, MEMBER_KEYS.statsMatches)
  integer(m.total, `${path}.matches.total`, 0, COUNT_MAX)
  integer(m.decided, `${path}.matches.decided`, 0, COUNT_MAX)
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

function day(value: unknown, path: string): void {
  const d = object(value, path, MEMBER_KEYS.day)
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
  const lists = array(d.lists, `${path}.lists`, CATEGORIES.length)
  if (lists.length !== CATEGORIES.length) fail(`${path}.lists`, 'her kategori için bir liste bekleniyor')
  lists.forEach((entry, i) => {
    const p = `${path}.lists[${i}]`
    const l = object(entry, p, MEMBER_KEYS.list)
    if (l.categoryId !== CATEGORIES[i].id) fail(`${p}.categoryId`, 'kategoriler kayıt defterindeki sırada olmalı')
    array(l.items, `${p}.items`, MAX_MATCHES_PER_CATEGORY).forEach((raw, j) => {
      const q = `${p}.items[${j}]`
      const item = object(raw, q, MEMBER_KEYS.item)
      integer(item.match, `${q}.match`, 0, matches.length - 1)
      integer(item.percent, `${q}.percent`, 0, 100)
      nullable(item.model, (v) => integer(v, `${q}.model`, 0, 100))
      // Çelişki türü kategoriye bağlıdır: Taraf & Gol'de 'hesap', diğerlerinde 'model'.
      nullable(item.conflict, (v) => oneOf(v, `${q}.conflict`, [getCategory(CATEGORIES[i].id).group === 'sidegoals' ? 'hesap' : 'model']))
      integer(item.stars, `${q}.stars`, 1, 5)
      oneOf(item.reliability, `${q}.reliability`, MEMBER_RELIABILITY_LEVELS)
      nullable(item.outcome, (v) => oneOf(v, `${q}.outcome`, OUTCOMES))
      nullable(item.detail, (v) => text(v, `${q}.detail`, 20, DETAIL))
    })
  })
}

/** Paketi şemaya karşı denetler; uymuyorsa MemberPayloadError fırlatır. */
export function assertMemberPayload(value: unknown): asserts value is MemberPayload {
  const p = object(value, 'paket', MEMBER_KEYS.payload)
  if (p.v !== 1) fail('paket.v', 'desteklenmeyen paket sürümü')
  integer(p.n, 'paket.n', 1, COUNT_MAX)
  text(p.publishedAt, 'paket.publishedAt', 24, ISO)
  const texts = object(p.texts, 'paket.texts', MEMBER_KEYS.texts)
  for (const { key, maxLength } of MEMBER_TEXT_FIELDS) text(texts[key], `paket.texts.${key}`, maxLength)
  const days = array(p.days, 'paket.days', MAX_DAYS)
  if (days.length === 0) fail('paket.days', 'en az bir gün bekleniyor')
  days.forEach((d, i) => day(d, `paket.days[${i}]`))
  const root = object(p.statistics, 'paket.statistics', MEMBER_KEYS.statsRoot)
  stats(root.all, 'paket.statistics.all')
  stats(root.shared, 'paket.statistics.shared')
}
