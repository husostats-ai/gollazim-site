import { useState } from 'react'
import { lockState } from '../services/highlights/highlights'
import { deletionBlock, streakStepId } from '../services/streak/streak'
import { STREAK_BUTTON_TEXTS, STREAK_REFUSAL_TEXTS } from '../services/streak/texts'
import type { Prediction } from '../services/analysis/types'
import { useApp } from '../state/AppContext'
import { useNow } from '../state/useNow'

const BASE = 'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap transition-colors'
const TONE = {
  add: 'border-navy-500 text-muted hover:border-brand hover:text-brand',
  selected: 'border-brand bg-brand text-navy-950 hover:bg-brand-dark',
  lockedSelected: 'cursor-not-allowed border-brand text-brand opacity-80',
  disabled: 'cursor-not-allowed border-navy-600 text-muted opacity-70',
}

/**
 * "Seriye gönder": öneriyi seri takibine yeni adım olarak gönderir; aynı düğme, kilitlenmemiş
 * adımı geri alır. Bekleyen adım varken, maç başladıysa ya da saati bilinmiyorsa kapalıdır ve
 * nedenini yazar; kurallar ayrıca kayıt sırasında da denetlenir. Yalnızca admin sitesindedir.
 */
export default function StreakButton({ prediction }: { prediction: Prediction }) {
  const { streak, sendToStreak, takeBackFromStreak } = useApp()
  const now = useNow()
  const [refusal, setRefusal] = useState<string | null>(null)
  if (!streak) return null
  const { match, categoryId } = prediction
  const id = streakStepId(match.id, categoryId)
  const own = streak.steps.find((s) => s.record.id === id)

  const closed = (text: string, title: string, state: string, selected = false) => (
    <button type="button" disabled title={title} aria-pressed={selected} data-testid="streak-toggle" data-state={state} data-selected={selected} className={`${BASE} ${selected ? TONE.lockedSelected : TONE.disabled}`}>
      {text}
    </button>
  )

  if (own) {
    // Sonuçlanan ya da kaldırılan adım kayıtta durur; aynı öneri seriye yeniden gönderilemez.
    if (own.state !== 'pending') return closed(STREAK_BUTTON_TEXTS.used, STREAK_REFUSAL_TEXTS.exists, 'used', true)
    const block = deletionBlock(own.record, now)
    if (block) return closed(STREAK_BUTTON_TEXTS.lockedIn, STREAK_REFUSAL_TEXTS[block], block, true)
    return (
      <>
        <button type="button" onClick={() => void takeBackFromStreak(id).then((reason) => setRefusal(reason ? STREAK_REFUSAL_TEXTS[reason] : null))} aria-pressed title={STREAK_BUTTON_TEXTS.inSeriesTitle} data-testid="streak-toggle" data-state="open" data-selected className={`${BASE} ${TONE.selected}`}>
          {STREAK_BUTTON_TEXTS.inSeries(own.step)}
        </button>
        {refusal && <span className="text-[11px] font-semibold text-loss-text">{refusal}</span>}
      </>
    )
  }

  const lock = lockState(match, now)
  if (lock === 'no-time') return closed(STREAK_BUTTON_TEXTS.noTime, STREAK_REFUSAL_TEXTS['no-time'], 'no-time')
  if (lock === 'locked') return closed(STREAK_BUTTON_TEXTS.locked, STREAK_BUTTON_TEXTS.lockedTitle, 'locked')
  if (streak.blocker) return closed(STREAK_BUTTON_TEXTS.blocked, `${STREAK_REFUSAL_TEXTS.blocked} (${streak.blocker.record.home} – ${streak.blocker.record.away})`, 'blocked')
  return (
    <>
      <button type="button" onClick={() => void sendToStreak({ match, categoryId }).then((reason) => setRefusal(reason ? STREAK_REFUSAL_TEXTS[reason] : null))} aria-pressed={false} title={STREAK_BUTTON_TEXTS.addTitle} data-testid="streak-toggle" data-state="open" data-selected={false} className={`${BASE} ${TONE.add}`}>
        {STREAK_BUTTON_TEXTS.add}
      </button>
      {refusal && <span className="text-[11px] font-semibold text-loss-text">{refusal}</span>}
    </>
  )
}
