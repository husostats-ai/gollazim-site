import { describe, expect, it } from 'vitest'
import { CATEGORIES, defaultThresholds, isCategoryId, type CategoryId } from '../../config/categories'
import { CATEGORY_DESCRIPTIONS } from '../../config/categoryDescriptions'
import { fitLeague, LEAGUE_ABBREVIATIONS, leagueInitials, leagueShortName, splitLeague } from '../../config/leagueAbbreviations'
import { DEFAULT_STORY_TEXTS, normalizeStoryTexts, type StoryTexts } from '../../config/storyTexts'
import type { BackupFile, Match, MatchResult, Pick, PickOutcome, SharedPick } from '../../types'
import { analyzeCategory } from '../analysis/engine'
import { makeMatch } from '../analysis/testUtils'
import { isBackupFile } from '../data/backupFormat'
import { evaluatePick } from '../results/evaluator'
import { buildCategoryResult, resultDetail } from '../stats/categoryResult'
import { buildCaption, buildResultCaption, captionMatchLine, captionResultLine } from '../story/caption'
import { recordShare } from '../story/shared'
import { drawResultStory, resultSummaryText } from './resultStory'
import { fakeTextWidth, recordingContext, type DrawnText } from './recordingContext'
import { drawStory, STORY_NOTE, storyFromAnalysis, type StoryData, type StoryRow } from './storyGenerator'
import { asDense, fitTeamNames, FOOTER_GAP, HEADER, headerModeFor, planRows, SAFE_AREA, twoLinesFit } from './storyLayout'

const DAY = '2026-10-05'
const measureAt = (text: string, size: number) => fakeTextWidth(text, size)

describe('planRows (uyarlanır yerleşim)', () => {
  // Varsayılan alt blok yaklaşık 150 px (az maç) / 130 px (çok maç) yer kaplar
  const area = (count: number) => {
    const mode = headerModeFor(count)
    return { top: HEADER[mode].bottom, bottom: SAFE_AREA.bottom - (mode === 'large' ? 150 : 130) - FOOTER_GAP }
  }
  const plan = (count: number) => planRows(count, area(count).top, area(count).bottom)

  it.each([1, 2, 4, 8, 15])('%i maç: kartlar alanın içinde kalır', (count) => {
    const { top, bottom } = area(count)
    const p = plan(count)
    expect(p.top).toBeGreaterThanOrEqual(top)
    expect(p.top + count * p.rowHeight + (count - 1) * p.gap).toBeLessThanOrEqual(bottom)
  })

  it('az maçta (1–6) kartlar büyük ve ferah; okunabilirlik tabanları tutar', () => {
    for (const count of [1, 2, 3, 4, 5, 6]) {
      const p = plan(count)
      expect(p.mode, `${count} maç`).toBe('full')
      expect(p.teamSize, `${count} maç takım`).toBeGreaterThanOrEqual(40)
      expect(p.percentSize, `${count} maç yüzde`).toBeGreaterThanOrEqual(64)
      expect(p.metaSize, `${count} maç alt metin`).toBeGreaterThanOrEqual(24)
    }
  })

  it('maç sayısı arttıkça kart ve yazı küçülür', () => {
    const heights = [1, 2, 4, 8, 15].map((n) => plan(n).rowHeight)
    expect(heights).toEqual([...heights].sort((a, b) => b - a))
    expect(plan(1).rowHeight).toBe(420)
    expect(plan(2).rowHeight).toBe(340)
    expect(plan(4).teamSize).toBeGreaterThan(plan(8).teamSize)
    expect(plan(8).teamSize).toBeGreaterThan(plan(15).teamSize)
    expect(plan(15)).toMatchObject({ mode: 'dense', teamSize: 24, percentSize: 36 })
    expect(plan(15).rowHeight).toBeGreaterThanOrEqual(58)
  })

  it('kartlar alanı doldurmuyorsa blok dikeyde ortalanır', () => {
    const { top, bottom } = area(1)
    const p = plan(1)
    const above = p.top - top
    const below = bottom - (p.top + p.rowHeight)
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1)
    // 4 maç alanı doldurur: üstte ve altta boşluk kalmaz
    const four = plan(4)
    expect(four.top - area(4).top).toBeLessThanOrEqual(2)
  })

  it('üst blok az maçta büyük, çok maçta küçüktür', () => {
    expect([1, 5, 6, 15].map(headerModeFor)).toEqual(['large', 'large', 'compact', 'compact'])
    expect(HEADER.large.badge.top).toBeGreaterThanOrEqual(SAFE_AREA.top)
    expect(HEADER.compact.badge.top).toBeGreaterThanOrEqual(SAFE_AREA.top)
  })
})

