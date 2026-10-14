import { SORT_GROUP_LABEL, SORT_LABELS, type MemberSortMode } from './view'

const MODES: MemberSortMode[] = ['percent', 'time']

/** "Yüzdeye göre | Saate göre" geçişi: yalnızca listenin dizilişini değiştirir. */
export default function MemberSortToggle({ mode, onChange }: { mode: MemberSortMode; onChange: (mode: MemberSortMode) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-xl border border-navy-600 bg-navy-800 p-0.5" role="group" aria-label={SORT_GROUP_LABEL} data-testid="member-sort">
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          data-testid={`member-sort-${m}`}
          className={`rounded-[10px] px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors ${mode === m ? 'bg-brand text-navy-950' : 'text-muted hover:text-white'}`}
        >
          {SORT_LABELS[m]}
        </button>
      ))}
    </div>
  )
}
