import { MEMBER_HIGHLIGHT_TEXTS, MEMBER_OUTCOMES, MEMBER_STATUS_LABELS } from '../services/member/labels'
import type { MemberHighlight } from '../services/member/payload'
import { BADGE, OUTCOME_TONE } from './MemberCard'
import { categoryLabel } from './view'

/**
 * "Günün öne çıkanları" kutusu: paketteki seçimleri olduğu gibi gösterir (saat, maç, kategori,
 * skor, sonuç). Hesap yapmaz. Yüzde ve güvenilirlik pakette yoktur, burada da gösterilmez.
 * Seçim yoksa hiç çizilmez.
 */
export default function MemberHighlights({ highlights }: { highlights: MemberHighlight[] }) {
  if (highlights.length === 0) return null
  return (
    <section className="mt-3 rounded-2xl border border-brand bg-navy-800 p-3 sm:p-4" data-testid="member-highlights">
      <h2 className="flex flex-wrap items-baseline gap-x-2 text-sm font-extrabold tracking-wide">
        {MEMBER_HIGHLIGHT_TEXTS.title}
        <span className="rounded-full border border-navy-500 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-muted" data-testid="member-highlights-trial">
          {MEMBER_HIGHLIGHT_TEXTS.trial}
        </span>
        <span className="text-xs font-normal tracking-normal text-muted">{highlights.length} seçim · Saatler TSİ</span>
      </h2>
      <ul className="mt-1 divide-y divide-line">
        {highlights.map((item) => {
          const outcome = MEMBER_OUTCOMES[item.outcome]
          const status = item.status ? MEMBER_STATUS_LABELS[item.status] : null
          return (
            <li key={`${item.time}|${item.home}|${item.away}|${item.categoryId}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2" data-testid="member-highlight" data-outcome={item.outcome}>
              <div className="min-w-0">
                <p className="text-sm leading-snug font-bold break-words">
                  <span className="mr-1.5 font-semibold text-muted">{item.time}</span>
                  {item.home} <span className="text-muted">–</span> {item.away}
                </p>
                <p className="mt-0.5 text-[11px] break-words text-muted">
                  <span className="font-bold text-brand">{categoryLabel(item.categoryId)}</span>
                  {item.league && ` · ${item.league}`}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                {item.score && <span className="text-xs font-bold whitespace-nowrap">{item.score}</span>}
                {status && item.outcome === 'pending' && item.status !== 'pending' ? (
                  <span className={`${BADGE} border-navy-500 bg-navy-600 whitespace-nowrap text-muted`}>{status}</span>
                ) : (
                  <span className={`${BADGE} font-bold whitespace-nowrap ${OUTCOME_TONE[item.outcome]}`} data-testid="member-highlight-outcome">
                    <span aria-hidden="true">{outcome.mark}</span> {outcome.label}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 border-t border-line pt-2 text-[11px] text-muted" data-testid="member-highlights-note">
        {MEMBER_HIGHLIGHT_TEXTS.note}
      </p>
    </section>
  )
}
