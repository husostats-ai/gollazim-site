import { MEMBER_STREAK_STATES, MEMBER_STREAK_TEXTS as T } from '../services/member/labels'
import type { MemberStreak as Streak, MemberStreakState } from '../services/member/payload'
import { MEMBER_STREAK_LOW_SAMPLE } from '../services/member/schema'
import { formatDay } from '../utils/format'
import { BADGE } from './MemberCard'
import { categoryLabel, streakMeanText } from './view'

// Renkler sonuç rozetleriyle aynıdır (düz onaltılık değerler; bkz. MemberCard).
const STATE_TONE: Record<MemberStreakState, string> = {
  won: 'border-[#22c55e] bg-[#22c55e] text-navy-950',
  lost: 'border-[#dc2626] bg-[#dc2626] text-white',
  pending: 'border-navy-500 bg-navy-600 text-muted',
  unplayed: 'border-navy-500 bg-navy-600 text-muted',
  void: 'border-navy-500 bg-navy-600 text-muted',
}

function Figure({ label, value, testId }: { label: string; value: string | number; testId: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-navy-800 px-3 py-2">
      <p className="text-xs break-words text-muted">{label}</p>
      <p className="text-xl font-extrabold" data-testid={testId}>
        {value}
      </p>
    </div>
  )
}

/**
 * "Seri takibi" sayfası: paketteki aktif seriyi, sayıları ve geçmiş serileri olduğu gibi gösterir.
 * Hesap yapmaz. Yüzde, geçmiş veri seviyesi ve skor pakette yoktur, burada da gösterilmez.
 */
export default function MemberStreak({ streak }: { streak: Streak }) {
  const { steps, past, totals } = streak
  return (
    <div data-testid="member-streak">
      <h1 className="flex flex-wrap items-baseline gap-x-2 text-xl font-black tracking-tight sm:text-2xl">
        {T.title}
        <span className="rounded-full border border-navy-500 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-muted" data-testid="member-streak-trial">
          {T.trial}
        </span>
      </h1>
      <p className="mt-1.5 text-xs text-muted">{T.intro}</p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="member-streak-totals">
        <Figure label={T.longest} value={totals.longest} testId="member-streak-longest" />
        <Figure label={T.current} value={totals.current} testId="member-streak-current" />
        <Figure label={T.count} value={totals.count} testId="member-streak-count" />
        <Figure label={T.mean} value={streakMeanText(totals.mean)} testId="member-streak-mean" />
        <Figure label={T.won} value={totals.won} testId="member-streak-won" />
        <Figure label={T.lost} value={totals.lost} testId="member-streak-lost" />
      </div>
      {totals.lowSample && (
        <p className="mt-2 text-xs text-warn" data-testid="member-streak-low-sample">
          <span className="font-bold">{T.lowSample}</span> · {T.lowSampleNote(MEMBER_STREAK_LOW_SAMPLE)}
        </p>
      )}

      <section className="mt-4 rounded-2xl border border-brand bg-navy-800 p-3 sm:p-4" data-testid="member-streak-active" data-status={streak.status}>
        <h2 className="flex flex-wrap items-baseline gap-x-2 text-sm font-extrabold tracking-wide">
          {T.active}
          {steps.length > 0 && <span className="text-xs font-normal tracking-normal text-muted">Saatler TSİ</span>}
        </h2>
        {steps.length === 0 ? (
          <p className="mt-2 text-sm text-muted" data-testid="member-streak-empty">
            {totals.count === 0 ? T.empty : T.noActive}
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {steps.map((item) => {
              const state = MEMBER_STREAK_STATES[item.state]
              return (
                <li key={`${item.date}|${item.time}|${item.home}|${item.away}|${item.categoryId}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2" data-testid="member-streak-step" data-state={item.state}>
                  <div className="min-w-0">
                    <p className="text-sm leading-snug font-bold break-words">
                      {item.home} <span className="text-muted">–</span> {item.away}
                    </p>
                    <p className="mt-0.5 text-[11px] break-words text-muted">
                      <span className="font-bold text-brand">{categoryLabel(item.categoryId)}</span>
                      {' · '}
                      {formatDay(item.date)} {item.time}
                      {item.league && ` · ${item.league}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {item.step !== null && (
                      <span className={`${BADGE} border-navy-500 whitespace-nowrap text-white`} data-testid="member-streak-step-no">
                        {T.step(item.step)}
                      </span>
                    )}
                    <span className={`${BADGE} font-bold whitespace-nowrap ${STATE_TONE[item.state]}`} data-testid="member-streak-state">
                      <span aria-hidden="true">{state.mark}</span> {state.label}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <details className="mt-3 rounded-2xl border border-line bg-navy-800 p-3 sm:p-4" data-testid="member-streak-past" open={past.length > 0 && past.length <= 5}>
        <summary className="cursor-pointer text-sm font-extrabold tracking-wide select-none">
          {T.past} <span className="font-normal text-muted">{past.length}</span>
        </summary>
        {past.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{T.noPast}</p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {past.map((run, i) => (
              <li key={i} className="py-2" data-testid="member-streak-run" data-length={run.length}>
                <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className="font-extrabold">{T.runLength(run.length)}</span>
                  <span className="text-xs text-muted">{formatDay(run.ended)}</span>
                </p>
                <p className="mt-0.5 text-[11px] break-words text-muted">
                  {T.runEnded}: <span className="text-white">{run.last.home} – {run.last.away}</span>
                  {' · '}
                  <span className="font-bold text-brand">{categoryLabel(run.last.categoryId)}</span>
                  {run.last.league && ` · ${run.last.league}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </details>

      <p className="mt-3 text-[11px] text-muted" data-testid="member-streak-note">
        {T.note}
      </p>
    </div>
  )
}
