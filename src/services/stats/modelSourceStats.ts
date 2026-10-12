import { categoriesInGroup } from '../../config/categories'
import type { Match, MatchResult, Pick, ScoreSnapshot, Upload } from '../../types'
import { goalModelPercent, hasGoalModel } from '../analysis/goalModel'
import type { ModelSource } from '../analysis/types'
import { actualScore, scoreRow, type ScoreStatsRow } from './scoreStats'
import { tally, type Tally } from './statsEngine'

// Ölçümlerin modelin KAYNAĞINA göre ayrımı (yalnızca "Analiz için özet"te kullanılır; okur,
// hiçbir kaydı değiştirmez). Model %'nin kaynağı öneriye dondurma anında yazılır (modelSource).
// Alanı olmayan eski önerinin kaynağı "bilinmiyor"dur: hiçbir satıra karıştırılmaz ve kayda
// sonradan hiçbir şey yazılmaz. Maç kaydından türetme yalnızca ayrı, etiketli bir bilgi satırıdır.

const isDecided = (p: Pick): boolean => p.outcome === 'won' || p.outcome === 'lost'
const mean = (values: number[]): number | null => (values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10)
const isModelSource = (value: unknown): value is ModelSource => value === 'xg' || value === 'avgGoals' || value === 'none'

/** unknown: kaynak alanı kayıtlı olmayan eski öneri */
export type PickModelSource = ModelSource | 'unknown'
export const pickModelSource = (pick: Pick): PickModelSource => (isModelSource(pick.modelSource) ? pick.modelSource : 'unknown')

export const MODEL_SOURCE_ORDER: readonly PickModelSource[] = ['xg', 'avgGoals', 'none', 'unknown']
export const MODEL_SOURCE_LABELS: Record<PickModelSource, string> = {
  xg: 'xG',
  avgGoals: 'ort. gol (xG yok)',
  none: 'model yok',
  unknown: 'bilinmiyor (eski kayıt)',
}

export interface GoalModelSourceRow {
  key: PickModelSource
  /** Sonuçlanmış önerilerin ortalama hazır yüzdesi */
  ready: number | null
  /** Aynı önerilerin ortalama model yüzdesi; "model yok" satırında null */
  model: number | null
  tally: Tally
  /** Model çelişkisi olmayan / olan önerilerin başarısı; "model yok" satırında çelişki ölçülemez (null) */
  clear: Tally | null
  conflict: Tally | null
}

export interface GoalModelSourceStats {
  /** MODEL_SOURCE_ORDER sırasıyla, önerisi olan satırlar */
  rows: GoalModelSourceRow[]
  /** Ne kaynağı ne model yüzdesi kayıtlı olan eski öneri sayısı; hiçbir satıra girmez */
  unknownWithoutModel: number
}

/**
 * 2.5 / 3.5 / 4.5 Üst ve KG Var önerilerinin model kaynağına göre kalibrasyonu.
 * xG / ort. gol / model yok: kaynağı kayıtlı öneriler. Bilinmiyor: kaynağı kayıtlı olmayan ama
 * model yüzdesi kayıtlı eski öneriler. Böylece xG + ort. gol + bilinmiyor, mevcut "dört kategori
 * birlikte" satırıyla (model yüzdesi kayıtlı öneriler) aynı önerileri kapsar.
 */
export function buildGoalModelSourceStats(picks: Pick[]): GoalModelSourceStats | null {
  const inScope = picks.filter((p) => hasGoalModel(p.categoryId))
  const unknownWithoutModel = inScope.filter((p) => pickModelSource(p) === 'unknown' && p.secondPercent == null)
  const counted = inScope.filter((p) => !unknownWithoutModel.includes(p))
  if (counted.length === 0) return null
  const rows = MODEL_SOURCE_ORDER.flatMap((key): GoalModelSourceRow[] => {
    const list = counted.filter((p) => pickModelSource(p) === key)
    if (list.length === 0) return []
    const decided = list.filter(isDecided)
    const modeled = key !== 'none'
    return [
      {
        key,
        ready: mean(decided.map((p) => p.percent)),
        model: modeled ? mean(decided.flatMap((p) => (p.secondPercent == null ? [] : [p.secondPercent]))) : null,
        tally: tally(list),
        clear: modeled ? tally(list.filter((p) => !p.conflict)) : null,
        conflict: modeled ? tally(list.filter((p) => p.conflict)) : null,
      },
    ]
  })
  return { rows, unknownWithoutModel: unknownWithoutModel.length }
}

export interface DerivedSources {
  /** Kaynağı bilinmeyen (model yüzdesi kayıtlı) öneri sayısı */
  total: number
  xg: number
  avgGoals: number
  /** Dört koşuldan biri sağlanmadığı için türetilemeyen */
  unverified: number
}

/**
 * Kaynağı bilinmeyen eski önerilerin maç kaydına göre dökümü. TÜRETMEDİR, kayıt değildir: hiçbir
 * yere yazılmaz ve tablolardaki "bilinmiyor" satırını değiştirmez. Bir önerinin kaynağı yalnızca
 * şu dört koşulun hepsi sağlanırsa türetilir:
 * 1) maç kaydı duruyor, 2) maç elle düzenlenmemiş, 3) maçı yazan CSV yüklemesi öneri dondurulduktan
 * sonra değil (kayıt dondurmadan sonra yenilenmemiş), 4) yeniden hesaplanan Model % kayıtlıyla aynı.
 * uploads verilmezse (yükleme zamanı okunamıyorsa) null döner: döküm yapılmaz.
 */
