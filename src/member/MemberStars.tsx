import { useEffect, useId, useRef, useState } from 'react'
import { STARS_NOTE, starsButtonLabel } from './view'

/**
 * Üye kartının yıldızları: dokununca / tıklayınca (ve fareyle üzerine gelince) kısa açıklama balonu.
 * Klavyeyle Enter / Boşluk açar-kapar; Esc ve dışarı dokunmak kapatır. Görünüm ortak Stars ile aynıdır.
 */
export default function MemberStars({ count }: { count: number }) {
  // pinned: dokunma / tıklama / klavye ile açık; hover: fare üzerindeyken
  const [pinned, setPinned] = useState(false)
  const [hover, setHover] = useState(false)
  const open = pinned || hover
  const id = useId()
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinned(false)
        setHover(false)
      }
    }
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setPinned(false)
        setHover(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  return (
    <span
      ref={box}
      className="relative mt-1.5 block"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
    >
      <button
        type="button"
        aria-label={starsButtonLabel(count)}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          // Açıksa (dokunma ya da fareyle) kapatır, kapalıysa açık tutar.
          setPinned(!open)
          setHover(false)
        }}
        className="-mx-1 rounded px-1 text-sm tracking-wider whitespace-nowrap focus-visible:outline-2 focus-visible:outline-brand"
        data-testid="member-stars"
      >
        <span role="img" aria-label={`${count} / 5 yıldız`}>
          <span className="text-brand">{'★'.repeat(count)}</span>
          <span className="text-navy-500">{'★'.repeat(5 - count)}</span>
        </span>
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="absolute top-full right-0 z-20 mt-1 block w-56 rounded-xl border border-line bg-navy-800 px-3 py-2 text-left text-xs leading-relaxed font-normal text-muted shadow-lg"
          data-testid="member-stars-note"
        >
          {STARS_NOTE}
        </span>
      )}
    </span>
  )
}
