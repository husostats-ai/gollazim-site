import { useApp } from '../state/AppContext'
import { formatDateChip } from '../utils/format'

export default function DatePicker() {
  const { dates, selectedDate, selectDate, today } = useApp()
  if (dates.length === 0) return null
  return (
    <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4" role="tablist" aria-label="Tarih">
      {dates.map((date) => {
        const active = date === selectedDate
        return (
          <button
            key={date}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => selectDate(date)}
            className={`shrink-0 rounded-xl border px-3.5 py-2 text-sm font-bold whitespace-nowrap transition-colors ${
              active
                ? 'border-brand bg-navy-700 text-brand'
                : 'border-navy-600 text-muted hover:border-navy-500 hover:text-white'
            }`}
          >
            {formatDateChip(date, today)}
          </button>
        )
      })}
    </div>
  )
}
