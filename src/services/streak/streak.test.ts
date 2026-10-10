import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isCategoryId, type CategoryId } from '../../config/categories'
import type { MatchResult, MatchStatus, Pick, StreakStep } from '../../types'
import { assembleBackup, isBackupFile } from '../data/backupFormat'
import { MEMBER_STREAK_STATES, MEMBER_STREAK_TEXTS } from '../member/labels'
import { MEMBER_STREAK_LOW_SAMPLE } from '../member/schema'
import {
  addStreakStep,
  buildStreak,
  deleteStreakStep,
  deletionBlock,
  markStreakPublished,
  normalizeStreakSteps,
  observeOutcomes,
  removalReasonOf,
  removePendingStep,
  STREAK_LOW_SAMPLE_LIMIT,
  streakStepId,
  syncStepSchedule,
  undoBlock,
  undoRemoval,
  type StreakCandidate,
  type StreakView,
} from './streak'
import { factsFrom } from './streakFacts'
import { STREAK_BUTTON_TEXTS, STREAK_NOTE, STREAK_PANEL_TEXTS, STREAK_REFUSAL_TEXTS, STREAK_STATE_LABELS, STREAK_TITLE } from './texts'

// "Seri takibi": tek bekleyen kuralı, kilit, serilerin adımlardan türetilmesi, skor düzeltmesi,
// kaldırma (oynanmadı), silinen maç, sayılar, yedek ve dil.

const DAY = '2026-10-08'
const idOf = (home: string) => `${DAY}|${home}|Rakip`
const candidate = (home: string, time: string | null = '20:00', categoryId: CategoryId = 'over25', date = DAY): StreakCandidate => ({ match: { id: `${date}|${home}|Rakip`, date, time: time ?? undefined, league: 'Testland · Deneme Ligi', home, away: 'Rakip' }, categoryId })
// 20:00 TSİ = 17:00 UTC
const BEFORE = new Date('2026-10-08T16:59:59.000Z')
const AT = new Date('2026-10-08T17:00:00.000Z')
const AFTER = new Date('2026-10-08T19:30:00.000Z')

/** Küçük bir veri deposu: adımlar, maçlar, skorlar ve dondurulmuş öneriler */
class World {
  steps: StreakStep[] = []
  matches = new Set<string>()
  results = new Map<string, MatchResult>()
  picks: Pick[] = []

  view(): StreakView {
    return buildStreak(this.steps, factsFrom({ matches: [...this.matches].map((id) => ({ id })), results: [...this.results.values()], picks: this.picks }))
  }
  /** Görülen kesin sonuçları kayda işler (uygulamada her okumada yapılır) */
  observe(now = '2026-10-08T21:00:00.000Z'): void {
    this.put(observeOutcomes(this.view().steps, now))
  }
  put(records: StreakStep[]): void {
    for (const record of records) this.steps = [...this.steps.filter((s) => s.id !== record.id), record].sort((a, b) => a.seq - b.seq)
  }
  add(home: string, now = BEFORE, time = '20:00', categoryId: CategoryId = 'over25') {
    const c = candidate(home, time, categoryId)
    this.matches.add(c.match.id)
    const result = addStreakStep(this.view(), c, now)
    if (result.ok) this.put([result.record])
    return result
  }
  /** Skor girer: 3-1 tutar, 0-0 tutmaz (2.5 üst) */
  score(home: string, won: boolean | null, status: MatchStatus = 'completed'): void {
    const goals = won === null ? { ftHome: null, ftAway: null } : won ? { ftHome: 3, ftAway: 1 } : { ftHome: 0, ftAway: 0 }
    this.results.set(idOf(home), { matchId: idOf(home), status, htHome: null, htAway: null, cornersHome: null, cornersAway: null, cardsHome: null, cardsAway: null, updatedAt: '2026-10-08T20:00:00.000Z', ...goals })
    this.observe()
  }
  /** Sırayla ekler ve sonuçlandırır: 'W' tuttu, 'L' tutmadı */
  play(pattern: string): void {
    ;[...pattern].forEach((letter) => {
      const home = `T${this.steps.length}`
      const added = this.add(home)
      if (!added.ok) throw new Error(`${home}: ${added.reason}`)
      this.score(home, letter === 'W')
    })
  }
  deleteMatch(home: string): void {
    this.matches.delete(idOf(home))
    this.results.delete(idOf(home))
    this.picks = this.picks.filter((p) => p.matchId !== idOf(home))
  }
}

