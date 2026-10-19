import { csText, FORM_TITLE, formLetters, formSpoken, GOALS_TITLE, type TeamFormValue } from '../components/TeamForm'
import { STALE_TABLE_LABEL, standingText } from '../services/member/labels'
import type { MemberStanding } from '../services/member/payload'

// Üye kartında sıra ve form tek blokta: her takım için tek satır (sıra · maç, G/B/M kutucukları, gol),
// altında gol yemediği maç. Admin kartı ortak TeamForm'u kullanmaya devam eder; metinler ve
// kutucuklar oradan gelir, sıra ve değerler aynen korunur. Dar ekranda sıra bilgisi kutucukların
// üstüne kırılır.

function Row({ side, standing, form }: { side: string; standing: MemberStanding | null; form: TeamFormValue | null }) {
  if (!standing && !form) return null
  const letters = form ? formLetters(form.last) : []
  return (
    <div data-testid="member-team" data-side={side}>
      <div className="flex items-start gap-2">
        <span className="w-7 shrink-0 leading-5 font-semibold text-white">{side}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          {standing && (
            <span className="leading-5" data-testid="member-standing">
              {standingText(standing)}
              {standing.stale && <span className="font-bold text-warn"> · {STALE_TABLE_LABEL}</span>}
            </span>
          )}
          {form && (
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {letters.length > 0 && (
                <span className="flex gap-1" data-testid="team-form-letters">
                  <span className="sr-only">{formSpoken(form.last)}</span>
                  {letters.map((l, i) => (
                    <span key={i} aria-hidden="true" className={`grid h-5 w-5 place-items-center rounded border text-[11px] leading-none font-bold ${l.tone}`}>
                      {l.letter}
                    </span>
                  ))}
                </span>
              )}
              <span className="whitespace-nowrap" data-testid="team-form-goals">
                Gol <span className="font-semibold text-white">{form.gf}–{form.ga}</span>
              </span>
            </span>
          )}
        </div>
      </div>
      {form && form.cs !== null && (
        <p className="pl-9 text-[11px] opacity-80" data-testid="team-form-cs">
          {csText(form.cs)}
        </p>
      )}
    </div>
  )
}

interface Props {
  homeStanding: MemberStanding | null
  awayStanding: MemberStanding | null
  homeForm: TeamFormValue | null
  awayForm: TeamFormValue | null
}

/** İki takımın sıra + form satırları; hiçbiri yoksa hiçbir şey çizilmez */
export default function MemberTeams({ homeStanding, awayStanding, homeForm, awayForm }: Props) {
  if (!homeStanding && !awayStanding && !homeForm && !awayForm) return null
  return (
    <div className="space-y-1.5 border-t border-line pt-2.5 text-xs text-muted" data-testid="member-teams">
      {(homeForm || awayForm) && (
        <p className="text-[11px] opacity-80" data-testid="member-form">
          {FORM_TITLE} · {GOALS_TITLE}
        </p>
      )}
      <Row side="Ev" standing={homeStanding} form={homeForm} />
      <Row side="Dep" standing={awayStanding} form={awayForm} />
    </div>
  )
}
