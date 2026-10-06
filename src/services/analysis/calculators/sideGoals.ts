import type { Match } from '../../../types'
import { formatNumber } from '../../../utils/format'
import { assessReliability } from '../reliability'
import {
  buildSideGoalsModel,
  CONFLICT_LIMIT,
  DRIFT_LIMIT,
  evaluateSideGoals,
  marketDrift,
  SOURCE_LABELS,
  type SideGoalsLine,
  type SideGoalsModel,
} from '../sideGoals/sideGoals'
import type { Calculator, PredictionNote, Reliability } from '../types'

/** Çelişki yıldızı bu sınıra düşürür (xG örneklemi orta veya yüksekse) */
export const CONFLICT_MAX_STARS = 2
/** Model piyasadan saptığında yıldız üst sınırı */
export const DRIFT_MAX_STARS = 3

// Dört liste aynı maç modelini kullanır; model maç başına bir kez kurulur.
const modelCache = new WeakMap<Match, SideGoalsModel | null>()
const modelFor = (match: Match): SideGoalsModel | null => {
  if (!modelCache.has(match)) modelCache.set(match, buildSideGoalsModel(match))
  return modelCache.get(match)!
}

const MARKET: Reliability = { level: 'market', sampleSize: null }
const MARKET_PARTIAL: Reliability = { level: 'market-partial', sampleSize: null }

/**
 * "Taraf kazanır & gol üstü" ortak olasılığı: piyasa oranlarına kalibre
 * edilmiş skor modelinden, ikinci hesap olarak da xG'den.
 */
export const sideGoals = (line: SideGoalsLine): Calculator => ({
  basis: 'Skor modeli (piyasa oranları, yoksa xG)',
  // Tek bir zorunlu kolon yok: oranlar yoksa xG'ye düşer.
  requiredFields: [],
  calculate(match) {
    const model = modelFor(match)
    if (!model) return { ok: false, missing: ['oddsHome', 'oddsDraw', 'oddsAway', 'homeXg', 'awayXg'] }

    const result = evaluateSideGoals(model, line)
    const notes: PredictionNote[] = []
    let maxStars = 5

    if (result.conflict) {
      notes.push({
        kind: 'conflict',
        label: 'Çelişki',
        title: `Ana hesap %${result.percent}, xG modeli %${result.secondPercent}: fark ${CONFLICT_LIMIT} puandan büyük.`,
      })
      // xG az maça dayanıyorsa çelişki piyasa hesabını zayıflatacak kadar güçlü bir işaret değildir.
      const xgLevel = assessReliability(match).level
      if (xgLevel === 'medium' || xgLevel === 'high') maxStars = CONFLICT_MAX_STARS
      else {
        notes.push({
          kind: 'weak-xg',
          label: 'xG zayıf',
          title: 'xG az sayıda maça dayanıyor; bu yüzden çelişki yıldızı düşürmedi.',
        })
      }
    }

    const drift = marketDrift(model)
    if (drift !== null && drift > DRIFT_LIMIT) {
      maxStars = Math.min(maxStars, DRIFT_MAX_STARS)
      notes.push({
        kind: 'model-drift',
        label: 'Model piyasadan sapıyor',
        title: `Modelin 1/X/2 olasılıkları piyasadan ${formatNumber(Math.round(drift * 10) / 10)} puan sapıyor; yüzde daha az güvenilir.`,
      })
    }

    return {
      ok: true,
      percent: result.percent,
      extras: {
        secondPercent: result.secondPercent,
        conflict: result.conflict,
        basis: SOURCE_LABELS[result.source],
        // Yalnızca xG'ye düşen maçta mevcut örneklem rozeti kullanılır.
        reliability: result.source === 'market' ? MARKET : result.source === 'market-side' ? MARKET_PARTIAL : undefined,
        maxStars,
        notes,
        // Yalnızca kayıt içindir; yıldız sınırı yukarıda zaten uygulandı.
        modelDrift: drift === null ? 'none' : drift > DRIFT_LIMIT,
      },
    }
  },
})
