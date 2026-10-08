import Stars from '../components/Stars'
import type { ReliabilityLevel } from '../services/analysis/types'
import { MEMBER_AI_LEVEL_LABELS, MEMBER_AI_PROVIDER_LABELS, memberAiSummary, memberAiTitle, MEMBER_CONFLICT_LABELS, MEMBER_DATA_TERM, MEMBER_OUTCOMES, MEMBER_RELIABILITY_LABELS, memberSampleText, MEMBER_STATUS_LABELS, STALE_TABLE_LABEL, standingText } from '../services/member/labels'
import type { MemberItem, MemberMatch, MemberStanding } from '../services/member/payload'
import type { PickOutcome } from '../types'
import { categoryLabel as labelOf, isOverstated, percentKind } from './view'

// Renkler düz onaltılık değerlerdir (Chrome < 111 oklch paletini çizemez) ve yalnızca bu kartta
// kullanılır; admin kartının rozetleri ayrıdır.
//
// "Geçmiş veri" rozeti: yalnızca çerçeve, dolu zemin yok, kırmızı ve yeşil yok. Sonuç rozetiyle
// (aşağıda) karışmasın diye bilerek daha soluktur. Düşük seviyenin turuncusu, "Model çelişkisi"
// rozetinin dolu sarısından ayrıdır; ölçülemeyen seviyeler kesik çerçevelidir.
const RELIABILITY_TONE: Record<ReliabilityLevel, string> = {
  high: 'border-[#3b8fbf] text-[#7dd3fc]',
  medium: 'border-[#64748b] text-[#cbd5e1]',
  low: 'border-[#c2691f] text-[#fb923c]',
  unknown: 'border-dashed border-[#5d7790] text-muted',
  unmeasured: 'border-dashed border-[#5d7790] text-muted',
  market: 'border-[#7c6fc4] text-[#c4b5fd]',
  'market-partial': 'border-[#7c6fc4] text-[#c4b5fd]',
}

// Sonuç rozeti: dolu zemin, belirgin yeşil / kırmızı.
export const OUTCOME_TONE: Record<PickOutcome, string> = {
  won: 'border-[#22c55e] bg-[#22c55e] text-navy-950',
  lost: 'border-[#dc2626] bg-[#dc2626] text-white',
  void: 'border-navy-500 bg-navy-600 text-muted',
  pending: 'border-navy-500 bg-navy-600 text-muted',
}

export const BADGE = 'inline-flex max-w-full items-center gap-x-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold'

function Standing({ side, standing }: { side: string; standing: MemberStanding | null }) {
  if (!standing) return null
  return (
    <p className="break-words">
      <span className="font-semibold text-white">{side}:</span> {standingText(standing)}
      {standing.stale && <span className="font-bold text-warn"> · {STALE_TABLE_LABEL}</span>}
    </p>
  )
}

/**
 * Üye sayfasının salt okunur maç kartı. Yalnızca yayın paketindeki alanları gösterir;
 * hiçbir hesap yapmaz ve uygulama durumuna bağlı değildir.
 */
interface Props {
  rank: number
  match: MemberMatch
  item: MemberItem
  categoryLabel: string
  /** Büyük yüzdenin altındaki sabit etiket: yüzdenin neyi ölçtüğü */
  percentLabel: string
  secondLabel: string
}

