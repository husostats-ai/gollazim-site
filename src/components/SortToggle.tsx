import type { SortMode } from '../services/analysis/types'
import { useApp } from '../state/AppContext'

const OPTIONS: { mode: SortMode; label: string }[] = [
  { mode: 'percent', label: 'Yüzdeye göre' },
  { mode: 'cautious', label: 'Temkinli sıra' },
]

export default function SortToggle() {
  const { sortMode, setSortMode } = useApp()
  return (
    <div className="inline-flex rounded-xl border border-navy-600 bg-navy-800 p-0.5" role="group" aria-label="Sıralama">
      {OPTIONS.map(({ mode, label }) => (
        <button
          key={mode}
          type="button"
          aria-pressed={sortMode === mode}
          onClick={() => setSortMode(mode)}
          className={`rounded-[10px] px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors ${
            sortMode === mode ? 'bg-brand text-navy-950' : 'text-muted hover:text-white'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
