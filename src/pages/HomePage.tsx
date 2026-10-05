import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { EmptyAnalysis } from '../components/AnalysisNotice'
import DayToolbar from '../components/DayToolbar'
import EmptyState from '../components/EmptyState'
import NoData from '../components/NoData'
import PageTitle from '../components/PageTitle'
import PredictionRow from '../components/PredictionRow'
import { categoriesInGroup, GROUPS, HOME_PREVIEW_COUNT, standaloneCategories } from '../config/categories'
import { comparePredictions } from '../services/analysis/engine'
import { useApp } from '../state/AppContext'

function Section({ title, to, children }: { title: string; to: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-navy-700 p-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="font-extrabold tracking-wide">{title}</h2>
        <Link to={to} className="shrink-0 text-xs font-bold text-brand hover:underline">
          TÜMÜNÜ GÖR
        </Link>
      </div>
      {children}
    </section>
  )
}

export default function HomePage() {
  const { analysis, matches, dates, sortMode, loading } = useApp()

  return (
    <>
      <PageTitle title="GÜNÜN ANALİZLERİ" />
      {loading ? null : dates.length === 0 ? (
        <NoData />
      ) : (
        <>
          <DayToolbar />
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
            {standaloneCategories().map((c) => {
              const a = analysis[c.id]
              return (
                <Section key={c.id} title={c.label} to={`/kategori/${c.slug}`}>
                  {a.predictions.length === 0 ? (
                    <div className="mt-2">
                      <EmptyAnalysis analysis={a} total={matches.length} />
                    </div>
                  ) : (
                    <ul className="divide-y divide-line">
                      {a.predictions.slice(0, HOME_PREVIEW_COUNT).map((p) => (
                        <PredictionRow key={p.match.id} prediction={p} sortMode={sortMode} />
                      ))}
                    </ul>
                  )}
                </Section>
              )
            })}
            {GROUPS.map((g) => {
              // Grubun alt kategorilerindeki önerilerin en güçlüleri, tek listede.
              const top = categoriesInGroup(g.id)
                .flatMap((c) => analysis[c.id].predictions)
                .sort(comparePredictions(sortMode))
                .slice(0, HOME_PREVIEW_COUNT)
              return (
                <Section key={g.id} title={g.label} to={`/${g.slug}`}>
                  {top.length === 0 ? (
                    <div className="mt-2">
                      <EmptyState>
                        {matches.length === 0 ? 'Bu tarih için maç verisi yok.' : 'Eşiği geçen maç yok.'}
                      </EmptyState>
                    </div>
                  ) : (
                    <ul className="divide-y divide-line">
                      {top.map((p) => (
                        <PredictionRow
                          key={`${p.categoryId}:${p.match.id}`}
                          prediction={p}
                          sortMode={sortMode}
                          showCategory
                        />
                      ))}
                    </ul>
                  )}
                </Section>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
