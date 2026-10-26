import { HT05_GROUP_KEYS, HT05_GROUP_LABELS, HT05_NOTE_STATS_NOTE, ht05Share, type Ht05GroupKey, type Ht05GroupStats } from '../../services/stats/ht05NoteStats'

/** "İY 0.5 ÜST tutmadığında 2. yarı" kartının (*) notu satırları: metin satırları, dar ekranda sarar. */
export default function Ht05NoteRows({ stats }: { stats: Record<Ht05GroupKey, Ht05GroupStats> }) {
  return (
    <div className="mt-4 border-t border-line pt-3" data-testid="ht05-note-stats">
      <p className="text-xs font-bold tracking-wide text-muted">UYARI (*) KOŞULU</p>
      <ul className="mt-2 space-y-2.5">
        {HT05_GROUP_KEYS.map((key) => {
          const g = stats[key]
          return (
            <li key={key} className="text-sm break-words" data-testid={`ht05-note-row-${key}`}>
              <p className="font-bold">{HT05_GROUP_LABELS[key]}</p>
              <p className="text-muted">
                Kapsamdaki maç: <span className="text-white">{g.scored}</span> · İY 0.5 ÜST tuttu: <span className="text-white">{g.htWon}</span> · İlk yarı 0-0 (N): <span className="text-white">{g.scoreless}</span>
                {g.excluded > 0 && ` · kapsam dışı: ${g.excluded}`}
              </p>
              {g.scoreless > 0 && (
                <p className="text-muted">
                  2Y 1.5 ÜST oldu: <span className="text-white">{ht05Share(g.over, g.scoreless)}</span> · olmadı:{' '}
                  <span className="text-white">{ht05Share(g.scoreless - g.over, g.scoreless)}</span> · 2. yarıda en az 3 gol:{' '}
                  <span className="text-white">{ht05Share(g.three, g.scoreless)}</span>
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">{HT05_NOTE_STATS_NOTE}</p>
    </div>
  )
}
