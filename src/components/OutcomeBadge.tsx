import { OUTCOME_LABELS } from '../services/results/evaluator'
import type { PickOutcome } from '../types'

const TONE: Record<PickOutcome, string> = {
  won: 'border-win-line bg-win-soft text-win',
  lost: 'border-loss-line bg-loss-soft text-loss-text',
  void: 'border-navy-500 bg-navy-600 text-muted',
  pending: 'border-navy-500 bg-navy-600 text-muted',
}

const TITLE: Partial<Record<PickOutcome, string>> = {
  void: 'Maç tamamlandı ama bu kategori için gereken veri girilmedi; istatistiğe girmez.',
  pending: 'Maç tamamlanmadı, ertelendi veya iptal edildi; istatistiğe girmez.',
}

export default function OutcomeBadge({ outcome }: { outcome: PickOutcome }) {
  return (
    <span
      title={TITLE[outcome]}
      data-outcome={outcome}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${TONE[outcome]}`}
    >
      {OUTCOME_LABELS[outcome]}
    </span>
  )
}