describe('fitTeamNames (takım adını iki satıra bölme)', () => {
  const p = planRows(4, 586, 1500)
  const short = { home: 'Romania', away: 'Sweden' }
  const long = { home: 'Wolverhampton Wanderers U21', away: 'Brighton & Hove Albion U21' }

  it('sığan ad tek satırda kalır, sığmayan küçülmeden iki satıra bölünür', () => {
    const fit = fitTeamNames(p, [short, long], 900, measureAt)
    expect(fit.split).toEqual([false, true])
    expect(fit.size).toBe(p.teamSize)
    expect(fit.overflow).toBe(false)
  })

  it('tüm kartlarda aynı yazı boyutu kullanılır; tek bir ad satıra sığmıyorsa hepsi birlikte küçülür', () => {
    const fit = fitTeamNames(p, [short, long], 560, measureAt)
    expect(fit.size).toBeLessThan(p.teamSize)
    expect(fit.size).toBeGreaterThanOrEqual(p.teamMinSize)
    expect(measureAt(long.home, fit.size)).toBeLessThanOrEqual(560)
    expect(fit.overflow).toBe(false)
  })

  it('iki satır karta sığmıyorsa boyut küçülür; hiç sığmazsa taşma bildirilir', () => {
    const tight = planRows(8, 504, 1518)
    expect(tight.mode).toBe('full')
    expect(twoLinesFit(tight, tight.teamSize)).toBe(false)
    const fit = fitTeamNames(tight, [long], 400, measureAt)
    expect(fit.overflow).toBe(true)
    // Sıkışık düzende iki satır sığar ve ad kesilmez
    const dense = asDense(tight)
    expect(dense.mode).toBe('dense')
    const again = fitTeamNames(dense, [long], 520, measureAt)
    expect(again).toMatchObject({ overflow: false, split: [true] })
  })
})

describe('lig kısaltma', () => {
  const measure = (text: string) => [...text].length * 10

  it('tablodaki kısa adı kullanır; ülke sığıyorsa kalır', () => {
    expect(LEAGUE_ABBREVIATIONS['Professional Development League']).toBe('PDL')
    expect(fitLeague('England · Professional Development League', 400, measure)).toBe('England · PDL')
    expect(fitLeague('England · Professional Development League', 60, measure)).toBe('PDL')
    expect(fitLeague('England · EFL Trophy', 400, measure)).toBe('England · EFL Trophy')
    expect(fitLeague('england · efl trophy', 400, measure)).toBe('england · EFL Trophy')
  })

  it('tabloda yoksa sırayla: tam ad, ülkesiz ad, sözcük kısaltması, sondan sözcük atma, baş harfler', () => {
    const league = 'Germany · Regionalliga Nordost Qualification Playoffs'
    expect(fitLeague(league, 600, measure)).toBe(league)
    expect(fitLeague(league, 450, measure)).toBe('Regionalliga Nordost Qualification Playoffs')
    expect(fitLeague(league, 360, measure)).toBe('Regionalliga Nordost Qual. Playoffs')
    expect(fitLeague(league, 270, measure)).toBe('Regionalliga Nordost Qual.')
    expect(fitLeague(league, 200, measure)).toBe('Regionalliga Nordost')
    expect(fitLeague(league, 150, measure)).toBe('Germany · RNQP')
    expect(fitLeague(league, 50, measure)).toBe('RNQP')
  })

  it('hiçbir adımda "…" kullanmaz', () => {
    for (const width of [30, 80, 150, 250, 400, 800]) {
      for (const league of ['England · Professional Development League', 'Turkey · TFF Second League White Group', 'Xy', 'International · UEFA Nations League']) {
        expect(fitLeague(league, width, measure)).not.toContain('…')
      }
    }
  })

  it('yardımcılar', () => {
    expect(splitLeague('England · EFL Trophy')).toEqual({ country: 'England', name: 'EFL Trophy' })
    expect(splitLeague('Süper Lig')).toEqual({ country: '', name: 'Süper Lig' })
    expect(leagueInitials('Second Division North')).toBe('SDN')
    expect(leagueInitials('UEFA U21 Championship')).toBe('U U21C')
    expect(leagueShortName('England · Professional Development League')).toBe('PDL')
    expect(leagueShortName('Turkey · Süper Lig')).toBe('Süper Lig')
    expect(leagueShortName(undefined)).toBe('')
    expect(fitLeague(undefined, 100, measure)).toBe('')
  })
})

