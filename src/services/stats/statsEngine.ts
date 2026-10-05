import { CATEGORIES, categoriesInGroup, type CategoryId } from '../../config/categories'
import { hasGoalModel } from '../analysis/goalModel'
import type { ReliabilityLevel } from '../analysis/types'
import type { Pick } from '../../types'
import { monthKey, weekStart } from './periods'

/** Bu sayıdan az sonuçlanmış öneride başarı oranı "az veri" olarak işaretlenir */
export const LOW_SAMPLE_LIMIT = 20

export interface Tally {
  won: number
  lost: number
  /** Maç tamamlandı ama gerekli veri girilmedi */
  void: number
  /** Maç tamamlanmadı, ertelendi veya iptal */
  pending: number
  /** won + lost: başarı oranının paydası */
  decided: number
  total: number
  /** Kazanan / (kazanan + kaybeden), yüzde, bir ondalık; sonuçlanmış öneri yoksa null */
  rate: number | null
  lowSample: boolean
}

export interface Bucket<K extends string = string> {
  key: K
  tally: Tally
}

export interface Stats {
  overall: Tally
  /**
   * Benzersiz maç sayıları. Aynı maç birden çok kategoride önerilebildiği için
   * öneri sayısından küçüktür. decided: en az bir önerisi sonuçlanmış maçlar.
   */
  matches: { total: number; decided: number }
  /** Kayıt defterindeki sırayla, en az bir önerisi olan kategoriler */
  byCategory: Bucket<CategoryId>[]
  byReliability: Bucket<ReliabilityLevel>[]
  /** Eskiden yeniye; anahtar YYYY-MM-DD */
  daily: Bucket[]
  /** Eskiden yeniye; anahtar haftanın pazartesi günü */
  weekly: Bucket[]
  /** Eskiden yeniye; anahtar YYYY-MM */
  monthly: Bucket[]
  /** Taraf & Gol grubuna özel dökümler; grupta öneri yoksa null */
  sideGoals: SideGoalsStats | null
  /** Ana gol kategorilerinde (2.5 / 3.5 / 4.5 Üst, KG Var) hazır yüzde ile model karşılaştırması */
  goalModel: GoalModelStats | null
}

export interface ModelCalibrationRow {
  key: CategoryId | 'all'
  /** Sonuçlanmış önerilerin ortalama hazır (FootyStats) yüzdesi */
  ready: number | null
  /** Aynı önerilerin ortalama model yüzdesi */
  model: number | null
  /** Ortalama fark: hazır - model (yüzde puanı) */
  gap: number | null
  tally: Tally
}

export interface GoalModelStats {
  byConflict: Bucket<'clear' | 'conflict'>[]
  calibration: ModelCalibrationRow[]
  /** Bu kategorilerde olup model yüzdesi kayıtlı olmayan (eski ya da xG'siz) öneri sayısı; dökümlere girmez */
  withoutModel: number
}

export interface CalibrationRow {
  /** Liste kimliği ya da tüm grup için 'all' */
  key: CategoryId | 'all'
  /** Sonuçlanmış önerilerin ortalama tahmin yüzdesi; yoksa null */
  predicted: number | null
  /** tally.rate gerçekleşen başarıdır */
  tally: Tally
}

export interface SideGoalsStats {
  /** Çelişkili / çelişkisiz önerilerin başarısı */
  byConflict: Bucket<'clear' | 'conflict'>[]
  /** Tahmin edilen ortalama yüzde ile gerçekleşen başarı, liste liste ve toplamda */
  calibration: CalibrationRow[]
}

export function tally(picks: Pick[]): Tally {
  const count = (outcome: Pick['outcome']) => picks.filter((p) => p.outcome === outcome).length
  const won = count('won')
  const lost = count('lost')
  const decided = won + lost
  return {
    won,
    lost,
    void: count('void'),
    pending: count('pending'),
    decided,
    total: picks.length,
    rate: decided === 0 ? null : Math.round((won / decided) * 1000) / 10,
    lowSample: decided < LOW_SAMPLE_LIMIT,
  }
}

function groupBy<K extends string>(picks: Pick[], keyOf: (pick: Pick) => K, order?: readonly K[]): Bucket<K>[] {
  const groups = new Map<K, Pick[]>()
  for (const pick of picks) {
    const key = keyOf(pick)
    groups.set(key, [...(groups.get(key) ?? []), pick])
  }
  const keys = order ? order.filter((k) => groups.has(k)) : [...groups.keys()].sort()
  return keys.map((key) => ({ key, tally: tally(groups.get(key)!) }))
}

