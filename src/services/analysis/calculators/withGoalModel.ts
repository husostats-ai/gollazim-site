import type { CategoryId } from '../../../config/categories'
import { goalModelPercent, MODEL_CONFLICT_LIMIT, MODEL_CONFLICT_MAX_STARS } from '../goalModel'
import { assessReliability } from '../reliability'
import type { Calculator, PredictionNote } from '../types'

export const MODEL_LABEL = 'Model'

/**
 * Hazır yüzdeyi üreten hesaplayıcıya ikinci hesap olarak xG/gol modelini ekler.
 * Ana yüzde, eşik ve sıralama değişmez; model yalnızca yanında gösterilir.
 * Model hesaplanamıyorsa maç yine ana yüzdeyle listelenir.
 */
export const withGoalModel = (base: Calculator, categoryId: CategoryId): Calculator => ({
  ...base,
  calculate(match) {
    const result = base.calculate(match)
    if (!result.ok) return result
    const model = goalModelPercent(match, categoryId)
    if (!model) return { ...result, extras: { ...result.extras, secondPercent: null, secondLabel: MODEL_LABEL } }

    const conflict = Math.abs(result.percent - model.percent) > MODEL_CONFLICT_LIMIT
    const notes: PredictionNote[] = []
    let maxStars: number | undefined
    if (conflict) {
      notes.push({
        kind: 'conflict',
        label: 'Model çelişkisi',
        title: `Hazır yüzde %${result.percent}, model %${model.percent}: fark ${MODEL_CONFLICT_LIMIT} puandan büyük.`,
      })
      // Düşük örneklemde yıldız zaten sınırlıdır; çelişki ancak veri güvenilirken ek sınır getirir.
      const level = assessReliability(match).level
      if (level === 'medium' || level === 'high') maxStars = MODEL_CONFLICT_MAX_STARS
      else {
        notes.push({
          kind: 'weak-xg',
          label: 'xG zayıf',
          title: 'Veri az sayıda maça dayanıyor; bu yüzden çelişki yıldızı ayrıca düşürmedi.',
        })
      }
    }
    return {
      ...result,
      extras: { ...result.extras, secondPercent: model.percent, secondLabel: MODEL_LABEL, conflict, maxStars, notes },
    }
  },
})