const states = (view: StreakView) => view.steps.map((s) => s.state)
const lengths = (view: StreakView) => view.past.map((r) => r.length)

describe('seriye gönderme', () => {
  it('kayıt: maç, kategori, sıra, eklenme zamanı ve görünüm; yüzde ve güvenilirlik kayda girmez', () => {
    const world = new World()
    const result = world.add('Kuzey')
    expect(result).toEqual({ ok: true, record: { id: `${idOf('Kuzey')}|over25`, matchId: idOf('Kuzey'), categoryId: 'over25', seq: 1, addedAt: BEFORE.toISOString(), date: DAY, home: 'Kuzey', away: 'Rakip', time: '20:00', league: 'Testland · Deneme Ligi' } })
    expect(streakStepId(idOf('Kuzey'), 'over25')).toBe(`${idOf('Kuzey')}|over25`)
  })

  it('maç başladıysa (tam saatinde de) ve saati yoksa gönderilemez', () => {
    const world = new World()
    expect(world.add('Kuzey', AT)).toEqual({ ok: false, reason: 'locked' })
    expect(world.add('Kuzey', AFTER)).toEqual({ ok: false, reason: 'locked' })
    expect(addStreakStep(world.view(), candidate('Saatsiz', null), BEFORE)).toEqual({ ok: false, reason: 'no-time' })
    expect(world.steps).toEqual([])
  })

  it('TEK BEKLEYEN: bekleyen adım sonuçlanmadan başka maç gönderilemez; sonuçlanınca aynı gün yenisi gönderilir', () => {
    const world = new World()
    expect(world.add('Erken', new Date('2026-10-08T09:00:00.000Z'), '14:00').ok).toBe(true)
    expect(world.add('Gec')).toEqual({ ok: false, reason: 'blocked' })
    expect(world.view().blocker?.record.home).toBe('Erken')
    expect(STREAK_REFUSAL_TEXTS.blocked).toBe('Önceki adım sonuçlanmadı.')
    world.score('Erken', true)
    expect(world.view().blocker).toBeNull()
    expect(world.add('Gec').ok).toBe(true)
    expect(world.steps.map((s) => s.seq).sort()).toEqual([1, 2])
  })

  it('ertelenen ya da skoru girilmeyen maç bekler: seri bozulmaz, yeni gönderim kapalı kalır', () => {
    const world = new World()
    world.play('W')
    world.add('Ertelenen')
    world.score('Ertelenen', null, 'postponed')
    expect(states(world.view())).toEqual(['won', 'pending'])
    expect(world.view().totals).toMatchObject({ current: 1, count: 0 })
    expect(world.add('Yeni')).toEqual({ ok: false, reason: 'blocked' })
  })

  it('aynı öneri seride bir kez yer alır: sonuçlandıktan ya da kaldırıldıktan sonra da yeniden gönderilemez', () => {
    const world = new World()
    world.add('Kuzey')
    expect(world.add('Kuzey')).toEqual({ ok: false, reason: 'exists' })
    world.score('Kuzey', true)
    expect(addStreakStep(world.view(), candidate('Kuzey'), BEFORE)).toEqual({ ok: false, reason: 'exists' })
  })
})

