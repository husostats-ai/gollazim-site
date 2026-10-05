import type { Tally } from '../../services/stats/statsEngine'
import { formatRate } from '../../utils/format'
import LowSampleBadge from './LowSampleBadge'

/** "%77,2 · 31 öneri" + gerekiyorsa az veri uyarısı. Sayı, sonuçlanmış (kazandı + kaybetti) öneridir. */
export default function RateText({ tally }: { tally: Tally }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-nowrap">
      <span className="font-bold">{formatRate(tally.rate)}</span>
      <span className="text-muted">· {tally.decided} öneri</span>
      {tally.decided > 0 && tally.lowSample && <LowSampleBadge />}
    </span>
  )
}
