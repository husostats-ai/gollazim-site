import type { CategoryId } from '../config/categories'
import { hasGoalModel } from '../services/analysis/goalModel'
import type { ModelSource } from '../services/analysis/types'

/** Model %'nin yanında görünen kısa kaynak etiketi */
export const MODEL_SOURCE_TAGS: Record<Exclude<ModelSource, 'none'>, string> = { xg: 'xG', avgGoals: 'ort. gol' }
export const MODEL_NONE_TEXT = 'Model: veri yok'
const SOURCE_TITLES: Record<Exclude<ModelSource, 'none'>, string> = {
  xg: 'Model, iki takımın maç öncesi xG değerlerinden hesaplandı.',
  avgGoals: 'xG yok: model, maç başı gol ortalamasından hesaplandı (daha zayıf yöntem).',
}

interface Props {
  categoryId: CategoryId
  secondPercent: number | null | undefined
  secondLabel: string
  secondSource: ModelSource | undefined
}

/**
 * Karttaki ikinci yüzde satırı. Gol modeli olan kategorilerde (2.5 / 3.5 / 4.5 Üst, KG Var)
 * Model %'nin kaynağı da yazılır: "Model · xG %59" ya da (zayıf yöntem, sarı) "Model · ort. gol %59";
 * model hesaplanamadıysa soluk "Model: veri yok". Taraf & Gol'de etiket değişmez ("xG modeli %…").
 * Yalnızca gösterimdir; üye sayfasında kullanılmaz.
 */
export default function ModelSourceLine({ categoryId, secondPercent, secondLabel, secondSource }: Props) {
  const goalModel = hasGoalModel(categoryId)
  if (secondPercent == null) {
    if (!goalModel || secondSource !== 'none') return null
    return (
      <p className="mt-1 text-xs text-muted opacity-70" data-testid="second-percent-none">
        {MODEL_NONE_TEXT}
      </p>
    )
  }
  const tag = goalModel && secondSource && secondSource !== 'none' ? secondSource : null
  return (
    <p className="mt-1 text-xs text-muted" data-testid="second-percent">
      {secondLabel}
      {tag && (
        <>
          {' · '}
          <span className={tag === 'avgGoals' ? 'font-semibold text-warn' : ''} title={SOURCE_TITLES[tag]} data-testid="second-source" data-source={tag}>
            {MODEL_SOURCE_TAGS[tag]}
          </span>
        </>
      )}{' '}
      <span className="font-bold text-white">%{secondPercent}</span>
    </p>
  )
}
