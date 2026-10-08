import { useState } from 'react'
import { highlightId, lockState, REFUSAL_TEXTS } from '../services/highlights/highlights'
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
 * "Öne çıkana ekle": aynı düğme ekler ve kaldırır. Maç başladıysa ya da saati bilinmiyorsa
 * pasiftir; kilit ayrıca kayıt sırasında da denetlenir. Yalnızca admin sitesindedir.
 */
export default function HighlightButton({ prediction }: { prediction: Prediction }) {
  const { highlights, addHighlight, removeHighlight } = useApp()
  const now = useNow()
  const [refusal, setRefusal] = useState<string | null>(null)
  const { match, categoryId } = prediction
  const id = highlightId(match.date, match.id, categoryId)
  const selected = highlights.some((h) => h.id === id)
  const state = lockState(match, now)

  if (state !== 'open') {
    const text = state === 'no-time' ? 'saat bilinmiyor' : selected ? '🔒 Öne çıkanlarda' : '🔒 Kilitli'
    const title = state === 'no-time' ? REFUSAL_TEXTS['no-time'] : selected ? 'Maç başladı; seçim kilitli, kaldırılamaz.' : 'Maç başladı; öne çıkanlara eklenemez.'
    return (
      <button type="button" disabled title={title} aria-pressed={selected} data-testid="highlight-toggle" data-state={state} data-selected={selected} className={`${BASE} ${selected ? TONE.lockedSelected : TONE.disabled}`}>
        {text}
      </button>
    )
  }

  const toggle = async () => {
    const reason = selected ? await removeHighlight(id) : await addHighlight({ match, categoryId, percent: prediction.percent, reliability: prediction.reliability.level })
    setRefusal(reason ? REFUSAL_TEXTS[reason] : null)
  }
  return (
    <>
      <button type="button" onClick={() => void toggle()} aria-pressed={selected} title={selected ? 'Öne çıkanlardan kaldır' : 'Günün öne çıkanlarına ekle'} data-testid="highlight-toggle" data-state="open" data-selected={selected} className={`${BASE} ${selected ? TONE.selected : TONE.add}`}>
        {selected ? '★ Öne çıkanlarda' : '☆ Öne çıkana ekle'}
      </button>
      {refusal && <span className="text-[11px] font-semibold text-loss-text">{refusal}</span>}
    </>
  )
}