describe('seriler adımlardan türetilir', () => {
  it('tutan adım seriyi ilerletir (1 → 2 → 3); tutmayan adım seriyi bitirir ve geçmişe geçer', () => {
    const world = new World()
    world.play('WWW')
    let view = world.view()
    expect(view.steps.map((s) => s.step)).toEqual([1, 2, 3])
    expect(view.current?.length).toBe(3)
    expect(view.past).toEqual([])
    world.play('L')
    view = world.view()
    expect(view.current).toBeNull()
    expect(lengths(view)).toEqual([3])
    expect(view.past[0].ended).toBe(true)
    // Tutmayan maç silinmez: serinin son adımı olarak kayıtta durur.
    expect(view.past[0].steps.map((s) => s.state)).toEqual(['won', 'won', 'won', 'lost'])
    expect(view.past[0].steps[3].step).toBe(4)
    world.play('W')
    expect(world.view().current?.steps.map((s) => s.step)).toEqual([1])
  })

  it('ilk adımda biten seri 0 uzunlukla sayılır', () => {
    const world = new World()
    world.play('LWWL')
    const { totals, past } = world.view()
    expect(past.map((r) => r.length)).toEqual([0, 2])
    expect(totals).toEqual({ longest: 2, current: 0, count: 2, mean: 1, won: 2, lost: 2, lowSample: true })
  })

  it('sayılar: en uzun (mevcut seri dahil), mevcut, biten seri, seri başına tutan (bir ondalık), tuttu / tutmadı', () => {
    const world = new World()
    world.play('WWLWLLWWWW')
    expect(world.view().totals).toEqual({ longest: 4, current: 4, count: 3, mean: 1, won: 7, lost: 3, lowSample: true })
    world.play('L')
    // Biten seriler: 2, 1, 0, 4 → 7 / 4 = 1,75 → 1,8
    expect(world.view().totals).toEqual({ longest: 4, current: 0, count: 4, mean: 1.8, won: 7, lost: 4, lowSample: true })
    expect(new World().view().totals).toEqual({ longest: 0, current: 0, count: 0, mean: null, won: 0, lost: 0, lowSample: true })
  })

  it('az örnek: biten seri sayısı 20\'den azken uyarı; 20 olunca kalkar', () => {
    expect(STREAK_LOW_SAMPLE_LIMIT).toBe(20)
    expect(MEMBER_STREAK_LOW_SAMPLE).toBe(STREAK_LOW_SAMPLE_LIMIT)
    const world = new World()
    world.play('L'.repeat(19))
    expect(world.view().totals).toMatchObject({ count: 19, lowSample: true })
    world.play('WL')
    expect(world.view().totals).toMatchObject({ count: 20, lowSample: false })
  })

  it('sıra yalnızca gönderim sırasıdır: başlama saati ve sonuçlanma anı sırayı değiştirmez', () => {
    const world = new World()
    world.add('Gec', new Date('2026-10-08T09:00:00.000Z'), '22:00')
    world.score('Gec', true)
    world.add('Erken', new Date('2026-10-08T09:01:00.000Z'), '13:00')
    world.score('Erken', false)
    // Aynı dakikada (aynı updatedAt ile) sonuçlandılar; kayıtlar ters sırada verilse de sonuç aynıdır.
    expect(world.view().past[0].steps.map((s) => s.record.home)).toEqual(['Gec', 'Erken'])
    world.steps.reverse()
    expect(world.view().past[0].steps.map((s) => s.record.home)).toEqual(['Gec', 'Erken'])
    expect(lengths(world.view())).toEqual([1])
  })

  it('sonuç dondurulmuş öneriden gelir; öneri yoksa aynı değerlendirme fonksiyonu', () => {
    const world = new World()
    world.add('Kuzey')
    world.score('Kuzey', false)
    expect(states(world.view())).toEqual(['lost'])
    // Dondurulmuş öneri skorla çelişse de (olmaz ama) öneri geçerlidir.
    world.picks = [{ id: `${idOf('Kuzey')}|over25`, matchId: idOf('Kuzey'), categoryId: 'over25', date: DAY, percent: 80, threshold: 70, outcome: 'won', frozenAt: '2026-10-08T20:00:00.000Z' }]
    expect(states(world.view())).toEqual(['won'])
  })
})