describe('kategori açıklama satırı, kazanma kuralıyla eşleşir', () => {
  const result = (values: Partial<MatchResult>): MatchResult => ({
    matchId: 'x',
    status: 'completed',
    htHome: 0,
    htAway: 0,
    ftHome: 0,
    ftAway: 0,
    cornersHome: 0,
    cornersAway: 0,
    cardsHome: 0,
    cardsAway: 0,
    updatedAt: '',
    ...values,
  })
  /** Açıklamadaki sayı: "3 veya daha fazla", "en az 1", "3+" */
  const threshold = (id: CategoryId) => Number(/\d+/.exec(CATEGORY_DESCRIPTIONS[id])![0])

  it('her kategorinin açıklaması vardır', () => {
    for (const c of CATEGORIES) expect(CATEGORY_DESCRIPTIONS[c.id], c.id).toMatch(/\S/)
    expect(Object.keys(CATEGORY_DESCRIPTIONS).sort()).toEqual(CATEGORIES.map((c) => c.id).sort())
  })

  it.each(['over25', 'over35', 'over45'] as const)('%s: "Maçta N veya daha fazla gol"', (id) => {
    const n = threshold(id)
    expect(CATEGORY_DESCRIPTIONS[id]).toBe(`Maçta ${n} veya daha fazla gol`)
    expect(evaluatePick(id, result({ ftHome: n, ftAway: 0 }))).toBe('won')
    expect(evaluatePick(id, result({ ftHome: n - 1, ftAway: 0 }))).toBe('lost')
  })

  it.each(['ht05', 'ht15'] as const)('%s: "İlk yarıda en az N gol"', (id) => {
    const n = threshold(id)
    expect(CATEGORY_DESCRIPTIONS[id]).toBe(`İlk yarıda en az ${n} gol`)
    expect(evaluatePick(id, result({ htHome: n, htAway: 0, ftHome: n, ftAway: 0 }))).toBe('won')
    expect(evaluatePick(id, result({ htHome: n - 1, htAway: 0, ftHome: 5, ftAway: 0 }))).toBe('lost')
  })

  it('2. Yarı 0.5 Üst: "İkinci yarıda en az 1 gol"', () => {
    expect(threshold('sh05')).toBe(1)
    expect(evaluatePick('sh05', result({ htHome: 2, htAway: 0, ftHome: 3, ftAway: 0 }))).toBe('won')
    expect(evaluatePick('sh05', result({ htHome: 2, htAway: 0, ftHome: 2, ftAway: 0 }))).toBe('lost')
  })

  it('KG Var ve 2.5 Üst & KG Var', () => {
    expect(evaluatePick('btts', result({ ftHome: 1, ftAway: 1 }))).toBe('won')
    expect(evaluatePick('btts', result({ ftHome: 4, ftAway: 0 }))).toBe('lost')
    expect(threshold('over25btts')).toBe(3)
    expect(evaluatePick('over25btts', result({ ftHome: 2, ftAway: 1 }))).toBe('won')
    expect(evaluatePick('over25btts', result({ ftHome: 3, ftAway: 0 }))).toBe('lost')
    expect(evaluatePick('over25btts', result({ ftHome: 1, ftAway: 1 }))).toBe('lost')
  })

  it.each(['corners85', 'corners95', 'corners105'] as const)('%s: "Maçta N veya daha fazla korner"', (id) => {
    const n = threshold(id)
    expect(CATEGORY_DESCRIPTIONS[id]).toBe(`Maçta ${n} veya daha fazla korner`)
    expect(evaluatePick(id, result({ cornersHome: n, cornersAway: 0 }))).toBe('won')
    expect(evaluatePick(id, result({ cornersHome: n - 1, cornersAway: 0 }))).toBe('lost')
  })

  it.each(['cards35', 'cards45'] as const)('%s: "Maçta N veya daha fazla kart (sarı + kırmızı)"', (id) => {
    const n = threshold(id)
    expect(CATEGORY_DESCRIPTIONS[id]).toBe(`Maçta ${n} veya daha fazla kart (sarı + kırmızı)`)
    expect(evaluatePick(id, result({ cardsHome: n - 1, cardsAway: 1 }))).toBe('won')
    expect(evaluatePick(id, result({ cardsHome: n - 1, cardsAway: 0 }))).toBe('lost')
  })

  it.each([
    ['homeWin15', 'Ev sahibi', 'home'],
    ['homeWin25', 'Ev sahibi', 'home'],
    ['awayWin15', 'Deplasman', 'away'],
    ['awayWin25', 'Deplasman', 'away'],
  ] as const)('%s: "%s kazanır ve maçta N veya daha fazla gol"', (id, side, key) => {
    const n = threshold(id)
    expect(CATEGORY_DESCRIPTIONS[id]).toBe(`${side} kazanır ve maçta ${n} veya daha fazla gol`)
    const score = (own: number, other: number) => (key === 'home' ? { ftHome: own, ftAway: other } : { ftHome: other, ftAway: own })
    expect(evaluatePick(id, result(score(n, 0)))).toBe('won')
    expect(evaluatePick(id, result(score(n - 1, 0)))).toBe('lost') // gol sayısı yetmez
    expect(evaluatePick(id, result(score(n, n)))).toBe('lost') // beraberlik
    expect(evaluatePick(id, result(score(0, n)))).toBe('lost') // diğer taraf kazanır
  })
})

