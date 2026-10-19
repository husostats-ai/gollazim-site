import { describe, expect, it } from 'vitest'
import { CATEGORIES, defaultThresholds, getCategory, type CategoryId } from '../../config/categories'
import { isMainCategory, MAIN_CATEGORY_IDS, MAIN_SCOPE_NOTE, onlyMainCategories } from '../../config/mainCategories'
import type { AiVerdict, Match, Pick, PickOutcome, SharedPick } from '../../types'
import { makeMatch } from '../analysis/testUtils'
import { recordShare } from '../story/shared'
import { buildStats } from './statsEngine'
import { buildStatsSummary, rateCell, type SummaryInput } from './statsSummary'

// İstatistiklerin ana kategorilerle sınırlanması: tek istisna "Kategori başarısı"dır. Değerler sentetiktir.

const OTHER_IDS = CATEGORIES.map((c) => c.id).filter((id) => !isMainCategory(id))

let n = 0
const pick = (categoryId: CategoryId, outcome: PickOutcome, date: string, extra: Partial<Pick> = {}): Pick => ({
  id: `s${++n}`,
  matchId: `sm${n}`,
  categoryId,
  date,
  percent: getCategory(categoryId).defaultThreshold + 7,
  threshold: getCategory(categoryId).defaultThreshold,
  outcome,
  frozenAt: '',
  reliability: getCategory(categoryId).group === 'sidegoals' ? 'market' : getCategory(categoryId).group === 'corners' || getCategory(categoryId).group === 'cards' ? 'unmeasured' : 'low',
  ...extra,
})

// Her kategoride (17) üç günde öneri: tuttu, tutmadı, ve kategoriye göre değişen bir tane daha.
const DATES = ['2026-10-07', '2026-10-08', '2026-10-09']
const picks: Pick[] = CATEGORIES.flatMap((c, i) => [
  pick(c.id, 'won', DATES[0]),
  pick(c.id, 'lost', DATES[1]),
  pick(c.id, i % 3 === 0 ? 'won' : i % 3 === 1 ? 'void' : 'pending', DATES[2]),
  ...(isMainCategory(c.id) ? [pick(c.id, 'won', DATES[2], { reliability: 'high' }), pick(c.id, 'won', DATES[1], { reliability: 'medium' })] : []),
])
const matches: Match[] = picks.map((p, i) => makeMatch({}, { id: p.matchId, date: p.date, home: `Ev ${i}`, away: `Dep ${i}`, league: i % 2 ? 'England · Premier League' : 'Spain · LaLiga' }))
const shared: SharedPick[] = recordShare([], { date: DATES[0], categoryId: 'over25', matches: picks.filter((p) => p.categoryId === 'over25').map((p) => ({ id: p.matchId, date: p.date, time: '20:00' })), now: '2026-10-07T09:00:00.000Z' })
const input = (extra: Partial<SummaryInput> = {}): SummaryInput => ({
  now: new Date('2026-10-10T09:30:00.000Z'),
  today: '2026-10-10',
  scope: { kind: 'all' },
  includeGuide: false,
  picks,
  matches,
  verdicts: [],
  shared,
  // Sıra yeniden hesaplanmaz: her öneriye 1–15 arası bir sıra verilir.
  ranks: new Map(picks.map((p, i) => [p.id, (i % 15) + 1])),
  thresholds: defaultThresholds(),
  marketConflictLimit: 25,
  ...extra,
})
const text = buildStatsSummary(input())
const section = (title: string): string => {
  const start = text.indexOf(`## ${title}`)
  if (start < 0) throw new Error(`bölüm yok: ${title}`)
  const end = text.indexOf('\n## ', start + 1)
  return text.slice(start, end < 0 ? undefined : end)
}
const row = (body: string, first: string): string[] => {
  const line = body.split('\n').find((l) => l.startsWith(`| ${first} |`))
  if (!line) throw new Error(`satır yok: ${first}`)
  return line.split('|').slice(1, -1).map((c) => c.trim())
}
/** Tablonun gövde satırları (başlık ve ayraç hariç), ilk sütuna göre süzülebilir */
const bodyRows = (body: string, skip: (first: string) => boolean = () => false): string[][] =>
  body
    .split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| ---'))
    .slice(1)
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((r) => !skip(r[0]))
/** "%x · n=12*" hücresinden n */
const nOf = (cell: string): number => (cell === '—' ? 0 : Number(/n=(\d+)/.exec(cell)![1]))