describe('skor sonradan düzeltilirse seri geriye dönük yeniden hesaplanır', () => {
  it('tutan adım tutmayana dönerse seri o adımda bölünür; sonraki adımlar yeni seridir', () => {
    const world = new World()
    world.play('WWWW')
    expect(world.view().totals).toMatchObject({ current: 4, count: 0 })
    world.score('T1', false)
    const view = world.view()
    expect(lengths(view)).toEqual([1])
    expect(view.current?.steps.map((s) => [s.record.home, s.step])).toEqual([['T2', 1], ['T3', 2]])
    expect(view.totals).toEqual({ longest: 2, current: 2, count: 1, mean: 1, won: 3, lost: 1, lowSample: true })
  })

  it('tutmayan adım tutana dönerse iki seri birleşir', () => {
    const world = new World()
    world.play('WWLWW')
    expect(lengths(world.view())).toEqual([2])
    world.score('T2', true)
    const view = world.view()
    expect(view.past).toEqual([])
    expect(view.current?.steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5])
    expect(view.totals).toMatchObject({ longest: 5, current: 5, count: 0, mean: null, lost: 0 })
  })

  it('düzeltilen adım "düzeltildi" olarak işaretlenir; ilk sonuç ve aynı sonucun yeniden girilmesi işaretlemez', () => {
    const world = new World()
    world.play('WW')
    expect(world.steps.every((s) => s.lastOutcome === 'won' && s.revisedAt === undefined)).toBe(true)
    world.score('T0', true)
    expect(world.steps.some((s) => s.revisedAt !== undefined)).toBe(false)
    world.score('T0', false)
    const revised = world.steps.find((s) => s.home === 'T0')!
    expect(revised).toMatchObject({ lastOutcome: 'lost', revisedAt: '2026-10-08T21:00:00.000Z' })
    expect(world.steps.find((s) => s.home === 'T1')!.revisedAt).toBeUndefined()
    expect(observeOutcomes(world.view().steps, 'x')).toEqual([])
  })

  it('skor silinirse adım yeniden bekler ve yeni gönderimi engeller; ortadaki bekleyen seriyi bozmaz', () => {
    const world = new World()
    world.play('WWW')
    world.results.delete(idOf('T1'))
    const view = world.view()
    expect(states(view)).toEqual(['won', 'pending', 'won'])
    expect(view.totals).toMatchObject({ current: 2, count: 0 })
    expect(view.steps.map((s) => s.step)).toEqual([1, 2, 3])
    expect(view.blocker?.record.home).toBe('T1')
    expect(world.add('Yeni')).toEqual({ ok: false, reason: 'blocked' })
    // İki bekleyen de tolere edilir: engel ilk bekleyendir.
    world.results.delete(idOf('T2'))
    expect(states(world.view())).toEqual(['won', 'pending', 'pending'])
    expect(world.view().blocker?.record.home).toBe('T1')
  })
})

describe('maç silinirse', () => {
  it('sonuçlanmış adımın sonucu kayıttan okunur: seri değişmez, yeni gönderim engellenmez', () => {
    const world = new World()
    world.play('WWL')
    world.play('W')
    const before = world.view().totals
    for (const home of ['T0', 'T1', 'T2', 'T3']) world.deleteMatch(home)
    const view = world.view()
    expect(states(view)).toEqual(['won', 'won', 'lost', 'won'])
    expect(view.steps.every((s) => !s.matchExists)).toBe(true)
    expect(view.totals).toEqual(before)
    expect(view.blocker).toBeNull()
  })

  it('bekleyen adımın maçı silinirse adım bekler; "oynanmadı" olarak kaldırılabilir', () => {
    const world = new World()
    world.add('Kuzey')
    world.deleteMatch('Kuzey')
    const [step] = world.view().steps
    expect(step.state).toBe('pending')
    expect(removalReasonOf(step)).toBe('unplayed')
  })

  it('maç duruyorken skoru silinen adım kayıttaki eski sonuca dönmez (bekler)', () => {
    const world = new World()
    world.play('W')
    world.results.delete(idOf('T0'))
    expect(states(world.view())).toEqual(['pending'])
  })
})