const TEAMS = ['Galatasaray', 'Fenerbahçe', 'Peterborough United', 'Bosnia Herzegovina U21', 'İstanbul Başakşehir', 'Ipswich Town U21']
const storyRows = (count: number, long = false): StoryRow[] =>
  Array.from({ length: count }, (_, i) => ({
    home: long && i % 2 === 0 ? 'Borussia Mönchengladbach II' : TEAMS[i % TEAMS.length],
    away: long && i % 2 === 0 ? 'Eintracht Braunschweig Amateure' : TEAMS[(i + 3) % TEAMS.length],
    time: `${18 + (i % 4)}:${i % 2 ? '45' : '00'}`,
    league: i % 3 === 0 ? 'Germany · Regionalliga Nordost Qualification Playoffs' : 'England · Professional Development League',
    percent: 99 - i,
    stars: 5 - (i % 5),
  }))
const story = (count: number, long = false, categoryLabel = '2.5 ÜST'): StoryData => ({
  categoryLabel,
  description: 'Maçta 3 veya daha fazla gol',
  dateLabel: '6 Ekim 2026 Salı',
  rows: storyRows(count, long),
})

/** Yazının dikey sınırları: büyük harf yüksekliği boyutun ~%73'ü, kuyruk ~%22'si */
const extent = (t: DrawnText): [number, number] =>
  t.baseline === 'middle' ? [t.y - t.size * 0.42, t.y + t.size * 0.42] : [t.y - t.size * 0.73, t.y + t.size * 0.22]
const horizontal = (t: DrawnText): [number, number] =>
  t.align === 'right' ? [t.x - t.width, t.x] : t.align === 'center' ? [t.x - t.width / 2, t.x + t.width / 2] : [t.x, t.x + t.width]

const expectInsideSafeArea = (texts: DrawnText[]) => {
  for (const t of texts) {
    const [top, bottom] = extent(t)
    expect(top, `"${t.text}" üstten taşıyor`).toBeGreaterThanOrEqual(SAFE_AREA.top)
    expect(bottom, `"${t.text}" alttan taşıyor`).toBeLessThanOrEqual(SAFE_AREA.bottom)
    const [from, to] = horizontal(t)
    expect(from, `"${t.text}" soldan taşıyor`).toBeGreaterThanOrEqual(SAFE_AREA.left)
    expect(to, `"${t.text}" sağdan taşıyor`).toBeLessThanOrEqual(SAFE_AREA.right)
  }
}