const main = buildStats(onlyMainCategories(picks))
const everything = buildStats(picks)

describe('ortak filtre', () => {
  it('yalnızca 2.5 ÜST, KG VAR ve İLK YARI 0.5 ÜST geçer; diğer 14 kategori geçmez', () => {
    expect(MAIN_CATEGORY_IDS).toEqual(['over25', 'btts', 'ht05'])
    expect(CATEGORIES.filter((c) => isMainCategory(c.id)).map((c) => c.id).sort()).toEqual(['btts', 'ht05', 'over25'])
    expect(OTHER_IDS).toHaveLength(CATEGORIES.length - 3)
    const rows = CATEGORIES.map((c) => ({ categoryId: c.id, x: 1 }))
    expect(onlyMainCategories(rows).map((r) => r.categoryId).sort()).toEqual(['btts', 'ht05', 'over25'])
    expect(onlyMainCategories([])).toEqual([])
  })

  it('kapsam cümlesi listedeki kategori adlarıyla aynıdır', () => {
    for (const id of MAIN_CATEGORY_IDS) expect(MAIN_SCOPE_NOTE).toContain(getCategory(id).label)
    expect(MAIN_SCOPE_NOTE).toBe("Bu bölümler yalnızca 2.5 ÜST, KG VAR ve İLK YARI 0.5 ÜST'ü kapsar; diğer kategoriler yalnızca Kategori bazlı başarı'da gösterilir.")
  })
})

describe('özet: her bölümün toplamı 3 kategorinin toplamıdır', () => {
  const total = main.overall.decided
  const won = main.overall.won

  it('veri gerçekten karışık: ana kategoriler tüm önerilerin alt kümesi', () => {
    // 2.5 ÜST 4/5, İLK YARI 0.5 ÜST 3/4 (+1 değerlendirilemedi), KG VAR 3/4 (+1 bekliyor)
    expect([total, won]).toEqual([13, 10])
    expect(everything.overall.decided).toBeGreaterThan(total)
  })

  it('başlık ve Kapsam satırı', () => {
    expect(text).toContain(`- Kapsam: Tümü. ${MAIN_SCOPE_NOTE}\n`)
    expect(text).toContain(`- Sonuçlanmış öneri (tuttu + tutmadı): ${total} (tutan ${won}, tutmayan ${main.overall.lost})`)
    expect(text).toContain(`- Dondurulmuş öneri: ${main.overall.total}\n`)
    expect(text).toContain(`- Benzersiz maç: ${main.matches.total} (`)
    expect(text).toContain(`- Genel başarı: %76,9\n`)
  })

  it('lig türü, lig, lig bazlı ana kategoriler', () => {
    expect(row(section('Lig türüne göre başarı'), 'Tüm türler').slice(1, 3)).toEqual([String(total), String(won)])
    expect(row(section('Lig bazlı başarı'), 'Tüm ligler').slice(1, 3)).toEqual([String(total), String(won)])
    expect(section('Lig bazlı ana kategoriler — Tüm öneriler')).toContain(`Ana kategorilerde ${total} sonuçlanmış öneri`)
  })

  it('güvenilirlik, yıldız, sıra, eşik üstü, günlük, paylaşılan', () => {
    const sum = (rows: string[][], col: number) => rows.reduce((s, r) => s + Number(r[col]), 0)
    expect(sum(bodyRows(section('Veri güvenilirliğine göre başarı')), 1)).toBe(total)
    const stars = section('Yıldız sayısına göre başarı')
    expect(sum(bodyRows(stars.slice(0, stars.indexOf('Kategori bazında'))), 1)).toBe(total)
    const rank = row(section('Sıraya göre başarı (yeniden hesaplanmış ve doğrulanmış sıra)'), 'Tüm kategoriler')
    expect(rank.slice(1).reduce((s, c) => s + nOf(c), 0)).toBe(total)
    const margin = row(section('Eşik üstü puana göre başarı'), 'Tüm kategoriler')
    expect(margin.slice(2).reduce((s, c) => s + nOf(c), 0)).toBe(total)
    expect(sum(bodyRows(section('Günlük sonuçlar')), 2)).toBe(total)
    expect(row(section('Paylaşılan ve tüm öneriler'), 'Genel')[1]).toBe(rateCell(main.overall))
  })

  it('ana kategori dışındaki hiçbir kategori adı "Kategori başarısı" ve "Güncel eşikler" dışında geçmez', () => {
    const rest = text.replace(section('Kategori başarısı'), '').replace(section('Güncel eşikler'), '')
    for (const id of OTHER_IDS) expect(rest, id).not.toContain(getCategory(id).label)
    expect(rest).not.toMatch(/Taraf & Gol|[Kk]orner|KART/)
  })
})