describe('kilit ve geri alma', () => {
  it('maç başlamadan ve yayınlanmadan önce adım silinir; başlayınca ya da yayınlanınca silinemez', () => {
    const world = new World()
    world.add('Kuzey')
    const id = world.steps[0].id
    expect(deletionBlock(world.steps[0], BEFORE)).toBeNull()
    expect(deleteStreakStep(world.view(), id, AT)).toEqual({ ok: false, reason: 'locked' })
    expect(deleteStreakStep(world.view(), 'yok', BEFORE)).toEqual({ ok: false, reason: 'missing' })
    world.put(markStreakPublished(world.steps, [id], '2026-10-08T10:00:00.000Z'))
    expect(deletionBlock(world.steps[0], BEFORE)).toBe('published')
    expect(deleteStreakStep(world.view(), id, BEFORE)).toEqual({ ok: false, reason: 'published' })
  })

  it('silinen adımın yerine başka maç gönderilebilir', () => {
    const world = new World()
    world.add('Yanlis')
    const deleted = deleteStreakStep(world.view(), world.steps[0].id, BEFORE)
    expect(deleted.ok).toBe(true)
    world.steps = []
    expect(world.add('Dogru').ok).toBe(true)
  })

  it('yayın: yalnızca verilen kayıtlar işaretlenir; ilk yayın anı korunur; kaldırmanın yayını ayrıca işaretlenir', () => {
    const world = new World()
    world.play('W')
    world.add('Ertelenen')
    const [first, second] = world.steps
    world.put(markStreakPublished(world.steps, [first.id], 'A'))
    expect(world.steps.map((s) => s.publishedAt)).toEqual(['A', undefined])
    world.put(markStreakPublished(world.steps, [first.id, second.id], 'B'))
    expect(world.steps.map((s) => s.publishedAt)).toEqual(['A', 'B'])
    expect(markStreakPublished(world.steps, [first.id, second.id], 'C')).toEqual([])
    world.score('Ertelenen', null, 'cancelled')
    const removed = removePendingStep(world.view(), second.id, AFTER)
    if (!removed.ok) throw new Error(removed.reason)
    world.put([removed.record])
    expect(markStreakPublished(world.steps, [second.id], 'D')).toEqual([{ ...removed.record, removed: { ...removed.record.removed!, publishedAt: 'D' } }])
  })

  it('maçın günü ya da saati düzenlenince adımın görünümü ve kilidi de değişir', () => {
    const world = new World()
    world.add('Ertelenen')
    expect(syncStepSchedule(world.steps, idOf('Ertelenen'), { date: DAY, time: '20:00' })).toEqual([])
    expect(syncStepSchedule(world.steps, 'baska', { date: '2026-10-09', time: '21:00' })).toEqual([])
    world.put(syncStepSchedule(world.steps, idOf('Ertelenen'), { date: '2026-10-15', time: '19:00' }))
    expect(world.steps[0]).toMatchObject({ date: '2026-10-15', time: '19:00' })
    expect(deletionBlock(world.steps[0], AFTER)).toBeNull()
    // Saat boşaltılırsa kayıttaki saat korunur.
    expect(syncStepSchedule(world.steps, idOf('Ertelenen'), { date: '2026-10-16', time: null })[0]).toMatchObject({ date: '2026-10-16', time: '19:00' })
  })
})

