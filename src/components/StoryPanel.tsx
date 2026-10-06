import { CATEGORIES } from '../config/categories'
import { useApp } from '../state/AppContext'
import DatePicker from './DatePicker'
import StoryButton from './StoryButton'

export default function StoryPanel() {
  const { dates } = useApp()
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4">
      <h2 className="font-extrabold tracking-wide">GÖRSEL OLUŞTUR</h2>
      <p className="mt-1 text-sm text-muted">
        Seçili günün önerilerinden 1080 × 1920 Instagram Story görseli (PNG). Görsele yalnızca kategori
        sayfalarında “Görsele ekle” ile işaretlediğiniz maçlar girer; maçlar yüzdeye göre sıralanır, oranlar yer almaz.
      </p>
      {dates.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Henüz maç verisi yok.</p>
      ) : (
        <>
          <div className="mt-3">
            <DatePicker />
          </div>
          <ul className="mt-2 divide-y divide-line">
            {CATEGORIES.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="text-sm font-semibold">{c.label}</span>
                <StoryButton categoryId={c.id} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