export function deriveUnknownSources(picks: Pick[], matches: Match[], uploads: Upload[] | undefined): DerivedSources | null {
  if (!uploads) return null
  const unknown = picks.filter((p) => hasGoalModel(p.categoryId) && pickModelSource(p) === 'unknown' && p.secondPercent != null)
  const matchById = new Map(matches.map((m) => [m.id, m]))
  const uploadedAt = new Map(uploads.map((u) => [u.id, u.uploadedAt]))
  const result: DerivedSources = { total: unknown.length, xg: 0, avgGoals: 0, unverified: 0 }
  for (const pick of unknown) {
    const match = matchById.get(pick.matchId)
    const written = match && uploadedAt.get(match.uploadId)
    const unchanged = match && !match.edited && typeof written === 'string' && written !== '' && pick.frozenAt !== '' && written <= pick.frozenAt
    const model = unchanged ? goalModelPercent(match, pick.categoryId) : null
    if (model && model.percent === pick.secondPercent) result[model.source]++
    else result.unverified++
  }
  return result
}

/** Taraf & Gol ana hesabının kaynağı; unknown: güvenilirliği kayıtlı olmayan eski öneri */
export type SideGoalsMainSource = 'market' | 'market-side' | 'xg' | 'unknown'
export const SIDE_GOALS_SOURCE_ORDER: readonly SideGoalsMainSource[] = ['market', 'market-side', 'xg', 'unknown']
export const SIDE_GOALS_SOURCE_LABELS: Record<SideGoalsMainSource, string> = {
  market: 'Piyasa (1X2 + 2.5 Alt/Üst)',
  'market-side': 'Kısmi piyasa (yalnızca 1X2) + gol tahmini',
  xg: 'Yalnızca xG',
  unknown: 'bilinmiyor (eski kayıt)',
}

/**
 * Ana hesabın kaynağı, önerinin dondurma anında KAYITLI güvenilirliğinden okunur (türetme değildir):
 * analiz Taraf & Gol'de güvenilirliği kaynağa göre yazar (piyasa / kısmi piyasa); oran yoksa hesap
 * yalnızca xG'dendir ve güvenilirlik xG örneklemine göre yazılır.
 */
export function sideGoalsMainSource(pick: Pick): SideGoalsMainSource {
  if (!pick.reliability) return 'unknown'
  return pick.reliability === 'market' ? 'market' : pick.reliability === 'market-partial' ? 'market-side' : 'xg'
}

export interface SideGoalsSourceRow {
  key: SideGoalsMainSource
  /** Sonuçlanmış önerilerin ortalama ana yüzdesi */
  predicted: number | null
  /** Aynı önerilerden xG modeli (ikinci hesap) kayıtlı olanların ortalaması */
  second: number | null
  tally: Tally
}

export function buildSideGoalsSourceStats(picks: Pick[]): SideGoalsSourceRow[] {
  const ids = categoriesInGroup('sidegoals').map((c) => c.id)
  const inGroup = picks.filter((p) => ids.includes(p.categoryId))
  return SIDE_GOALS_SOURCE_ORDER.flatMap((key) => {
    const list = inGroup.filter((p) => sideGoalsMainSource(p) === key)
    if (list.length === 0) return []
    const decided = list.filter(isDecided)
    return [{ key, predicted: mean(decided.map((p) => p.percent)), second: mean(decided.flatMap((p) => (p.secondPercent == null ? [] : [p.secondPercent]))), tally: tally(list) }]
  })
}

type ScoreModelSource = Exclude<ScoreSnapshot['source'], 'none'>
export const SCORE_SOURCE_ORDER: readonly ScoreModelSource[] = ['market', 'market-side', 'xg']
export const SCORE_SOURCE_LABELS: Record<ScoreModelSource, string> = {
  market: 'Model: piyasa (1X2 + 2.5 Alt/Üst)',
  'market-side': 'Model: kısmi piyasa (yalnızca 1X2) + gol tahmini',
  xg: 'Model: yalnızca xG',
}

/**
 * Skor modelinin tahminleri, maç kaydındaki anlık görüntünün KAYITLI kaynağına göre.
 * Satırların toplamı, skor tablosundaki "Model" satırıdır.
 */
export function buildScoreSourceStats(matches: Match[], results: MatchResult[]): ScoreStatsRow[] {
  const resultById = new Map(results.map((r) => [r.matchId, r]))
  return SCORE_SOURCE_ORDER.flatMap((source) => {
    const pairs = matches.flatMap((match) => {
      const actual = actualScore(resultById.get(match.id))
      const best = match.scoreSnapshot?.source === source ? match.scoreSnapshot.best : undefined
      return actual && best ? [[best, actual] as [typeof best, typeof actual]] : []
    })
    return pairs.length === 0 ? [] : [scoreRow('model', SCORE_SOURCE_LABELS[source], pairs)]
  })
}