describe('bekleyen adımı kaldır (oynanmadı)', () => {
  const pending = (status?: MatchStatus) => {
    const world = new World()
    world.play('WW')
    world.add('Sorunlu')
    if (status) world.score('Sorunlu', null, status)
    return world
  }
  const idOfStep = (world: World, home = 'Sorunlu') => world.steps.find((s) => s.home === home)!.id

  it('yalnızca ertelendi / iptal işaretli maçta: skoru girilmemiş ya da oynanıyor olan maç kaldırılamaz', () => {
    for (const status of [undefined, 'pending'] as const) {
      const world = pending(status)
      expect(removalReasonOf(world.view().steps[2])).toBeNull()
      expect(removePendingStep(world.view(), idOfStep(world), AFTER)).toEqual({ ok: false, reason: 'played' })
    }
    for (const status of ['postponed', 'cancelled'] as const) {
      const world = pending(status)
      expect(removePendingStep(world.view(), idOfStep(world), AFTER)).toMatchObject({ ok: true, record: { removed: { at: AFTER.toISOString(), reason: 'unplayed' } } })
    }
  })

  it('sonuçlanmış adım kaldırılamaz: tutmayan maç "oynanmadı" yapılamaz', () => {
    const world = new World()
    world.play('WL')
    for (const step of world.steps) expect(removePendingStep(world.view(), step.id, AFTER)).toEqual({ ok: false, reason: 'not-pending' })
    expect(removePendingStep(world.view(), 'yok', AFTER)).toEqual({ ok: false, reason: 'missing' })
  })

  it('kaldırılan adım kayıtta "oynanmadı" olarak kalır: seriyi bozmaz, ilerletmez, numara almaz ve tıkanmayı çözer', () => {
    const world = pending('cancelled')
    const removed = removePendingStep(world.view(), idOfStep(world), AFTER)
    if (!removed.ok) throw new Error(removed.reason)
    world.put([removed.record])
    let view = world.view()
    expect(states(view)).toEqual(['won', 'won', 'unplayed'])
    expect(view.steps.map((s) => s.step)).toEqual([1, 2, null])
    expect(view.totals).toMatchObject({ current: 2, count: 0, won: 2, lost: 0 })
    expect(view.blocker).toBeNull()
    expect(world.add('Sonraki').ok).toBe(true)
    world.score('Sonraki', true)
    view = world.view()
    expect(view.steps.map((s) => s.step)).toEqual([1, 2, null, 3])
    expect(view.totals.current).toBe(3)
  })

  it('kaldırıldıktan sonra skor girilse de adım kaldırılmış kalır', () => {
    const world = pending('postponed')
    const removed = removePendingStep(world.view(), idOfStep(world), AFTER)
    if (!removed.ok) throw new Error(removed.reason)
    world.put([removed.record])
    world.score('Sorunlu', false)
    expect(states(world.view())).toEqual(['won', 'won', 'unplayed'])
    expect(world.view().totals).toMatchObject({ current: 2, lost: 0 })
  })

  it('serinin ilk adımı kaldırılırsa seri başlamış sayılmaz; yalnızca kaldırılan adımlar seri oluşturmaz', () => {
    const world = new World()
    world.add('Sorunlu')
    world.score('Sorunlu', null, 'cancelled')
    const removed = removePendingStep(world.view(), idOfStep(world), AFTER)
    if (!removed.ok) throw new Error(removed.reason)
    world.put([removed.record])
    const view = world.view()
    expect(view.totals).toEqual({ longest: 0, current: 0, count: 0, mean: null, won: 0, lost: 0, lowSample: true })
    expect(view.current?.steps.map((s) => s.step)).toEqual([null])
    world.play('L')
    expect(world.view().past[0].length).toBe(0)
    expect(world.view().past[0].steps.map((s) => s.step)).toEqual([null, 1])
  })

  it('değerlendirilemedi (maç tamamlandı, veri eksik): bekliyor sayılır ve engeller; kaldırılınca "değerlendirilemedi" olur', () => {
    const world = new World()
    world.add('Kornersiz', BEFORE, '20:00', 'corners85')
    world.score('Kornersiz', true)
    const [step] = world.view().steps
    expect(step).toMatchObject({ state: 'pending', live: 'void' })
    expect(world.add('Yeni')).toEqual({ ok: false, reason: 'blocked' })
    expect(removalReasonOf(step)).toBe('void')
    const removed = removePendingStep(world.view(), step.record.id, AFTER)
    if (!removed.ok) throw new Error(removed.reason)
    world.put([removed.record])
    expect(states(world.view())).toEqual(['void'])
    expect(STREAK_STATE_LABELS.void).toBe('Değerlendirilemedi')
    expect(world.view().blocker).toBeNull()
  })

  it('geri alma: yalnızca son adımsa ve kaldırma yayınlanmadıysa', () => {
    const world = pending('cancelled')
    const id = idOfStep(world)
    expect(undoRemoval(world.view(), id)).toEqual({ ok: false, reason: 'not-removed' })
    const removed = removePendingStep(world.view(), id, AFTER)
    if (!removed.ok) throw new Error(removed.reason)
    world.put([removed.record])
    expect(undoBlock(world.view(), world.steps.find((s) => s.id === id)!)).toBeNull()
    const undone = undoRemoval(world.view(), id)
    expect(undone).toMatchObject({ ok: true })
    expect(undone.ok && 'removed' in undone.record).toBe(false)
    // Kaldırma yayınlandıysa geri alınamaz.
    const published = markStreakPublished(world.steps, [id], '2026-10-08T22:00:00.000Z')
    world.put(published)
    expect(undoRemoval(world.view(), id)).toEqual({ ok: false, reason: 'removal-published' })
    // Ardından başka adım geldiyse geri alınamaz.
    const other = pending('cancelled')
    const otherId = idOfStep(other)
    const gone = removePendingStep(other.view(), otherId, AFTER)
    if (!gone.ok) throw new Error(gone.reason)
    other.put([gone.record])
    other.add('Sonraki')
    expect(undoRemoval(other.view(), otherId)).toEqual({ ok: false, reason: 'not-last' })
  })
})

