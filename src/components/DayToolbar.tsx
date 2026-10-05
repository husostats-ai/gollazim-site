import { useApp } from '../state/AppContext'
import { formatLongDate } from '../utils/format'
import DatePicker from './DatePicker'
import SortToggle from './SortToggle'

/** Tarih seçici + sıralama anahtarı; analiz gösteren tüm sayfaların üstünde yer alır. */
export default function DayToolbar() {
  const { selectedDate, today, matches, dates, sortMode } = useApp()
  if (dates.length === 0) return null
  return (
    <div className="mb-5 space-y-3">
      <DatePicker />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {selectedDate && (
          <p className="text-sm text-muted">
            <span className="font-bold text-white">
              {selectedDate === today ? 'BUGÜNÜN MAÇLARI' : formatLongDate(selectedDate)}
            </span>{' '}
            · {matches.length} maç
          </p>
        )}
        <SortToggle />
      </div>
      {!dates.includes(today) && (
        <p className="rounded-xl border border-navy-600 bg-navy-800 px-3 py-2 text-xs text-muted">
          Bugün için yüklenmiş maç verisi yok; en yakın verili gün gösteriliyor.
        </p>
      )}
      {sortMode === 'cautious' && (
        <p className="rounded-xl border border-info-line bg-info-soft px-3 py-2 text-xs text-info">
          Temkinli sıra: maçlar, örneklem büyüklüğüne göre düzeltilmiş yüzdeye göre dizilir. Gösterilen yüzde ve
          eşik kontrolü ham değerle yapılır; düzeltilmiş değer ayrı rozet olarak görünür.
        </p>
      )}
    </div>
  )
}
