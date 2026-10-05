import { LOW_SAMPLE_LIMIT } from '../../services/stats/statsEngine'

export default function LowSampleBadge() {
  return (
    <span
      title={`${LOW_SAMPLE_LIMIT}'den az sonuçlanmış öneri var; bu oran tesadüfen yüksek veya düşük çıkmış olabilir.`}
      className="inline-flex items-center rounded-full border border-warn-line bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap text-warn"
    >
      ⚠ az veri
    </span>
  )
}