describe('yedek', () => {
  const content = { uploads: [], matches: [], results: [], picks: [], thresholds: {} as never }
  const world = new World()
  world.play('WL')
  world.add('Ertelenen')
  world.score('Ertelenen', null, 'postponed')
  const removed = removePendingStep(world.view(), world.steps[2].id, AFTER)
  if (removed.ok) world.put(markStreakPublished([removed.record], [removed.record.id], '2026-10-08T22:00:00.000Z'))
  const records = [...world.steps].sort((a, b) => a.seq - b.seq)

  it('adımlar yedeğe girer ve geri okunur (sıra, yayın, kaldırma ve son sonuç dahil)', () => {
    const backup = JSON.parse(JSON.stringify(assembleBackup({ ...content, streakSteps: records }, new Date('2026-10-08T18:00:00.000Z'))))
    expect(isBackupFile(backup)).toBe(true)
    expect(backup.version).toBe(1)
    expect(normalizeStreakSteps(backup.streakSteps, isCategoryId)).toEqual(records)
    expect(records[2].removed).toMatchObject({ reason: 'unplayed', publishedAt: '2026-10-08T22:00:00.000Z' })
    expect(records[0].lastOutcome).toBe('won')
  })

  it('adım yokken yedekte alan yoktur; alanı olmayan eski yedek geçerlidir ve seri getirmez', () => {
    for (const streakSteps of [undefined, []]) expect('streakSteps' in assembleBackup({ ...content, streakSteps }, new Date())).toBe(false)
    const old = JSON.parse(JSON.stringify(assembleBackup(content, new Date())))
    expect(isBackupFile(old)).toBe(true)
    expect(normalizeStreakSteps(old.streakSteps, isCategoryId)).toEqual([])
    expect(isBackupFile({ ...old, streakSteps: 'x' })).toBe(false)
  })

  it('bozuk satırlar atılır; kimlik alanlardan yeniden kurulur; bozuk isteğe bağlı alan yok sayılır', () => {
    const [good, second] = records
    const rows = [
      good,
      { ...good, id: 'uydurma' },
      { ...good, categoryId: 'yok' },
      { ...good, matchId: 5 },
      { ...good, seq: 0 },
      { ...good, seq: 1.5 },
      { ...good, time: '' },
      { ...good, date: 'dün' },
      { ...good, addedAt: 'dün' },
      { ...second, league: 7, publishedAt: 'x', removed: { at: 'x', reason: 'unplayed' }, lastOutcome: 'void', revisedAt: 3 },
      null,
      'metin',
    ]
    const clean = normalizeStreakSteps(rows, isCategoryId)
    expect(clean.map((s) => s.id)).toEqual([good.id, second.id])
    expect(clean[0]).toEqual(good)
    expect(Object.keys(clean[1]).sort()).toEqual(['addedAt', 'away', 'categoryId', 'date', 'home', 'id', 'matchId', 'seq', 'time'])
    expect(normalizeStreakSteps('x', isCategoryId)).toEqual([])
  })
})

