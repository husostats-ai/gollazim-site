import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { LEGAL_NOTICE } from './legalNotice'

const BUTTON = 'min-h-[44px] w-full rounded-xl px-4 py-2.5 text-sm font-extrabold'

/**
 * Yasal uyarı penceresi. Kabul edilene kadar kapanmaz: Esc ve "Kabul etmiyorum" pencereyi
 * kapatmaz, odak pencerenin içinde kalır, arka plan kaydırılamaz. Onay hiçbir yere yazılmaz.
 */
export default function MemberLegalNotice({ onAccept }: { onAccept: () => void }) {
  const [declined, setDeclined] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const acceptButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    acceptButton.current?.focus()
    // Arka plan kaydırılamaz; pencere kapanınca önceki değer geri gelir.
    const root = document.documentElement
    const previous = root.style.overflow
    root.style.overflow = 'hidden'
    // Odak pencerenin dışına çıkarsa (ör. adres çubuğundan dönüşte) içeri geri alınır.
    const keepInside = (event: FocusEvent) => {
      if (panel.current && event.target instanceof Node && !panel.current.contains(event.target)) acceptButton.current?.focus()
    }
    document.addEventListener('focusin', keepInside)
    return () => {
      root.style.overflow = previous
      document.removeEventListener('focusin', keepInside)
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key !== 'Tab') return
    const buttons = [...(panel.current?.querySelectorAll('button') ?? [])]
    if (buttons.length === 0) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    event.preventDefault()
    buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/90 p-3" data-testid="member-legal-backdrop">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-legal-title"
        aria-describedby="member-legal-body"
        onKeyDown={onKeyDown}
        data-testid="member-legal"
        className="flex max-h-full w-full max-w-md min-w-0 flex-col rounded-2xl border border-line bg-navy-700"
      >
        <h2 id="member-legal-title" className="shrink-0 px-4 pt-4 text-lg font-black tracking-tight">
          {LEGAL_NOTICE.title}
        </h2>
        <div id="member-legal-body" tabIndex={-1} className="mt-2 min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 text-sm break-words text-white" data-testid="member-legal-body">
          {LEGAL_NOTICE.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <div className="shrink-0 space-y-2 p-4">
          {declined && (
            <p role="alert" className="text-sm font-semibold text-warn" data-testid="member-legal-declined">
              {LEGAL_NOTICE.declined}
            </p>
          )}
          <button ref={acceptButton} type="button" onClick={onAccept} data-testid="member-legal-accept" className={`${BUTTON} bg-brand text-navy-950 hover:bg-brand-dark`}>
            {LEGAL_NOTICE.accept}
          </button>
          <button type="button" onClick={() => setDeclined(true)} data-testid="member-legal-decline" className={`${BUTTON} border border-navy-500 text-white hover:bg-navy-600`}>
            {LEGAL_NOTICE.decline}
          </button>
        </div>
      </div>
    </div>
  )
}
