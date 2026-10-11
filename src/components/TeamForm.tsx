// Lig tablosundan gelen form, gol ve "gol yemediği maç" satırları. Admin kartı ve üye kartı aynı
// bileşeni kullanır; yalnızca çizer, veri okumaz ve hesap yapmaz. Üye sitesine girdiği için
// metinlerinde ham veriye, bahis terimlerine ya da üye sayfasında yasak kelimelere yer verilmez.

export interface TeamFormValue {
  /** Son maçlar, ham ("WWDDL"): soldan sağa eskiden yeniye; yoksa null */
  last: string | null
  /** Attığı gol */
  gf: number
  /** Yediği gol */
  ga: number
  /** Gol yemediği maçların yüzdesi (0-100); yoksa null */
  cs: number | null
}

export const FORM_TITLE = 'Son 5 maç (sağdaki en yeni)'
export const GOALS_TITLE = 'Gol: attığı–yediği'
export const csText = (cs: number): string => `Gol yemediği maç: %${cs}`

/**
 * Renk tek başına anlam taşımaz: her kutucukta harf yazar, ekran okuyucu tam adı okur.
 * İpucu (title) kullanılmaz: üye sayfasında yasaktır ve dokunmatik ekranda görünmez; "Gol"ün
 * ne olduğu başlık satırında açıkça yazar.
 */
const RESULTS = {
  W: { letter: 'G', label: 'Galibiyet', tone: 'border-win-line bg-win-soft text-win' },
  D: { letter: 'B', label: 'Beraberlik', tone: 'border-warn-line bg-warn-soft text-warn' },
  L: { letter: 'M', label: 'Mağlubiyet', tone: 'border-loss-line bg-loss-soft text-loss-text' },
} as const

export interface FormLetter {
  letter: 'G' | 'B' | 'M'
  label: string
  tone: string
}

/** "WWDDL" -> G G B B M; sıra korunur (en sağdaki en yeni). Tanınmayan harf varsa form hiç gösterilmez */
export function formLetters(last: string | null): FormLetter[] {
  if (!last || !/^[WDL]{1,5}$/.test(last)) return []
  return [...last].map((result) => RESULTS[result as keyof typeof RESULTS])
}

/** "Galibiyet, Galibiyet, Beraberlik" (ekran okuyucu için, eskiden yeniye) */
export const formSpoken = (last: string | null): string => formLetters(last).map((l) => l.label).join(', ')

interface Props {
  home: TeamFormValue | null
  away: TeamFormValue | null
  /** Yalnızca admin: satırın yanındaki not (ör. üyeye neden gitmediği) */
  notes?: { home?: string | null; away?: string | null }
  /** Yalnızca admin: bloğun altındaki soluk satır */
  footer?: string | null
  testId?: string
}

function Side({ side, value, note }: { side: string; value: TeamFormValue; note?: string | null }) {
  const letters = formLetters(value.last)
  return (
    <div data-testid="team-form-side" data-side={side}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-7 shrink-0 font-semibold text-white">{side}</span>
        {letters.length > 0 && (
          <span className="flex gap-1" data-testid="team-form-letters">
            <span className="sr-only">{formSpoken(value.last)}</span>
            {letters.map((l, i) => (
              <span key={i} aria-hidden="true" className={`grid h-5 w-5 place-items-center rounded border text-[11px] leading-none font-bold ${l.tone}`}>
                {l.letter}
              </span>
            ))}
          </span>
        )}
        <span className="whitespace-nowrap" data-testid="team-form-goals">
          Gol: <span className="font-semibold text-white">{value.gf}–{value.ga}</span>
        </span>
      </div>
      {value.cs !== null && (
        <p className="pl-9 text-[11px] opacity-80" data-testid="team-form-cs">
          {csText(value.cs)}
        </p>
      )}
      {note && (
        <p className="pl-9 text-[11px] font-bold text-warn" data-testid="team-form-note">
          {note}
        </p>
      )}
    </div>
  )
}

/** İki takımın form satırları; ikisi de yoksa hiçbir şey çizilmez */
export default function TeamForm({ home, away, notes, footer, testId = 'team-form' }: Props) {
  if (!home && !away) return null
  return (
    <div className="space-y-1.5 text-xs text-muted" data-testid={testId}>
      <p className="text-[11px] opacity-80">
        {FORM_TITLE} · {GOALS_TITLE}
      </p>
      {home && <Side side="Ev" value={home} note={notes?.home} />}
      {away && <Side side="Dep" value={away} note={notes?.away} />}
      {footer && <p className="text-[11px] opacity-80">{footer}</p>}
    </div>
  )
}
