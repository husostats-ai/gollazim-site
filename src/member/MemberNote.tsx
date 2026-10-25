import { useCallback, useEffect, useRef, useState } from 'react'
import { MEMBER_NOTE_IMAGE_ALT, MEMBER_NOTE_IMAGE_CLOSE, MEMBER_NOTE_IMAGE_OPEN, MEMBER_NOTE_LABEL } from '../services/member/labels'
import type { MemberNote as Note } from '../services/member/payload'

/**
 * Maç kartındaki "Not" satırı (sürüm 13): admin'in düz metni ve/veya küçük görsel önizlemesi. Metin React'in
 * metin düğümü olarak çizilir (HTML yorumlanmaz); satır sonları korunur. Görsele dokununca büyük görünüm açılır.
 */
export default function MemberNote({ note }: { note: Note }) {
  const [open, setOpen] = useState(false)
  // Sabit kimlikli: sayfa yeniden çizilince büyük görünüm odağı ve kaydırma kilidini yeniden kurmasın.
  const close = useCallback(() => setOpen(false), [])
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-navy-800 px-3 py-2 text-xs" data-testid="member-note">
      <p className="font-bold text-muted">{MEMBER_NOTE_LABEL}</p>
      {note.text !== undefined && (
        <p className="leading-relaxed break-words whitespace-pre-wrap text-white" data-testid="member-note-text">
          {note.text}
        </p>
      )}
      {note.image && (
        <button type="button" onClick={() => setOpen(true)} aria-label={MEMBER_NOTE_IMAGE_OPEN} className="self-start rounded-lg" data-testid="member-note-thumb">
          <img src={note.image.src} width={note.image.w} height={note.image.h} alt={MEMBER_NOTE_IMAGE_ALT} loading="lazy" decoding="async" className="h-auto max-h-28 w-auto max-w-full rounded-lg border border-line" />
        </button>
      )}
      {open && note.image && <MemberNoteViewer image={note.image} onClose={close} />}
    </div>
  )
}

/** Büyük görünüm: Esc, arka plana dokunma ya da "Kapat" ile kapanır; açıkken arka plan kaydırılamaz. */
function MemberNoteViewer({ image, onClose }: { image: NonNullable<Note['image']>; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    close.current?.focus()
    const root = document.documentElement
    const previous = root.style.overflow
    root.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      root.style.overflow = previous
      document.removeEventListener('keydown', onKey)
      previousFocus?.focus()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-navy-950/95 p-3" role="dialog" aria-modal="true" aria-label={MEMBER_NOTE_IMAGE_ALT} onClick={onClose} data-testid="member-note-viewer">
      <img src={image.src} width={image.w} height={image.h} alt={MEMBER_NOTE_IMAGE_ALT} className="h-auto max-h-[85vh] w-auto max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} data-testid="member-note-full" />
      <button ref={close} type="button" onClick={onClose} className="min-h-[44px] rounded-xl border border-navy-500 px-5 py-2 text-sm font-extrabold text-white hover:bg-navy-600" data-testid="member-note-close">
        {MEMBER_NOTE_IMAGE_CLOSE}
      </button>
    </div>
  )
}
