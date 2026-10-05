import { useState } from 'react'
import { useApp } from '../state/AppContext'
import DatePicker from './DatePicker'
import MatchEditForm from './MatchEditForm'

export default function MatchEditPanel() {
  const { matches, dates, refresh } = useApp()
  const [editingId, setEditingId] = useState<string | null>(null)
  const sorted = [...matches].sort(
    (a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.home.localeCompare(b.home, 'tr'),
  )

  const onDone = async () => {
    setEditingId(null)
    await refresh()
  }

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4">
      <h2 className="font-extrabold tracking-wide">MAÇLARI DÜZENLE</h2>
      <p className="mt-1 text-sm text-muted">
        Takım adı, lig, tarih, saat ve analizde kullanılan istatistikleri düzeltebilirsiniz. Düzenlenen maç, aynı CSV
        tekrar yüklense de korunur; CSV’deki değerlere dönmek için maçı silip CSV’yi yeniden yükleyin.
      </p>
      {dates.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Henüz maç verisi yok.</p>
      ) : (
        <>
          <div className="mt-3">
            <DatePicker />
          </div>
          <ul className="mt-2 divide-y divide-line">
            {sorted.map((m) => (
              <li key={m.id} className="py-2.5" data-testid="match-row">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold break-words">
                      {m.home} <span className="text-muted">–</span> {m.away}
                      {m.edited && (
                        <span className="ml-2 rounded-full border border-info-line bg-info-soft px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-info">
                          düzenlendi
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted">{[m.time, m.league].filter(Boolean).join(' · ')}</p>
                  </div>
                  {editingId !== m.id && (
                    <button
                      type="button"
                      onClick={() => setEditingId(m.id)}
                      className="shrink-0 rounded-lg border border-navy-500 px-3 py-1.5 text-xs font-bold hover:bg-navy-600"
                    >
                      Düzenle
                    </button>
                  )}
                </div>
                {editingId === m.id && (
                  <MatchEditForm match={m} onDone={onDone} onCancel={() => setEditingId(null)} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