describe('drawStory: kategori görseli', () => {
  const draw = (data: StoryData, texts?: StoryTexts) => {
    const recorded = recordingContext()
    drawStory(recorded.ctx, data, null, texts)
    return recorded.texts
  }

  it.each([1, 2, 4, 8, 15])('%i maç: tüm yazılar güvenli alanda (250–1670 px) ve yan boşlukların içinde', (count) => {
    expectInsideSafeArea(draw(story(count)))
    expectInsideSafeArea(draw(story(count, true)))
    expectInsideSafeArea(draw(story(count, true, 'DEPLASMAN KAZANIR & 2.5 ÜST')))
  })

  it('başlığın altında açıklama, maç sayısı ve bir kez "Saatler TSİ" yazar', () => {
    const texts = draw(story(4)).map((t) => t.text)
    expect(texts).toContain('Maçta 3 veya daha fazla gol')
    expect(texts).toContain('6 Ekim 2026 Salı  •  4 maç  •  Saatler TSİ')
    expect(texts.filter((t) => t.includes('TSİ'))).toHaveLength(1)
  })

  it('maç kümesi ve sırası veriyle aynıdır: her maç bir kez, verilen sırayla ve sıra numarasıyla', () => {
    for (const count of [1, 4, 8, 15]) {
      const data = story(count)
      const texts = draw(data)
      // Sıra numaraları 1..n, yukarıdan aşağıya
      const ranks = texts.filter((t) => /^\d+$/.test(t.text) && t.align === 'center')
      expect(ranks.map((t) => t.text)).toEqual(data.rows.map((_, i) => String(i + 1)))
      expect(ranks.map((t) => t.y)).toEqual([...ranks.map((t) => t.y)].sort((a, b) => a - b))
      // Yüzdeler aynı sırada
      expect(texts.filter((t) => /^%\d+$/.test(t.text)).map((t) => t.text)).toEqual(data.rows.map((r) => `%${r.percent}`))
      // Her maçın ev sahibi adı görselde geçer
      const all = texts.map((t) => t.text).join('\n')
      for (const row of data.rows) expect(all).toContain(row.home)
    }
  })

  it('uzun takım adı kesilmez, iki satıra bölünür; tüm kartlarda aynı yazı boyutu kullanılır', () => {
    for (const count of [4, 8, 15]) {
      const texts = draw(story(count, true))
      expect(texts.some((t) => t.text === 'Borussia Mönchengladbach II')).toBe(true)
      expect(texts.some((t) => t.text === 'Eintracht Braunschweig Amateure')).toBe(true)
      const teamSizes = new Set(texts.filter((t) => TEAMS.some((name) => t.text.includes(name)) || t.text.startsWith('Borussia') || t.text.startsWith('Eintracht')).map((t) => t.size))
      expect(teamSizes.size, `${count} maç`).toBe(1)
    }
  })

  it('lig adı "…" ile kesilmez', () => {
    for (const count of [1, 4, 6]) {
      const meta = draw(story(count, true)).filter((t) => /^\d\d:\d\d {2}· {2}/.test(t.text))
      expect(meta).toHaveLength(count)
      for (const t of meta) expect(t.text).not.toContain('…')
    }
  })

  it('alt blok ayarlardan gelir; boş ayarın satırı çizilmez, uyarı boşsa varsayılan not yazar', () => {
    const withDefaults = draw(story(4)).map((t) => t.text)
    expect(withDefaults).toEqual(expect.arrayContaining(['Telegram:', DEFAULT_STORY_TEXTS.telegram, 'Instagram:', DEFAULT_STORY_TEXTS.instagram]))
    expect(withDefaults.some((t) => DEFAULT_STORY_TEXTS.disclaimer.startsWith(t))).toBe(true)
    expect(withDefaults).not.toContain(STORY_NOTE)

    const empty = draw(story(4), { telegram: '', instagram: '', disclaimer: '', hashtags: '#x' }).map((t) => t.text)
    expect(empty).not.toContain('Telegram:')
    expect(empty).not.toContain('Instagram:')
    expect(empty).toContain(STORY_NOTE)
    expect(empty.join(' ')).not.toContain('#x')

    const onlyInstagram = draw(story(4), { ...DEFAULT_STORY_TEXTS, telegram: '' }).map((t) => t.text)
    expect(onlyInstagram).toContain('Instagram:')
    expect(onlyInstagram).not.toContain('Telegram:')
  })

  it('analizden gelen görsel verisi: açıklama eklenir, maçlar analizdeki sırayla kalır', () => {
    const matches = [makeMatch({ over25Pct: 80 }, { id: 'a' }), makeMatch({ over25Pct: 95 }, { id: 'b' }), makeMatch({ over25Pct: 88 }, { id: 'c' })]
    const analysis = analyzeCategory(matches, 'over25', 75)
    const data = storyFromAnalysis(analysis, '5 Ekim 2026 Pazartesi')
    expect(data.description).toBe(CATEGORY_DESCRIPTIONS.over25)
    expect(data.rows.map((r) => r.percent)).toEqual([95, 88, 80])
    expect(data.rows.map((r) => r.home)).toEqual(analysis.predictions.map((p) => p.match.home))
  })
})

let n = 0
const pick = (matchId: string, outcome: PickOutcome, percent = 80, categoryId: CategoryId = 'ht05', date = DAY): Pick => ({
  id: `p${++n}`,
  matchId,
  categoryId,
  date,
  percent,
  threshold: 75,
  outcome,
  frozenAt: '',
})
const match = (id: string, time = '20:00'): Match => ({ id, uploadId: 'u', date: DAY, time, home: `Ev ${id}`, away: `Dep ${id}`, league: 'England · EFL Trophy', stats: {} })
const done = (matchId: string, values: Partial<MatchResult> = {}): MatchResult => ({
  matchId,
  status: 'completed',
  htHome: 1,
  htAway: 0,
  ftHome: 2,
  ftAway: 1,
  cornersHome: null,
  cornersAway: null,
  cardsHome: null,
  cardsAway: null,
  updatedAt: '',
  ...values,
})