describe('dil', () => {
  /** Arayüzde geçmemesi gereken sözcükler (sözcük başında aranır: "oranı", "kasaya" da yakalanır) */
  const FORBIDDEN = new RegExp('(^|[^a-zçğıöşü])(para|kasa|oran|bahis|kupon|katla|rolling|kazanç|kazan[cdm]|kâr|yatır)', 'i')
  const stringsOf = (value: unknown): string[] =>
    typeof value === 'string' ? [value] : typeof value === 'function' ? [String((value as (n: number) => string)(3))] : typeof value === 'object' && value !== null ? Object.values(value).flatMap(stringsOf) : []

  it('etiketler: Tuttu / Tutmadı / Bekliyor / Oynanmadı (+ Değerlendirilemedi); admin ve üye aynı', () => {
    expect(STREAK_STATE_LABELS).toEqual({ won: 'Tuttu', lost: 'Tutmadı', pending: 'Bekliyor', unplayed: 'Oynanmadı', void: 'Değerlendirilemedi' })
    expect(Object.fromEntries(Object.entries(MEMBER_STREAK_STATES).map(([state, { label }]) => [state, label]))).toEqual(STREAK_STATE_LABELS)
    expect(STREAK_TITLE).toBe('SERİ TAKİBİ')
    expect(MEMBER_STREAK_TEXTS).toMatchObject({ tab: 'SERİ TAKİBİ', title: 'Seri Takibi', trial: 'deneme', mean: 'Seri başına tutan (ort.)' })
  })

  it('yasal not her iki sitede de aynıdır', () => {
    expect(STREAK_NOTE).toBe('İstatistik takibidir, bahis tavsiyesi değildir. 18+')
    expect(MEMBER_STREAK_TEXTS.note).toBe(STREAK_NOTE)
  })

  it('metinlerde para, kasa, oran, bahis, kupon, katlama, rolling ve kazanç geçmez (yasal not dışında)', () => {
    const texts = [STREAK_TITLE, ...stringsOf(STREAK_STATE_LABELS), ...stringsOf(STREAK_REFUSAL_TEXTS), ...stringsOf(STREAK_BUTTON_TEXTS), ...stringsOf(STREAK_PANEL_TEXTS), ...stringsOf(MEMBER_STREAK_TEXTS), ...stringsOf(MEMBER_STREAK_STATES)].filter((text) => text !== STREAK_NOTE)
    expect(texts.length).toBeGreaterThan(60)
    for (const text of texts) expect(text, text).not.toMatch(FORBIDDEN)
    // Denetim boş değil.
    for (const bad of ['Kasa 100', 'oranı 1.80', 'Bahis', 'kupon', 'katlama', 'rolling', 'kazanç', 'para']) expect(bad).toMatch(FORBIDDEN)
  })

  it('bileşenlerin kaynağında da bu sözcükler geçmez (elle yazılmış metin kalmasın)', () => {
    for (const file of ['src/components/StreakButton.tsx', 'src/components/StreakPanel.tsx', 'src/member/MemberStreak.tsx']) {
      const source = readFileSync(file, 'utf8')
      for (const line of source.split('\n')) expect(line, `${file}: ${line.trim()}`).not.toMatch(FORBIDDEN)
    }
  })
})
