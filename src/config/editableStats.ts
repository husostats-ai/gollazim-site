import type { FieldKey } from './columnAliases'

/** Admin panelinde elle düzenlenebilen istatistikler (analizde kullanılanlar). */
export const EDITABLE_STATS: { field: FieldKey; percent?: true }[] = [
  { field: 'over25Pct', percent: true },
  { field: 'ht05Pct', percent: true },
  { field: 'bttsPct', percent: true },
  { field: 'sh05Pct', percent: true },
  { field: 'over35Pct', percent: true },
  { field: 'over45Pct', percent: true },
  { field: 'ht15Pct', percent: true },
  { field: 'corners85Pct', percent: true },
  { field: 'corners95Pct', percent: true },
  { field: 'corners105Pct', percent: true },
  { field: 'homeXg' },
  { field: 'awayXg' },
  { field: 'avgGoals' },
  { field: 'avgCorners' },
  { field: 'avgCards' },
]