const RELIABILITY_ORDER: readonly ReliabilityLevel[] = [
  'high',
  'medium',
  'low',
  'market',
  'market-partial',
  'unmeasured',
  'unknown',
]

const isDecided = (p: Pick) => p.outcome === 'won' || p.outcome === 'lost'

/**
 * Kalibrasyon satırı: ortalama tahmin yalnızca sonuçlanmış öneriler üzerinden
 * alınır ki gerçekleşen başarıyla aynı maçları karşılaştırsın.
 */
function calibrationRow(key: CalibrationRow['key'], picks: Pick[]): CalibrationRow {
  const decided = picks.filter(isDecided)
  const predicted =
    decided.length === 0 ? null : Math.round((decided.reduce((s, p) => s + p.percent, 0) / decided.length) * 10) / 10
  return { key, predicted, tally: tally(picks) }
}

function buildSideGoalsStats(picks: Pick[]): SideGoalsStats | null {
  const ids = categoriesInGroup('sidegoals').map((c) => c.id)
  const inGroup = picks.filter((p) => ids.includes(p.categoryId))
  if (inGroup.length === 0) return null
  return {
    byConflict: groupBy(inGroup, (p) => (p.conflict ? 'conflict' : 'clear'), ['clear', 'conflict']),
    calibration: [
      ...ids.filter((id) => inGroup.some((p) => p.categoryId === id)).map((id) => calibrationRow(id, inGroup.filter((p) => p.categoryId === id))),
      calibrationRow('all', inGroup),
    ],
  }
}

const GOAL_MODEL_CATEGORIES = CATEGORIES.map((c) => c.id).filter(hasGoalModel)
const round1 = (value: number) => Math.round(value * 10) / 10
const mean = (values: number[]) => round1(values.reduce((a, b) => a + b, 0) / values.length)

function modelCalibrationRow(key: ModelCalibrationRow['key'], picks: Pick[]): ModelCalibrationRow {
  const decided = picks.filter(isDecided)
  if (decided.length === 0) return { key, ready: null, model: null, gap: null, tally: tally(picks) }
  return {
    key,
    ready: mean(decided.map((p) => p.percent)),
    model: mean(decided.map((p) => p.secondPercent!)),
    gap: mean(decided.map((p) => p.percent - p.secondPercent!)),
    tally: tally(picks),
  }
}

/**
 * Yalnızca model yüzdesi dondurulmuş öneriler kullanılır; böylece hazır yüzde
 * ile model aynı öneriler üzerinde karşılaştırılır.
 */
function buildGoalModelStats(picks: Pick[]): GoalModelStats | null {
  const inScope = picks.filter((p) => GOAL_MODEL_CATEGORIES.includes(p.categoryId))
  const withModel = inScope.filter((p) => p.secondPercent != null)
  if (withModel.length === 0) return null
  return {
    byConflict: groupBy(withModel, (p) => (p.conflict ? 'conflict' : 'clear'), ['clear', 'conflict']),
    calibration: [
      ...GOAL_MODEL_CATEGORIES.filter((id) => withModel.some((p) => p.categoryId === id)).map((id) =>
        modelCalibrationRow(id, withModel.filter((p) => p.categoryId === id)),
      ),
      modelCalibrationRow('all', withModel),
    ],
    withoutModel: inScope.length - withModel.length,
  }
}

/** Dondurulmuş önerilerden tüm istatistikleri üretir. */
export function buildStats(picks: Pick[]): Stats {
  const unique = (list: Pick[]) => new Set(list.map((p) => p.matchId)).size
  return {
    overall: tally(picks),
    matches: {
      total: unique(picks),
      decided: unique(picks.filter(isDecided)),
    },
    byCategory: groupBy(
      picks,
      (p) => p.categoryId,
      CATEGORIES.map((c) => c.id),
    ),
    byReliability: groupBy(picks, (p) => p.reliability ?? 'unknown', RELIABILITY_ORDER),
    daily: groupBy(picks, (p) => p.date),
    weekly: groupBy(picks, (p) => weekStart(p.date)),
    monthly: groupBy(picks, (p) => monthKey(p.date)),
    sideGoals: buildSideGoalsStats(picks),
    goalModel: buildGoalModelStats(picks),
  }
}
