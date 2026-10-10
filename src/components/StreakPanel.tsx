import { useState } from 'react'
import { getCategory } from '../config/categories'
import { deletionBlock, removalReasonOf, STREAK_LOW_SAMPLE_LIMIT, undoBlock, type ResolvedStep, type StepState, type StreakRun } from '../services/streak/streak'
import { STREAK_NOTE, STREAK_PANEL_TEXTS as T, STREAK_REFUSAL_TEXTS, STREAK_STATE_LABELS, STREAK_TITLE } from '../services/streak/texts'
import { useApp } from '../state/AppContext'
import { useNow } from '../state/useNow'
import { formatDay } from '../utils/format'

// Admin'in diğer ekranlarındaki sonuç rozetiyle aynı renkler.
const STATE_TONE: Record<StepState, string> = {
  won: 'border-win-line bg-win-soft text-win',
  lost: 'border-loss-line bg-loss-soft text-loss-text',
  pending: 'border-navy-500 bg-navy-600 text-muted',
  unplayed: 'border-navy-500 bg-navy-600 text-muted',
  void: 'border-navy-500 bg-navy-600 text-muted',
}
const PILL = 'rounded-full border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap'
const ACTION = `${PILL} border-navy-500 hover:bg-navy-600`

function Figure({ label, value, testId }: { label: string; value: string | number; testId: string }) {
  return (
    <div className="rounded-xl bg-navy-800 px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-extrabold" data-testid={testId}>
        {value}
      </p>
    </div>
  )
}

const meanText = (mean: number | null): string => (mean === null ? '—' : mean.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))

/**
 * "Seri takibi": aktif seri, sayılar ve geçmiş seriler. Sonuç, dondurulmuş önerinin sonucudur;
 * burada yeni hesap yapılmaz. Bekleyen adımın kaldırılması (oynanmadı) yalnızca buradan yapılır.
 */
