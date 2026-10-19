import { useId, useState } from 'react'
import type { MemberOther } from '../services/member/payload'
import { categoryLabel as labelOf, isOverstated, OTHER_COMPUTED_TAG, othersTitle, percentKind } from './view'

/**
 * "Aynı maçın diğer önerileri" katlanabilir bölümde; varsayılan kapalı. İçerik eskisiyle birebir aynıdır
 * (sıra, yüzdeler, "(hesaplanan)" işaretleri). Kapalıyken satır DOM'da kalır ama görünmez ve yer tutmaz;
 * açılma kısa bir yükseklik geçişiyle olur, hareket azaltma tercihinde geçiş yoktur.
 */
export default function MemberOthers({ others }: { others: MemberOther[] }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  if (others.length === 0) return null
  return (
    <div data-testid="member-others-section">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs font-semibold text-muted hover:text-white"
        data-testid="member-others-toggle"
      >
        {othersTitle(others.length)} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      <div
        id={id}
        className={`grid transition-[grid-template-rows,visibility] duration-150 ease-out motion-reduce:transition-none ${open ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]'}`}
        data-open={open}
      >
        <div className="min-h-0 overflow-hidden">
          {/* Küçük ve soluk: ana yüzdeyle yarışmaz. Sığmayan öneri alt satıra iner. */}
          <p className="pt-1 text-[11px] leading-relaxed text-muted" data-testid="member-others">
            <span className="mr-1.5">Aynı maçın diğer önerileri:</span>
            {others.map((other, index) => {
              const dim = isOverstated(other)
              return (
                <span key={other.categoryId} className="inline-block max-w-full break-words" data-testid="member-other" data-category={other.categoryId} data-overstated={dim}>
                  {index > 0 && <span aria-hidden="true">&nbsp;·&nbsp;</span>}
                  {labelOf(other.categoryId)} <span className={dim ? '' : 'font-semibold text-white'}>%{other.percent}</span>
                  {percentKind(other.categoryId) === 'model' && <span> {OTHER_COMPUTED_TAG}</span>}
                </span>
              )
            })}
          </p>
        </div>
      </div>
    </div>
  )
}
