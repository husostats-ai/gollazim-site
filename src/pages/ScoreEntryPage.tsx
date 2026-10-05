import { useMemo, useState } from 'react'
import DatePicker from '../components/DatePicker'
import EmptyState from '../components/EmptyState'
import NoData from '../components/NoData'
import PageTitle from '../components/PageTitle'
import ScoreForm from '../components/ScoreForm'
import { CATEGORIES } from '../config/categories'
import { useApp } from '../state/AppContext'

export default function ScoreEntryPage() {
  const { matches, dates, loading, analysis, picks, results } = useApp()
  const [onlyRecommended, setOnlyRecommended] = useState(true)

  // Önerilen, önerisi dondurulmuş veya skoru girilmiş maçlar
  const relevantIds = useMemo(() => {
    const ids = new Set<string>([...picks.map((p) => p.matchId), ...Object.keys(results)])
    for (const c of CATEGORIES) for (const p of analysis[c.id].predictions) ids.add(p.match.id)
    return ids
  }, [analysis, picks, results])

  const sorted = [...matches].sort(
    (a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.home.localeCompare(b.home, 'tr'),
  )
  const visible = onlyRecommended ? sorted.filter((m) => relevantIds.has(m.id)) : sorted
  const entered = visible.filter((m) => results[m.id]).length

  return (
    <>
      <PageTitle
        title="SKOR GİRİŞİ"
        subtitle="Kazandı / kaybetti yalnızca “Tamamlandı” olarak kaydedilen maçlar için hesaplanır."
      />
      {loading ? null : dates.length === 0 ? (
        <NoData />
      ) : (
        <>
          <div className="mb-4 space-y-3">
            <DatePicker />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">
                {visible.length} maç · {entered} skor girildi
              </p>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={onlyRecommended}
                  onChange={(e) => setOnlyRecommended(e.target.checked)}
                  className="h-4 w-4 accent-brand"
                />
                Sadece önerilen maçlar
              </label>
            </div>
          </div>
          {visible.length === 0 ? (
            <EmptyState>
              {matches.length === 0 ? 'Bu tarih için maç verisi yok.' : 'Bu tarihte önerilen maç yok.'}
            </EmptyState>
          ) : (
            <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((m) => (
                <ScoreForm key={m.id} match={m} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
