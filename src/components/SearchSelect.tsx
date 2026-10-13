import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { matchesSearch } from '../utils/searchText'
import { NO_AUTOFILL } from '../utils/noAutofill'

export interface SearchSelectOption {
  value: string
  label: string
}

/** Listenin en fazla yüksekliği (px); uzun listede sayfa değil liste kayar */
export const SEARCH_SELECT_MAX_HEIGHT = 320
/** Arama kutusu + kenar payı: açılış yönü hesaplanırken listeye eklenir */
const CHROME_HEIGHT = 64
const POPUP_WIDTH = 288

interface Placement {
  up: boolean
  right: boolean
  maxHeight: number
}

/**
 * Arama kutulu seçim listesi (uzun listeler için native <select> yerine).
 * Liste yalnızca seçim, Esc, Tab ya da dışarı tıklama ile kapanır; kaydırma, yeniden boyutlandırma
 * ve yeniden çizim kapatmaz. Altta yer yoksa yukarı açılır; sayfayı kendiliğinden kaydırmaz.
 */
export default function SearchSelect({
  value,
  options,
  onChange,
  ariaLabel,
  testId,
  size = 'md',
  className = '',
}: {
  value: string
  options: SearchSelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  testId: string
  size?: 'md' | 'sm'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [placement, setPlacement] = useState<Placement>({ up: false, right: false, maxHeight: SEARCH_SELECT_MAX_HEIGHT })
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const current = options.find((o) => o.value === value)
  const shown = options.filter((o) => matchesSearch(o.label, query))

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) button.current?.focus({ preventScroll: true })
  }

  const openList = () => {
    const rect = button.current!.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom
    const above = rect.top
    const up = below < SEARCH_SELECT_MAX_HEIGHT + CHROME_HEIGHT && above > below
    const room = (up ? above : below) - CHROME_HEIGHT
    setPlacement({
      up,
      right: rect.left + POPUP_WIDTH > window.innerWidth && rect.right - POPUP_WIDTH >= 0,
      maxHeight: Math.max(120, Math.min(SEARCH_SELECT_MAX_HEIGHT, room)),
    })
    setQuery('')
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }

  const choose = (option: SearchSelectOption) => {
    close(true)
    if (option.value !== value) onChange(option.value)
  }

  // Dışarı tıklama yalnızca liste açıkken dinlenir.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])

  useEffect(() => {
    if (open) search.current?.focus({ preventScroll: true })
  }, [open])

  // Etkin satır listenin içinde görünür tutulur (sayfa kaydırılmaz).
  useEffect(() => {
    const box = list.current
    const item = box?.children[active] as HTMLElement | undefined
    if (!open || !box || !item) return
    if (item.offsetTop < box.scrollTop) box.scrollTop = item.offsetTop
    else if (item.offsetTop + item.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = item.offsetTop + item.offsetHeight - box.clientHeight
  }, [open, active, query])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
    } else if (e.key === 'Tab') {
      setOpen(false)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (shown.length > 0) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (shown[active]) choose(shown[active])
    }
  }

  return (
    <div ref={root} className={`relative min-w-0 ${className}`}>
      <button
        ref={button}
        type="button"
        onClick={() => (open ? close(false) : openList())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${current?.label ?? 'seçilmedi'}`}
        data-testid={testId}
        data-value={value}
        className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-navy-500 bg-navy-800 px-2.5 text-left text-white outline-none focus:border-brand ${size === 'md' ? 'py-2 text-sm font-bold' : 'py-1.5 text-xs'}`}
      >
        <span className="min-w-0 truncate">{current?.label ?? '—'}</span>
        <span aria-hidden="true" className="text-xs text-muted">
          ▾
        </span>
      </button>
      {open && (
        <div
          className={`absolute z-30 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-navy-500 bg-navy-800 p-1.5 shadow-xl ${placement.up ? 'bottom-full mb-1' : 'top-full mt-1'} ${placement.right ? 'right-0' : 'left-0'}`}
          data-testid={`${testId}-popup`}
          data-direction={placement.up ? 'up' : 'down'}
        >
          <input {...NO_AUTOFILL}
            ref={search}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Ara…"
            aria-label={`${ariaLabel} içinde ara`}
            spellCheck={false}
            data-testid={`${testId}-search`}
            className="w-full rounded-md border border-navy-500 bg-navy-900 px-2 py-1.5 text-sm font-normal text-white outline-none focus:border-brand"
          />
          <ul ref={list} role="listbox" aria-label={ariaLabel} style={{ maxHeight: placement.maxHeight }} className="relative mt-1.5 overflow-y-auto" data-testid={`${testId}-list`}>
            {shown.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
                data-testid={`${testId}-option`}
                data-value={o.value}
                className={`cursor-pointer rounded-md px-2 py-1.5 text-sm font-normal break-words ${i === active ? 'bg-navy-600 text-white' : 'text-white'} ${o.value === value ? 'font-bold' : ''}`}
              >
                {o.label}
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-2 py-1.5 text-sm font-normal text-muted" data-testid={`${testId}-empty`}>
                Eşleşen yok.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
