import type { CategoryId } from '../../config/categories'
import type { Match, MatchResult, Pick, PickOutcome, StreakRemovalReason, StreakStep } from '../../types'
import { highlightOutcome, lockState } from '../highlights/highlights'

// "Seri takibi": admin'in sırayla seriye gönderdiği öneriler ve onlardan türeyen seriler.
// Saf fonksiyonlardır. Önerileri, dondurmayı, istatistikleri ve öne çıkanları değiştirmez.
//
// Seriler kayıtta tutulmaz: adımların sırasından (seq) ve sonuçlarından her seferinde yeniden
// hesaplanır. Bu yüzden skor sonradan düzeltilirse seri de geriye dönük değişir (tutan adım
// tutmayana dönerse seri o adımda bölünür; tutmayan tutana dönerse iki seri birleşir).
// Sonuç için yeni hesap yoktur: dondurulmuş önerinin sonucu, o yoksa aynı değerlendirme fonksiyonu.
//
// Aynı anda yalnızca bir bekleyen adım olabilir: bekleyen adım sonuçlanmadan yenisi eklenemez.

export const streakStepId = (matchId: string, categoryId: CategoryId): string => `${matchId}|${categoryId}`

/** Bu sayıdan az biten seri varken sayılar "az örnek" uyarısıyla gösterilir */
export const STREAK_LOW_SAMPLE_LIMIT = 20

const TIME = /^\d{2}:\d{2}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Adımın sonucunun okunduğu kayıtlar (maçın şu anki durumu) */
export interface StepFacts {
  /** Maç kaydı duruyor mu (silinmiş olabilir) */
  matchExists: boolean
  /** Maçın bu kategorideki dondurulmuş önerisi */
  pick?: Pick
  result?: MatchResult
}

/**
 * won / lost: sonuçlandı. pending: bekliyor (skor girilmedi, maç ertelendi ya da maç tamamlandı ama
 * kategori için gereken veri eksik). unplayed / void: seriden kaldırıldı; seriyi ne ilerletir ne bozar.
 */
export type StepState = 'won' | 'lost' | 'pending' | 'unplayed' | 'void'

export interface ResolvedStep {
  record: StreakStep
  state: StepState
  /** Değerlendirmenin şu an verdiği sonuç; 'void' ise maç tamamlanmış ama veri eksiktir */
  live: PickOutcome
  matchExists: boolean
  result?: MatchResult
  /** Serideki adım numarası (1'den başlar); kaldırılan adımda null */
  step: number | null
}

/** Adımın şu anki sonucu. Maç ve dondurulmuş önerisi silinmişse son görülen kesin sonuç kullanılır. */
export function resolveStep(record: StreakStep, facts: StepFacts): Omit<ResolvedStep, 'step'> {
  const live = highlightOutcome(record, facts.pick, facts.result)
  const base = { record, live, matchExists: facts.matchExists, ...(facts.result && { result: facts.result }) }
  if (record.removed) return { ...base, state: record.removed.reason }
  if (live === 'won' || live === 'lost') return { ...base, state: live }
  if (!facts.matchExists && record.lastOutcome) return { ...base, state: record.lastOutcome }
  return { ...base, state: 'pending' }
}

export interface StreakRun {
  steps: ResolvedStep[]
  /** Tutan adım sayısı */
  length: number
  /** Seri bir "tutmadı" ile bitti */
  ended: boolean
}

export interface StreakTotals {
  /** En uzun seri (mevcut seri dahil) */
  longest: number
  /** Mevcut (bitmemiş) serinin uzunluğu */
  current: number
  /** Biten seri sayısı */
  count: number
  /** Biten serilerde seri başına tutan adım (bir ondalık); biten seri yoksa null */
  mean: number | null
  won: number
  lost: number
  lowSample: boolean
}

export interface StreakView {
  /** Tüm adımlar, sırayla */
  steps: ResolvedStep[]
  /** Bitmemiş seri (son "tutmadı"dan sonraki adımlar); adım yoksa null */
  current: StreakRun | null
  /** Biten seriler, eskiden yeniye */
  past: StreakRun[]
  totals: StreakTotals
  /** Yeni adım eklenmesini engelleyen bekleyen adım; yoksa null */
  blocker: ResolvedStep | null
}

const bySeq = (a: StreakStep, b: StreakStep): number => a.seq - b.seq || a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id)

const round1 = (value: number): number => Math.round(value * 10) / 10