describe('boş bölümler gösterilmez', () => {
  it('Taraf & Gol kalibrasyonu yazılmaz', () => {
    expect(text).not.toContain('## Kalibrasyon: Taraf & Gol')
    // Hesap durur: tüm öneriler verilse dolu çıkardı.
    expect(everything.sideGoals).not.toBeNull()
  })

  it('güvenilirlik tablosunda sonuçlanmış önerisi olmayan seviye satırı yok', () => {
    const levels = bodyRows(section('Veri güvenilirliğine göre başarı')).map((r) => r[0])
    expect(levels).toEqual(['Yüksek', 'Orta', 'Düşük'])
    // Ana kategoride yalnızca bekleyen önerisi olan seviye de yazılmaz.
    const pendingOnly = buildStatsSummary(input({ picks: [...picks, pick('btts', 'pending', DATES[2], { reliability: 'unknown' })] }))
    expect(pendingOnly).not.toContain('| Bilinmiyor |')
  })
})

describe('Kategori başarısı etkilenmez', () => {
  it('17 satır, tüm kategoriler; sayılar tüm önerilerin hesabıyla aynı', () => {
    const rows = bodyRows(section('Kategori başarısı'))
    expect(rows).toHaveLength(CATEGORIES.length)
    expect(rows.map((r) => r[0])).toEqual(CATEGORIES.map((c) => c.label))
    for (const b of everything.byCategory) {
      const t = b.tally
      expect(row(section('Kategori başarısı'), getCategory(b.key).label).slice(1, 3), b.key).toEqual([String(t.decided), String(t.won)])
      expect(row(section('Kategori başarısı'), getCategory(b.key).label).slice(5), b.key).toEqual([String(t.void), String(t.pending)])
    }
  })
})

describe('yapay zekâ kararları: kategori bazlı bölümde 2.5 ÜST & KG VAR ölçülmez', () => {
  it('aynı maçın 2.5 ÜST ve 2.5 ÜST & KG VAR kararından yalnızca 2.5 ÜST sayılır', () => {
    const over25 = pick('over25', 'won', DATES[0])
    const combo = { ...pick('over25btts', 'lost', DATES[0]), matchId: over25.matchId }
    const verdict: AiVerdict = { id: `${over25.matchId}|chatgpt`, matchId: over25.matchId, date: DATES[0], provider: 'chatgpt', byCategory: { over25: 'strong', over25btts: 'strong' }, asked: ['over25', 'over25btts'], reason: 'r', risk: 'k', savedAt: '2026-10-01T00:00:00.000Z' }
    const body = buildStatsSummary(input({ picks: [over25, combo], matches: [makeMatch({}, { id: over25.matchId, date: DATES[0] })], verdicts: [verdict], shared: [] }))
    const part = body.slice(body.indexOf('## Yapay zekâ kararlarının başarısı: kategori bazlı kararlar'), body.indexOf('## Yapay zekâ kararlarının başarısı: maç geneli'))
    expect(row(part, 'ChatGPT')).toEqual(['ChatGPT', '1', '%100 · n=1'])
    expect(part).toContain('Burada yalnızca şu kategorilerin kararları ölçülür: 2.5 ÜST, İLK YARI 0.5 ÜST, KG VAR.')
    expect(part).not.toContain('2.5 ÜST & KG VAR')
  })
})