describe('buildCategoryResult (kategori sonuç görseli hesabı)', () => {
  const matches = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => match(id))
  const picks = [
    pick('a', 'won', 95),
    pick('b', 'lost', 90),
    pick('c', 'won', 85),
    pick('d', 'void', 80),
    pick('e', 'pending', 78), // skor sonradan "tamamlanmadı"ya çekildi
    pick('a', 'lost', 99, 'over25'), // başka kategori
    pick('a', 'lost', 99, 'ht05', '2026-10-04'), // başka gün
  ]
  const results: Record<string, MatchResult> = {
    a: done('a'),
    b: done('b', { htHome: 0, htAway: 0 }),
    c: done('c'),
    d: done('d', { htHome: null, htAway: null }),
    e: done('e', { status: 'pending' }),
  }
  const shared: SharedPick[] = recordShare([], { date: DAY, categoryId: 'ht05', matches: [match('a'), match('b'), match('d'), match('f')], now: '2026-10-05T09:00:00.000Z' })
  const base = { date: DAY, categoryId: 'ht05' as const, picks, shared, matches, results }

  it('tüm öneriler: özet yalnızca tuttu + tutmadı üzerinden; değerlendirilemedi ve bekleyen sayılmaz', () => {
    const result = buildCategoryResult({ ...base, scope: 'all', recommendedIds: ['a', 'f'] })
    expect(result.tally).toMatchObject({ won: 2, decided: 3, void: 1, pending: 1 })
    expect(resultSummaryText(result.tally)).toBe('2/3 · %67')
    expect(result.rows.map((r) => [r.matchId, r.status])).toEqual([
      ['a', 'won'],
      ['b', 'lost'],
      ['c', 'won'],
      ['d', 'void'],
      ['e', 'pending'],
      ['f', 'pending'], // listede, skoru girilmemiş
    ])
    expect(result.unsettled).toBe(2)
  })

  it('paylaşılan öneriler: yalnızca bu kategoride paylaşılan maçlar', () => {
    const result = buildCategoryResult({ ...base, scope: 'shared' })
    expect(result.rows.map((r) => [r.matchId, r.status])).toEqual([
      ['a', 'won'],
      ['b', 'lost'],
      ['d', 'void'],
      ['f', 'pending'], // paylaşıldı, skoru girilmedi
    ])
    expect(result.tally).toMatchObject({ won: 1, decided: 2 })
    expect(resultSummaryText(result.tally)).toBe('1/2 · %50')
    expect(result.unsettled).toBe(1)
  })

  it('skor, yarı skoru ve korner/kart sayısı', () => {
    const result = buildCategoryResult({ ...base, scope: 'all' })
    expect(result.rows[0]).toMatchObject({ home: 'Ev a', away: 'Dep a', score: '2-1', detail: 'İY 1-0' })
    expect(result.rows[1]).toMatchObject({ score: '2-1', detail: 'İY 0-0' })
    expect(result.rows[3]).toMatchObject({ status: 'void', score: '2-1', detail: '' })
    expect(result.rows[4]).toMatchObject({ status: 'pending', score: null })
    expect(resultDetail('sh05', done('x', { htHome: 1, htAway: 0, ftHome: 3, ftAway: 1 }))).toBe('2Y 2-1')
    expect(resultDetail('corners95', done('x', { cornersHome: 6, cornersAway: 5 }))).toBe('Korner 11')
    expect(resultDetail('corners95', done('x'))).toBe('')
    expect(resultDetail('cards35', done('x', { cardsHome: 3, cardsAway: 2 }))).toBe('Kart 5')
    expect(resultDetail('over25', done('x'))).toBe('')
    expect(resultDetail('ht05', undefined)).toBe('')
  })

  it('ertelenen / iptal maç ve dondurulmamış paylaşım "değerlendirilemedi" sayılır', () => {
    const postponed = buildCategoryResult({ ...base, scope: 'all', results: { ...results, e: done('e', { status: 'postponed' }) } })
    expect(postponed.rows.find((r) => r.matchId === 'e')!.status).toBe('void')
    // f paylaşıldı, skoru girildi ama dondurulmuş önerisi yok
    const noPick = buildCategoryResult({ ...base, scope: 'shared', results: { ...results, f: done('f') } })
    expect(noPick.rows.find((r) => r.matchId === 'f')!.status).toBe('void')
    expect(noPick.tally).toMatchObject({ won: 1, decided: 2 })
    expect(noPick.unsettled).toBe(0)
  })

  it('hiç öneri yoksa özet boştur ("—")', () => {
    const result = buildCategoryResult({ ...base, categoryId: 'cards45', scope: 'all' })
    expect(result.rows).toEqual([])
    expect(resultSummaryText(result.tally)).toBe('—')
  })
})