/** Adımlardan serileri ve sayıları kurar. Sıra yalnızca seq'e bağlıdır. */
export function buildStreak(records: readonly StreakStep[], factsOf: (record: StreakStep) => StepFacts): StreakView {
  const steps: ResolvedStep[] = []
  const runs: StreakRun[] = []
  let run: StreakRun = { steps: [], length: 0, ended: false }
  let number = 0
  for (const record of [...records].sort(bySeq)) {
    const resolved = resolveStep(record, factsOf(record))
    const counted = resolved.state === 'won' || resolved.state === 'lost' || resolved.state === 'pending'
    const step: ResolvedStep = { ...resolved, step: counted ? ++number : null }
    steps.push(step)
    run.steps.push(step)
    if (step.state === 'won') run.length++
    if (step.state === 'lost') {
      run.ended = true
      runs.push(run)
      run = { steps: [], length: 0, ended: false }
      number = 0
    }
  }
  const current = run.steps.length > 0 ? run : null
  const past = runs
  const won = steps.filter((s) => s.state === 'won').length
  const finishedWon = past.reduce((sum, r) => sum + r.length, 0)
  return {
    steps,
    current,
    past,
    totals: {
      longest: Math.max(0, current?.length ?? 0, ...past.map((r) => r.length)),
      current: current?.length ?? 0,
      count: past.length,
      mean: past.length > 0 ? round1(finishedWon / past.length) : null,
      won,
      lost: past.length,
      lowSample: past.length < STREAK_LOW_SAMPLE_LIMIT,
    },
    blocker: steps.find((s) => s.state === 'pending') ?? null,
  }
}

/** Eklenecek önerinin kayda yazılan görünümü. Yüzde ve güvenilirlik kayda girmez. */
export interface StreakCandidate {
  match: Pick_<Match, 'id' | 'date' | 'time' | 'league' | 'home' | 'away'>
  categoryId: CategoryId
}

type Pick_<T, K extends keyof T> = { [P in K]: T[P] }

export type StreakRefusal = 'blocked' | 'locked' | 'published' | 'no-time' | 'exists' | 'missing' | 'not-pending' | 'played' | 'not-removed' | 'not-last' | 'removal-published'

export type StepResult = { ok: true; record: StreakStep } | { ok: false; reason: StreakRefusal }

/**
 * Öneriyi seriye yeni adım olarak ekler. Bekleyen adım varsa, maç başladıysa, saati yoksa ya da
 * aynı öneri zaten serideyse (kaldırılmış olsa da) reddeder.
 */
export function addStreakStep(view: StreakView, candidate: StreakCandidate, now: Date): StepResult {
  const { match, categoryId } = candidate
  const id = streakStepId(match.id, categoryId)
  if (view.steps.some((s) => s.record.id === id)) return { ok: false, reason: 'exists' }
  if (view.blocker) return { ok: false, reason: 'blocked' }
  const state = lockState(match, now)
  if (state !== 'open') return { ok: false, reason: state }
  return {
    ok: true,
    record: {
      id,
      matchId: match.id,
      categoryId,
      seq: Math.max(0, ...view.steps.map((s) => s.record.seq)) + 1,
      addedAt: now.toISOString(),
      date: match.date,
      home: match.home,
      away: match.away,
      time: match.time!,
      ...(match.league !== undefined && { league: match.league }),
    },
  }
}

/** Silinemeyen adımın nedeni; silinebiliyorsa null. Kilit kayıttaki gün ve saatten okunur. */
export function deletionBlock(record: StreakStep, now: Date): 'published' | 'locked' | null {
  if (record.publishedAt !== undefined) return 'published'
  return lockState(record, now) !== 'open' ? 'locked' : null
}

/** Adımı tümüyle siler (yanlış gönderim): yalnızca maç başlamadıysa ve adım yayınlanmadıysa. Silinecek kaydı döner. */
export function deleteStreakStep(view: StreakView, id: string, now: Date): StepResult {
  const step = view.steps.find((s) => s.record.id === id)
  if (!step) return { ok: false, reason: 'missing' }
  const block = deletionBlock(step.record, now)
  return block ? { ok: false, reason: block } : { ok: true, record: step.record }
}

/**
 * Bekleyen adımın seriden kaldırılabileceği neden; kaldırılamıyorsa null.
 * unplayed: maç ertelendi / iptal olarak işaretli ya da maç kaydı silinmiş.
 * void: maç tamamlandı ama kategori için gereken veri girilmedi.
 */
export function removalReasonOf(step: ResolvedStep): StreakRemovalReason | null {
  if (step.state !== 'pending') return null
  if (step.live === 'void') return 'void'
  if (step.result?.status === 'postponed' || step.result?.status === 'cancelled') return 'unplayed'
  return step.matchExists ? null : 'unplayed'
}

/** Bekleyen adımı seriden kaldırır (kayıt durur). Oynanan ya da hâlâ oynanabilecek maçta reddeder. */
export function removePendingStep(view: StreakView, id: string, now: Date): StepResult {
  const step = view.steps.find((s) => s.record.id === id)
  if (!step) return { ok: false, reason: 'missing' }
  if (step.state !== 'pending') return { ok: false, reason: 'not-pending' }
  const reason = removalReasonOf(step)
  if (!reason) return { ok: false, reason: 'played' }
  return { ok: true, record: { ...step.record, removed: { at: now.toISOString(), reason } } }
}