export default function MemberCard({ rank, match, item, categoryLabel, percentLabel, secondLabel }: Props) {
  const outcome = item.outcome ? MEMBER_OUTCOMES[item.outcome] : null
  const status = match.status ? MEMBER_STATUS_LABELS[match.status] : null
  const isModelBased = item.reliability === 'market' || item.reliability === 'market-partial'
  // %100 ama az maça dayanıyorsa yüzde sönük, "geçmiş veri" rozeti belirgin gösterilir.
  const overstated = isOverstated(item)
  // Sürüm 1 paketlerde bu alan yoktur.
  const others = item.others ?? []
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-navy-700 p-4" data-testid="member-card" data-overstated={overstated}>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
        <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-navy-600 px-1.5 font-bold text-white">{rank}</span>
        {match.time && <span className="shrink-0 font-semibold text-white">{match.time}</span>}
        {match.league && <span className="min-w-0 truncate">{match.league}</span>}
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base leading-snug font-extrabold break-words sm:text-lg">
            {match.home} <span className="text-muted">–</span> {match.away}
          </h3>
          <p className="mt-1 text-xs font-bold tracking-wide text-brand">{categoryLabel}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`leading-none font-black ${overstated ? 'text-2xl text-muted' : 'text-3xl text-brand'}`} data-testid="member-percent">
            %{item.percent}
          </p>
          <p className="mt-1 ml-auto max-w-[7.5rem] text-[10px] leading-tight text-muted" data-testid="member-percent-label">
            {percentLabel}
          </p>
          {item.model !== null && (
            <p className="mt-1 text-xs text-muted" data-testid="member-model">
              {secondLabel} <span className="font-bold text-white">%{item.model}</span>
            </p>
          )}
          <Stars count={item.stars} className="mt-1.5 block text-sm" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {outcome && item.outcome && (
          <span className={`${BADGE} font-bold whitespace-nowrap ${OUTCOME_TONE[item.outcome]}`} data-testid="member-outcome" data-outcome={item.outcome}>
            <span aria-hidden="true">{outcome.mark}</span> {outcome.label}
          </span>
        )}
        {match.score && (
          <span className="text-xs font-bold whitespace-nowrap" data-testid="member-score">
            {match.score}
          </span>
        )}
        {item.detail && <span className="text-xs whitespace-nowrap text-muted">{item.detail}</span>}
        {status && <span className={`${BADGE} border-navy-500 bg-navy-600 whitespace-nowrap text-muted`}>{status}</span>}
        <span
          className={overstated ? `inline-flex max-w-full flex-wrap items-center gap-x-1 rounded-full border-2 px-2.5 py-1 text-xs font-extrabold ${RELIABILITY_TONE[item.reliability]}` : `${BADGE} flex-wrap ${RELIABILITY_TONE[item.reliability]}`}
          data-testid="member-reliability"
        >
          {overstated && <span aria-hidden="true">⚠</span>}
          {!isModelBased && <span className={overstated ? '' : 'font-normal opacity-80'}>{MEMBER_DATA_TERM}:</span>}
          {MEMBER_RELIABILITY_LABELS[item.reliability]}
          {/* Tahmini maç sayısı (sürüm 5 paketlerde, sayı çıkarılabildiyse); eski paketlerde yalnızca seviye görünür. */}
          {item.sample !== undefined && (
            <span className={overstated ? '' : 'font-normal opacity-80'} data-testid="member-sample">
              · {memberSampleText(item.sample)}
            </span>
          )}
        </span>
        {item.conflict && (
          <span className={`${BADGE} border-warn-line bg-warn-soft whitespace-nowrap text-warn`} data-testid="member-conflict" data-conflict={item.conflict}>
            ⚠ {MEMBER_CONFLICT_LABELS[item.conflict]}
          </span>
        )}
      </div>

      {item.ai && (
        // Yalnızca BU KATEGORİYE ait kararlar: üç yapay zekâ da bu öneriyi değerlendirdiyse ve çoğunluk Orta ya da
        // Güçlü dediyse gelir. Sürüm 6 paketlerdeki maç geneli satır (match.ai) bilerek gösterilmez.
        <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="member-ai">
          <span className="font-bold text-muted">{memberAiTitle(categoryLabel)}:</span>
          {item.ai.votes.map((vote) => (
            <span key={vote.who} className={`${BADGE} border-navy-500 whitespace-nowrap`} data-testid="member-ai-vote" data-ai={vote.who}>
              <span className="font-normal text-muted">{MEMBER_AI_PROVIDER_LABELS[vote.who]}:</span>
              {MEMBER_AI_LEVEL_LABELS[vote.level]}
            </span>
          ))}
          <span className={`${BADGE} border-[#7dd3fc] font-bold whitespace-nowrap text-[#7dd3fc]`} data-testid="member-ai-summary">
            {memberAiSummary(item.ai)}
          </span>
        </div>
      )}

      {others.length > 0 && (
        // Küçük ve soluk: ana yüzdeyle yarışmaz. Sığmayan öneri alt satıra iner.
        <p className="text-[11px] leading-relaxed text-muted" data-testid="member-others">
          <span className="mr-1.5">Aynı maçın diğer önerileri:</span>
          {others.map((other, index) => {
            const dim = isOverstated(other)
            return (
              <span key={other.categoryId} className="inline-block max-w-full break-words" data-testid="member-other" data-category={other.categoryId} data-overstated={dim}>
                {index > 0 && <span aria-hidden="true">&nbsp;·&nbsp;</span>}
                {labelOf(other.categoryId)} <span className={dim ? '' : 'font-semibold text-white'}>%{other.percent}</span>
                {percentKind(other.categoryId) === 'model' && <span> (model)</span>}
              </span>
            )
          })}
        </p>
      )}

      {(match.homeStanding || match.awayStanding) && (
        <div className="border-t border-line pt-2.5 text-xs text-muted" data-testid="member-standing">
          <Standing side="Ev" standing={match.homeStanding} />
          <Standing side="Dep" standing={match.awayStanding} />
        </div>
      )}
    </article>
  )
}
