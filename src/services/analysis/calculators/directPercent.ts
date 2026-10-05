import { FIELD_LABELS, type FieldKey } from '../../../config/columnAliases'
import { stat } from '../stat'
import type { Calculator } from '../types'

/** CSV'de hazır gelen yüzde kolonunu olduğu gibi kullanır. */
export const directPercent = (field: FieldKey): Calculator => ({
  basis: `CSV: ${FIELD_LABELS[field]}`,
  requiredFields: [field],
  calculate(match) {
    const value = stat(match, field)
    if (value === null || value < 0 || value > 100) return { ok: false, missing: [field] }
    return { ok: true, percent: Math.round(value) }
  },
})