describe('drawResultStory: sonuç görseli', () => {
  const many = (count: number, long = false) => {
    const ids = Array.from({ length: count }, (_, i) => `m${i}`)
    const outcomes: PickOutcome[] = ['won', 'lost', 'void', 'won']
    return buildCategoryResult({
      date: DAY,
      categoryId: 'ht05',
      scope: 'all',
      picks: ids.map((id, i) => pick(id, outcomes[i % 4], 99 - i)),
      shared: [],
      matches: ids.map((id, i) => (long && i % 2 === 0 ? { ...match(id), home: 'Borussia Mönchengladbach II', away: 'Eintracht Braunschweig Amateure' } : match(id))),
      results: Object.fromEntries(ids.map((id) => [id, done(id)])),
      recommendedIds: count > 2 ? ['bekleyen'] : [],
    })
  }
  const draw = (result: ReturnType<typeof many>) => {
    const recorded = recordingContext()
    drawResultStory(recorded.ctx, result, '5 Ekim 2026', null)
    return recorded
  }

  it.each([0, 1, 4, 8, 15])('%i maç: tüm yazılar güvenli alanda', (count) => {
    expectInsideSafeArea(draw(many(count)).texts)
    expectInsideSafeArea(draw(many(count, true)).texts)
  })

  it('başlık, özet, skorlar ve durum yazıları', () => {
    const result = many(4)
    const texts = draw(result).texts.map((t) => t.text)
    expect(texts).toEqual(expect.arrayContaining(['5 EKİM 2026', 'İLK YARI 0.5 ÜST', 'SONUÇLARI', 'İlk yarıda en az 1 gol', '2/3 · %67', '2-1']))
    expect(texts).toContain('Tüm önerilerin sonuçları  •  5 maç')
    expect(texts).toContain('Tuttu  ·  İY 1-0')
    expect(texts).toContain('Tutmadı  ·  İY 1-0')
    expect(texts).toContain('Değerlendirilemedi  ·  İY 1-0')
    expect(texts).toContain('Bekliyor')
    expect(texts.filter((t) => t === '—')).toHaveLength(1) // skoru girilmemiş maçın skoru
  })

  it('sonuç yalnızca renkle değil, işaretle de ayrılır (✓ / ✗ / — / ···)', () => {
    const { calls } = draw(many(4))
    // Her satır için bir işaret dairesi ve beyaz çizgiler çizilir; tuttu iki parçalı, tutmadı iki çizgi
    const strokes = calls.filter(([name]) => name === 'lineTo').length
    expect(strokes).toBeGreaterThanOrEqual(2 + 2 + 1 + 2 + 3)
    const fills = calls.filter(([name, prop, value]) => name === '=' && prop === 'fillStyle' && (value === '#22c55e' || value === '#ef4444'))
    expect(fills.length).toBeGreaterThanOrEqual(3)
  })

  it('boş ölçüde özet "—" ve açıklayıcı metin çıkar', () => {
    const texts = draw(many(0)).texts.map((t) => t.text)
    expect(texts).toContain('—')
    expect(texts).toContain('Bu ölçüde öneri yok')
  })
})

