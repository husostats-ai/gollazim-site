import type { PredictionNote } from '../services/analysis/types'

/** Hesaplayıcının verdiği uyarılar (çelişki, zayıf xG, model sapması) */
export default function NoteBadges({ notes }: { notes: PredictionNote[] }) {
  return (
    <>
      {notes.map((note) => (
        <span
          key={note.kind}
          title={note.title}
          data-note={note.kind}
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
            note.kind === 'weak-xg'
              ? 'border-navy-500 bg-navy-600 text-muted'
              : 'border-warn-line bg-warn-soft text-warn'
          }`}
        >
          {note.kind !== 'weak-xg' && '⚠ '}
          {note.label}
        </span>
      ))}
    </>
  )
}
