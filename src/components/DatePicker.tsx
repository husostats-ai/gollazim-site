import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { splitDates } from '../utils/dayPicker'
import { formatDateChip, formatLongDate } from '../utils/format'
import DayCalendar from './DayCalendar'

const CHIP = 'shrink-0 rounded-xl border px-3.5 py-2 text-sm font-bold whitespace-nowrap transition-colors'
const chipTone = (active: boolean) => (active ? 'border-brand bg-navy-700 text-brand' : 'border-navy-600 text-muted hover:border-navy-500 hover:text-white')

/** Takvim penceresinin genişliği (px); dar satırda satır genişliğine iner */
const CALENDAR_WIDTH = 320

// Aynı sayfada birden çok gün seçici olabilir (GÜNLÜK sekmesi); aynı anda tek takvim açık kalır.
let closeOpenCalendar: (() => void) | null = null

/**
 * Gün seçici: bugün − 6 … bugün (ve ileri tarihli) verili günler hızlı düğmedir. Daha eski veri varsa
 * "Önceki günler" takvim açar; seçili gün eskiyse yanında seçili renkte ayrıca görünür. Bu iki düğme
 * role=tablist'in dışındadır.
 */
export default function DatePicker() {
  const { dates, selectedDate, selectDate, today } = useApp()
  const [open, setOpen] = useState(false)
  /** Takvimin satıra göre sol kenarı (px): açan düğmenin sağ kenarına hizalı, satırın dışına taşmaz */
  const [left, setLeft] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const olderButton = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const closeMine = useRef(() => setOpen(false))
  const { quick, older, pinned } = splitDates(dates, today, selectedDate)

  const openCalendar = (button: HTMLButtonElement) => {
    if (closeOpenCalendar !== closeMine.current) closeOpenCalendar?.()
    closeOpenCalendar = closeMine.current
    opener.current = button
    const width = Math.min(CALENDAR_WIDTH, root.current!.clientWidth)
    setLeft(Math.max(0, Math.min(root.current!.clientWidth - width, button.offsetLeft + button.offsetWidth - width)))
    setOpen(true)
  }
  const closeCalendar = (refocus: HTMLButtonElement | null) => {
    setOpen(false)
    if (closeOpenCalendar === closeMine.current) closeOpenCalendar = null
    refocus?.focus({ preventScroll: true })
  }

  useEffect(
    () => () => {
      if (closeOpenCalendar === closeMine.current) closeOpenCalendar = null
    },
    [],
  )

  // Dışarı tıklama/dokunma yalnızca takvim açıkken dinlenir.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!root.current?.contains(e.target as Node)) closeCalendar(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])

  // Dar ekranda şerit yatay kayar; seçili hızlı düğme görünür tutulur (sayfa dikey kaydırılmaz).
  useEffect(() => {
    const box = strip.current
    const chip = box?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!box || !chip) return
    if (chip.offsetLeft < box.scrollLeft) box.scrollLeft = chip.offsetLeft - 16
    else if (chip.offsetLeft + chip.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = chip.offsetLeft + chip.offsetWidth - box.clientWidth + 16
  }, [selectedDate, dates])

  if (dates.length === 0) return null
  const hasOlder = older.length > 0

  return (
    <div ref={root} className="relative flex items-center gap-1.5" data-testid="date-picker">
      <div
        ref={strip}
        className={`no-scrollbar relative flex min-w-0 gap-1.5 overflow-x-auto ${hasOlder ? '-ml-4 pl-4' : '-mx-4 px-4'}`}
        role="tablist"
        aria-label="Tarih"
      >
        {quick.map((date) => {
          const active = date === selectedDate
          return (
            <button key={date} type="button" role="tab" aria-selected={active} onClick={() => selectDate(date)} className={`${CHIP} ${chipTone(active)}`} data-testid={`date-chip-${date}`}>
              {formatDateChip(date, today)}
            </button>
          )
        })}
      </div>
      {pinned && (
        <button
          type="button"
          aria-pressed="true"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Seçili gün: ${formatLongDate(pinned)}. Takvimi aç`}
          onClick={(e) => (open ? closeCalendar(null) : openCalendar(e.currentTarget))}
          className={`${CHIP} ${chipTone(true)}`}
          data-testid="date-pinned"
        >
          {formatDateChip(pinned, today)}
        </button>
      )}
      {hasOlder && (
        <button
          ref={olderButton}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={(e) => (open ? closeCalendar(null) : openCalendar(e.currentTarget))}
          className={`${CHIP} ${chipTone(false)}`}
          data-testid="date-older"
        >
          Önceki günler
        </button>
      )}
      {open && hasOlder && (
        <DayCalendar
          dates={dates}
          today={today}
          left={left}
          width={CALENDAR_WIDTH}
          selected={selectedDate}
          initial={pinned ?? older[0]}
          onSelect={(date) => {
            closeCalendar(olderButton.current)
            selectDate(date)
          }}
          onClose={() => closeCalendar(opener.current)}
        />
      )}
    </div>
  )
}
