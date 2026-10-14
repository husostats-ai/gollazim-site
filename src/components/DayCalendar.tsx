import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { calendarDayLabel, calendarRange, keyTarget, monthGrid, monthOf, monthTitle, shiftFocusMonth, shiftMonth, WEEKDAYS } from '../utils/dayPicker'

interface Props {
  /** Verisi olan günler; yalnızca bunlar seçilebilir */
  dates: string[]
  today: string
  /** Konum: satıra göre sol kenar ve en fazla genişlik (px) */
  left: number
  width: number
  selected: string | null
  /** Açılışta odaklanan gün (ayı da bu günün ayıdır) */
  initial: string
  onSelect: (date: string) => void
  /** Esc: takvim kapanır, odak açan düğmeye döner */
  onClose: () => void
}

/**
 * "Önceki günler" takvimi (WAI-ARIA tarih seçici modeli): hafta Pazartesi başlar, verisi olmayan günler
 * soluk ve aria-disabled, bugün çerçeveli, seçili gün aria-selected. Klavye: oklar, PageUp/PageDown, Home/End,
 * Enter/Boşluk seçer, Esc kapatır; Tab pencerenin içinde döner. Dışarı tıklama çağıran tarafta kapatır.
 */
export default function DayCalendar({ dates, today, left, width, selected, initial, onSelect, onClose }: Props) {
  const range = calendarRange(dates)!
  const [focused, setFocused] = useState(initial)
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const focusedCell = useRef<HTMLTableCellElement>(null)
  // Gün değişince DOM odağı yalnızca odak zaten ızgaradaysa (ya da açılışta) hücreye taşınır;
  // ay düğmeleriyle gezinirken odak düğmede kalır.
  const moveFocus = useRef(true)
  const available = new Set(dates)
  const month = monthOf(focused)

  useEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    focusedCell.current?.focus({ preventScroll: true })
  }, [focused])

  const choose = (date: string) => {
    if (available.has(date)) onSelect(date)
  }

  const onGridKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      choose(focused)
      return
    }
    const next = keyTarget(focused, e.key, range)
    if (next === null) return
    e.preventDefault()
    moveFocus.current = true
    setFocused(next)
  }

  const onDialogKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Tab') {
      const items = [...dialog.current!.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')]
      const at = items.indexOf(document.activeElement as HTMLElement)
      e.preventDefault()
      items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus({ preventScroll: true })
    }
  }

  const canPrev = `${month}-01` > range.min
  const canNext = `${shiftMonth(month, 1)}-01` <= range.max
  /** Ay düğmesi: odak düğmede kalır; düğme sınırda kapanacaksa odak güne geçer (kaybolup sayfaya düşmesin) */
  const changeMonth = (delta: number) => {
    const next = shiftFocusMonth(focused, delta, range)
    const month = monthOf(next)
    moveFocus.current = delta < 0 ? `${month}-01` <= range.min : `${shiftMonth(month, 1)}-01` > range.max
    setFocused(next)
  }

  const NAV = 'flex h-9 w-9 items-center justify-center rounded-lg border border-navy-600 text-lg font-bold text-white hover:border-navy-500 disabled:cursor-default disabled:opacity-30'

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={onDialogKey}
      style={{ left, width }}
      className="absolute top-full z-30 mt-2 max-w-full rounded-2xl border border-navy-500 bg-navy-800 p-3 shadow-xl"
      data-testid="day-calendar"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" className={NAV} aria-label="Önceki ay" disabled={!canPrev} onClick={() => changeMonth(-1)} data-testid="day-calendar-prev">
          ‹
        </button>
        <h2 id={titleId} className="text-sm font-extrabold" aria-live="polite" data-testid="day-calendar-title">
          {monthTitle(month)}
        </h2>
        <button type="button" className={NAV} aria-label="Sonraki ay" disabled={!canNext} onClick={() => changeMonth(1)} data-testid="day-calendar-next">
          ›
        </button>
      </div>
      <table role="grid" aria-labelledby={titleId} className="w-full table-fixed border-separate border-spacing-0.5 text-center" onKeyDown={onGridKey}>
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th key={d.long} scope="col" abbr={d.long} className="pb-1 text-xs font-bold text-muted">
                {d.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(month).map((week) => (
            <tr key={week[0]}>
              {week.map((date) => {
                if (monthOf(date) !== month) return <td key={date} />
                const enabled = available.has(date)
                const isSelected = date === selected
                const isFocused = date === focused
                return (
                  <td
                    key={date}
                    ref={isFocused ? focusedCell : undefined}
                    tabIndex={isFocused ? 0 : -1}
                    aria-selected={isSelected}
                    aria-disabled={!enabled || undefined}
                    aria-label={calendarDayLabel(date, today, enabled)}
                    aria-current={date === today ? 'date' : undefined}
                    onClick={() => {
                      setFocused(date)
                      choose(date)
                    }}
                    data-testid={`day-calendar-${date}`}
                    className={`h-9 rounded-lg border text-sm outline-none focus-visible:ring-2 focus-visible:ring-white ${
                      isSelected
                        ? 'border-brand bg-brand font-extrabold text-navy-950'
                        : date === today
                          ? 'border-brand'
                          : 'border-transparent'
                    } ${enabled ? (isSelected ? 'cursor-pointer' : 'cursor-pointer font-bold text-white hover:bg-navy-600') : 'cursor-default text-navy-500'}`}
                  >
                    {Number(date.slice(8))}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
