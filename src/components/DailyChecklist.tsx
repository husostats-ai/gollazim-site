import { useState } from 'react'
import { Link } from 'react-router-dom'
import { START_TEXT, type ItemState } from '../services/daily/checklist'
import type { DailyStatus } from '../state/useDailyStatus'

const OPEN_KEY = 'gollazim.checklistOpen'
const readOpen = (): boolean => {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

// Durum yalnızca renkle değil, ikon ve sözcükle de belirtilir.
const STATE: Record<ItemState, { icon: string; label: string; tone: string }> = {
  done: { icon: '✓', label: 'Tamam', tone: 'border-win-line bg-win-soft text-win' },
  todo: { icon: '!', label: 'Yapılacak', tone: 'border-warn-line bg-warn-soft text-warn' },
  info: { icon: '–', label: 'Bilgi', tone: 'border-navy-500 bg-navy-600 text-muted' },
}

/** Ana sayfanın üstündeki günlük kontrol listesi; yalnızca mevcut veriyi gösterir. */
export default function DailyChecklist({ status }: { status: DailyStatus | null }) {
  const [open, setOpen] = useState(readOpen)
  if (!status) return null
  const { checklist } = status

  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(OPEN_KEY, next ? '1' : '0')
    } catch {
      // Tercih saklanamazsa yalnızca bu oturumda geçerli olur.
    }
  }

  if (checklist.empty) {
    return (
      <section className="mb-4 min-w-0 rounded-2xl border border-line bg-navy-700 p-4" data-testid="daily-checklist">
        <h2 className="font-extrabold tracking-wide">BUGÜNÜN KONTROL LİSTESİ</h2>
        <p className="mt-2 text-sm">
          <Link to="/admin" className="font-bold text-brand hover:underline" data-testid="checklist-start">
            {START_TEXT}
          </Link>
        </p>
      </section>
    )
  }

  return (
    <section className="mb-4 min-w-0 rounded-2xl border border-line bg-navy-700 p-4" data-testid="daily-checklist">
      <button type="button" onClick={toggle} aria-expanded={open} data-testid="checklist-toggle" className="flex w-full items-center justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="block font-extrabold tracking-wide">BUGÜNÜN KONTROL LİSTESİ</span>
          <span className="block text-xs text-muted" data-testid="checklist-summary">
            {checklist.todo > 0 ? `${checklist.todo} yapılacak madde` : 'Yapılacak madde yok'}
          </span>
        </span>
        <span className="shrink-0 text-xs font-bold text-brand">{open ? 'Gizle ▲' : 'Göster ▼'}</span>
      </button>
      {open && (
        <ul className="mt-3 divide-y divide-line">
          {checklist.items.map((item) => {
            const state = STATE[item.state]
            return (
              <li key={item.key} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 py-2.5" data-testid={`checklist-${item.key}`} data-state={item.state}>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${state.tone}`}>
                      <span aria-hidden="true">{state.icon}</span>
                      {state.label}
                    </span>
                    {item.title}
                  </p>
                  <p className="mt-1 text-sm break-words" data-testid={`checklist-${item.key}-text`}>
                    {item.text}
                  </p>
                  {item.note && <p className="mt-0.5 text-xs text-muted">{item.note}</p>}
                </div>
                <Link to={item.link.to} className="shrink-0 rounded-lg border border-navy-500 px-3 py-1.5 text-xs font-bold whitespace-nowrap hover:bg-navy-600">
                  {item.link.label}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