describe('açıklama metni üretimi', () => {
  const matches = [
    { time: '15:00', home: 'Bristol City U21', away: 'Charlton Athletic U21', league: 'England · Professional Development League', percent: 100 },
    { time: '21:45', home: 'Croatia', away: 'Spain', league: 'International · UEFA Nations League', percent: 92 },
  ]
  const texts: StoryTexts = { ...DEFAULT_STORY_TEXTS, hashtags: '#futbol #istatistik' }
  const build = (target: 'instagram' | 'telegram', t = texts) => buildCaption({ target, categoryId: 'over25', dateLabel: '6 Ekim 2026 Salı', matches, texts: t })

  it('maç satırı: saat – takımlar – lig kısaltması – yüzde', () => {
    expect(captionMatchLine(matches[0])).toBe('15:00 – Bristol City U21 – Charlton Athletic U21 – PDL – %100')
    expect(captionMatchLine({ home: 'A', away: 'B', percent: 80 })).toBe('A – B – %80')
  })

  it('Instagram açıklaması', () => {
    expect(build('instagram')).toBe(
      [
        'GÜNÜN 2.5 ÜST ÖNERİLERİ',
        '6 Ekim 2026 Salı · Saatler TSİ',
        'Maçta 3 veya daha fazla gol',
        '',
        '15:00 – Bristol City U21 – Charlton Athletic U21 – PDL – %100',
        '21:45 – Croatia – Spain – Nations League – %92',
        '',
        DEFAULT_STORY_TEXTS.disclaimer,
        '',
        'Telegram: https://t.me/gollazimanaliz',
        '',
        '#futbol #istatistik',
      ].join('\n'),
    )
  })

  it('Telegram mesajı: Instagram hesabı yazar, hashtag eklenmez', () => {
    const text = build('telegram')
    expect(text).toContain('Instagram: @gollazim')
    expect(text).not.toContain('Telegram:')
    expect(text).not.toContain('#')
  })

  it('boş ayarın satırı yazılmaz; uyarı boşsa varsayılan not kullanılır; varsayılanda hashtag yoktur', () => {
    const bare = build('instagram', { telegram: '', instagram: '', disclaimer: '', hashtags: '' })
    expect(bare).not.toContain('Telegram')
    expect(bare).toContain(STORY_NOTE)
    expect(bare.endsWith(STORY_NOTE)).toBe(true)
    expect(build('instagram', DEFAULT_STORY_TEXTS)).not.toContain('#')
  })

  it('varsayılan şablonda bahis dili yoktur', () => {
    const all = [build('instagram', DEFAULT_STORY_TEXTS), build('telegram', DEFAULT_STORY_TEXTS)].join('\n').toLocaleLowerCase('tr')
    // "bahis tavsiyesi değildir" uyarısı dışında
    const withoutDisclaimer = all.split(DEFAULT_STORY_TEXTS.disclaimer.toLocaleLowerCase('tr')).join('')
    for (const word of ['bahis', 'kupon', 'banko', 'oran', 'iddaa', 'kazanç']) expect(withoutDisclaimer, word).not.toContain(word)
  })

  it('sonuç metni: özet ve maç / skor / işaret listesi', () => {
    const result = buildCategoryResult({
      date: DAY,
      categoryId: 'ht05',
      scope: 'shared',
      picks: [pick('a', 'won', 95), pick('b', 'lost', 90), pick('d', 'void', 80)],
      shared: recordShare([], { date: DAY, categoryId: 'ht05', matches: [match('a'), match('b'), match('d'), match('f')], now: '2026-10-05T09:00:00.000Z' }),
      matches: ['a', 'b', 'd', 'f'].map((id) => match(id)),
      results: { a: done('a'), b: done('b', { htHome: 0 }), d: done('d', { htHome: null, htAway: null }) },
    })
    expect(result.rows.map(captionResultLine)).toEqual([
      '✓ Ev a – Dep a 2-1 (İY 1-0)',
      '✗ Ev b – Dep b 2-1 (İY 0-0)',
      '— Ev d – Dep d · Değerlendirilemedi',
      '… Ev f – Dep f · Bekliyor',
    ])
    const text = buildResultCaption({ target: 'instagram', result, dateLabel: '5 Ekim 2026', texts })
    expect(text.split('\n').slice(0, 6)).toEqual([
      'İLK YARI 0.5 ÜST SONUÇLARI',
      '5 Ekim 2026',
      'İlk yarıda en az 1 gol',
      'Paylaşılan önerilerin sonuçları',
      '',
      'İsabet: 1/2 · %50',
    ])
    expect(text).toContain('#futbol #istatistik')
    expect(buildResultCaption({ target: 'telegram', result, dateLabel: '5 Ekim 2026', texts })).not.toContain('#')
  })
})

describe('ayarlar: hashtagler ve yedek', () => {
  it('varsayılan boştur; kayıtlı değer korunur', () => {
    expect(DEFAULT_STORY_TEXTS.hashtags).toBe('')
    expect(normalizeStoryTexts({ hashtags: ' #a #b ' }).hashtags).toBe('#a #b')
    // Hashtag alanı olmayan eski kayıt
    expect(normalizeStoryTexts({ telegram: 'x' })).toEqual({ ...DEFAULT_STORY_TEXTS, telegram: 'x' })
  })

  it('metin ayarları yedekten aynen geri gelir', () => {
    const saved: StoryTexts = { telegram: 't', instagram: '@i', disclaimer: 'u', hashtags: '#h' }
    const file = JSON.parse(
      JSON.stringify({ app: 'gollazim', version: 1, exportedAt: '', uploads: [], matches: [], results: [], picks: [], thresholds: defaultThresholds(), storyTexts: saved }),
    ) as BackupFile
    expect(isBackupFile(file)).toBe(true)
    expect(normalizeStoryTexts(file.storyTexts)).toEqual(saved)
    expect(isCategoryId('over25')).toBe(true)
  })
})