export default function StreakPanel() {
  const { streak, takeBackFromStreak, removePendingFromStreak, undoStreakRemoval } = useApp()
  const now = useNow()
  const [refusal, setRefusal] = useState<string | null>(null)
  if (!streak) return null
  const { current, past, totals } = streak
  const report = (reason: keyof typeof STREAK_REFUSAL_TEXTS | null) => setRefusal(reason ? STREAK_REFUSAL_TEXTS[reason] : null)

  const row = (step: ResolvedStep, actions: boolean) => {
    const { record } = step
    const removal = removalReasonOf(step)
    const canDelete = step.state === 'pending' && deletionBlock(record, now) === null
    const canUndo = undoBlock(streak, record) === null
    return (
      <li key={record.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 py-2.5" data-testid="streak-row" data-state={step.state} data-step={step.step ?? ''}>
        <div className="min-w-0">
          <p className="text-sm leading-snug font-bold break-words">
            <span className="mr-1.5 inline-grid h-5 min-w-5 place-items-center rounded-full bg-navy-600 px-1 text-[11px]">{step.step ?? '–'}</span>
            {record.home} <span className="text-muted">–</span> {record.away}
          </p>
          <p className="mt-0.5 text-[11px] break-words text-muted">
            <span className="font-bold text-brand">{getCategory(record.categoryId).label}</span>
            {' · '}
            {formatDay(record.date)} {record.time}
            {record.league && ` · ${record.league}`}
            {!step.matchExists && <span className="font-semibold text-warn"> · {T.matchMissing}</span>}
          </p>
          {actions && step.state === 'pending' && !canDelete && (
            <p className="mt-0.5 text-[11px] text-muted" data-testid="streak-hint">
              {step.live === 'void' ? T.voidHint : removal ? null : T.removeHint}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {record.revisedAt && (
            <span className={`${PILL} border-warn-line bg-warn-soft text-warn`} title={T.revisedTitle} data-testid="streak-revised">
              {T.revised}
            </span>
          )}
          <span className={`${PILL} ${STATE_TONE[step.state]}`} data-testid="streak-state" data-state={step.state}>
            {STREAK_STATE_LABELS[step.state]}
          </span>
          {actions && canDelete && (
            <button type="button" onClick={() => void takeBackFromStreak(record.id).then(report)} className={ACTION} data-testid="streak-delete">
              {T.delete}
            </button>
          )}
          {actions && !canDelete && removal && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(removal === 'void' ? T.removeVoidConfirm : T.removeConfirm)) void removePendingFromStreak(record.id).then(report)
              }}
              className={ACTION}
              data-testid="streak-remove"
            >
              {removal === 'void' ? T.removeVoid : T.remove}
            </button>
          )}
          {actions && canUndo && (
            <button type="button" onClick={() => void undoStreakRemoval(record.id).then(report)} className={ACTION} data-testid="streak-undo">
              {T.undo}
            </button>
          )}
        </div>
      </li>
    )
  }

  const pastRow = (run: StreakRun, index: number) => {
    const last = run.steps[run.steps.length - 1]
    return (
      <li key={last.record.id} className="py-2" data-testid="streak-past" data-length={run.length}>
        <details>
          <summary className="cursor-pointer text-sm select-none">
            <span className="font-extrabold">{T.runLength(run.length)}</span>
            <span className="text-muted">
              {' · '}
              {formatDay(last.record.date)} · {T.runEnded}: {last.record.home} – {last.record.away} ({getCategory(last.record.categoryId).label})
            </span>
          </summary>
          <ul className="mt-1 divide-y divide-line pl-2" data-testid={`streak-past-steps-${index}`}>
            {run.steps.map((step) => row(step, false))}
          </ul>
        </details>
      </li>
    )
  }

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4" data-testid="streak-panel">
      <h2 className="font-extrabold tracking-wide">{STREAK_TITLE}</h2>
      <p className="mt-1 text-sm text-muted">{T.intro}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="streak-totals">
        <Figure label={T.longest} value={totals.longest} testId="streak-longest" />
        <Figure label={T.current} value={totals.current} testId="streak-current" />
        <Figure label={T.count} value={totals.count} testId="streak-count" />
        <Figure label={T.mean} value={meanText(totals.mean)} testId="streak-mean" />
        <Figure label={T.won} value={totals.won} testId="streak-won" />
        <Figure label={T.lost} value={totals.lost} testId="streak-lost" />
      </div>
      {totals.lowSample && (
        <p className="mt-2 text-xs text-warn" data-testid="streak-low-sample">
          <span className="font-bold">{T.lowSample}</span> · {T.lowSampleNote(STREAK_LOW_SAMPLE_LIMIT)}
        </p>
      )}

      {refusal && (
        <p className="mt-2 text-xs font-semibold text-loss-text" data-testid="streak-refusal">
          {refusal}
        </p>
      )}

      <h3 className="mt-4 text-sm font-extrabold tracking-wide">{T.active}</h3>
      {current ? (
        <ul className="mt-1 divide-y divide-line" data-testid="streak-active">
          {current.steps.map((step) => row(step, true))}
        </ul>
      ) : (
        <p className="mt-2 rounded-xl border border-navy-600 px-3 py-2.5 text-sm text-muted" data-testid="streak-empty">
          {streak.steps.length === 0 ? T.empty : T.noActive}
        </p>
      )}

      <h3 className="mt-4 text-sm font-extrabold tracking-wide">
        {T.past} <span className="font-normal text-muted">{past.length}</span>
      </h3>
      {past.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{T.noPast}</p>
      ) : (
        <ul className="mt-1 divide-y divide-line" data-testid="streak-past-list">
          {[...past].reverse().map(pastRow)}
        </ul>
      )}

      <p className="mt-3 border-t border-line pt-2 text-[11px] text-muted" data-testid="streak-note">
        {STREAK_NOTE}
      </p>
    </section>
  )
}