/** Kaldırma geri alınabilir mi: yalnızca son adımsa ve kaldırma henüz yayınlanmadıysa */
export function undoBlock(view: StreakView, record: StreakStep): 'not-removed' | 'not-last' | 'removal-published' | null {
  if (!record.removed) return 'not-removed'
  if (record.removed.publishedAt !== undefined) return 'removal-published'
  return view.steps[view.steps.length - 1]?.record.id === record.id ? null : 'not-last'
}

/** Kaldırmayı geri alır: adım yeniden bekleyen adım olur. */
export function undoRemoval(view: StreakView, id: string): StepResult {
  const step = view.steps.find((s) => s.record.id === id)
  if (!step) return { ok: false, reason: 'missing' }
  const block = undoBlock(view, step.record)
  if (block) return { ok: false, reason: block }
  const { removed: _removed, ...record } = step.record
  return { ok: true, record }
}

/**
 * Kesin sonucu kayda işler (maç verisi silinirse sonuç buradan okunur). Daha önce görülen kesin
 * sonuç değiştiyse adım "düzeltildi" olarak işaretlenir. Değişmesi gereken kayıtları döner.
 */
export function observeOutcomes(steps: readonly ResolvedStep[], now: string): StreakStep[] {
  return steps.flatMap(({ record, live }) => {
    if ((live !== 'won' && live !== 'lost') || record.lastOutcome === live) return []
    return [{ ...record, lastOutcome: live, ...(record.lastOutcome !== undefined && { revisedAt: now }) }]
  })
}

/**
 * Yayın paketine giren adımları "yayınlandı" olarak işaretler; kaldırılmış adımın kaldırması da
 * yayınlanmış sayılır. İlk yayın anları korunur. Değişen kayıtları döner.
 */
export function markStreakPublished(records: readonly StreakStep[], ids: readonly string[], publishedAt: string): StreakStep[] {
  const wanted = new Set(ids)
  return records.flatMap((record) => {
    if (!wanted.has(record.id)) return []
    const step = record.publishedAt === undefined
    const removal = record.removed !== undefined && record.removed.publishedAt === undefined
    if (!step && !removal) return []
    return [{ ...record, ...(step && { publishedAt }), ...(removal && { removed: { ...record.removed!, publishedAt } }) }]
  })
}

/** Maçın günü ya da saati düzenlenince adımın görünümü de güncellenir; değişen kayıtları döner. */
export function syncStepSchedule(records: readonly StreakStep[], matchId: string, schedule: { date: string; time?: string | null }): StreakStep[] {
  return records.flatMap((record) => {
    if (record.matchId !== matchId) return []
    const time = schedule.time && TIME.test(schedule.time) ? schedule.time : record.time
    return record.date === schedule.date && record.time === time ? [] : [{ ...record, date: schedule.date, time }]
  })
}

const isoOrNull = (value: unknown): string | null => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null)

/** Yedekten gelen kayıtları doğrular; bozuk satırlar atılır, yinelenen kimlikte son satır kalır */
export function normalizeStreakSteps(value: unknown, isCategory: (id: string) => id is CategoryId): StreakStep[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<string, StreakStep>()
  for (const row of value as Partial<StreakStep>[]) {
    if (typeof row !== 'object' || row === null) continue
    const { matchId, categoryId, seq, addedAt, date, home, away, time, league, publishedAt, removed, lastOutcome, revisedAt } = row
    if (typeof matchId !== 'string' || matchId === '' || typeof categoryId !== 'string' || !isCategory(categoryId)) continue
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1 || isoOrNull(addedAt) === null) continue
    if (typeof date !== 'string' || !DATE.test(date) || typeof time !== 'string' || !TIME.test(time)) continue
    if (typeof home !== 'string' || typeof away !== 'string') continue
    const removal =
      typeof removed === 'object' && removed !== null && isoOrNull(removed.at) !== null && (removed.reason === 'unplayed' || removed.reason === 'void')
        ? { at: removed.at, reason: removed.reason, ...(isoOrNull(removed.publishedAt) !== null && { publishedAt: removed.publishedAt }) }
        : null
    const id = streakStepId(matchId, categoryId)
    byId.set(id, {
      id,
      matchId,
      categoryId,
      seq,
      addedAt: addedAt!,
      date,
      home,
      away,
      time,
      ...(typeof league === 'string' && { league }),
      ...(isoOrNull(publishedAt) !== null && { publishedAt }),
      ...(removal && { removed: removal }),
      ...((lastOutcome === 'won' || lastOutcome === 'lost') && { lastOutcome }),
      ...(isoOrNull(revisedAt) !== null && { revisedAt }),
    })
  }
  return [...byId.values()].sort(bySeq)
}
