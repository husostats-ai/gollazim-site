import { useEffect, useRef, useState } from 'react'
import { DEFAULT_STORY_TEXTS, STORY_TEXT_FIELDS, type StoryTexts } from '../config/storyTexts'
import { settingsRepo } from '../services/data'
import { useApp } from '../state/AppContext'

/** Günlük başarı görselinin altındaki metinlerin ayarı. */
export default function StoryTextsPanel() {
  const { dataVersion } = useApp()
  const [texts, setTexts] = useState<StoryTexts | null>(null)
  const pending = useRef<StoryTexts | null>(null)
  const writing = useRef(false)

  // Yedek yükleme gibi dışarıdan gelen değişiklikleri de yansıt.
  useEffect(() => {
    void settingsRepo.getStoryTexts().then(setTexts)
  }, [dataVersion])

  if (!texts) return null

  // Her tuşta ayrı yazma kuyruğa girmesin: yazma sürerken gelen değişikliklerden yalnızca sonuncusu kaydedilir.
  const flush = async () => {
    if (writing.current) return
    writing.current = true
    while (pending.current) {
      const next = pending.current
      pending.current = null
      await settingsRepo.setStoryTexts(next)
    }
    writing.current = false
  }
  const save = (next: StoryTexts) => {
    setTexts(next)
    pending.current = next
    void flush()
  }
  const isDefault = STORY_TEXT_FIELDS.every(({ key }) => texts[key] === DEFAULT_STORY_TEXTS[key])

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-extrabold tracking-wide">AYARLAR: GÖRSEL VE AÇIKLAMA METİNLERİ</h2>
          <p className="mt-1 text-sm text-muted">
            Story görsellerinin (kategori, sonuç ve günlük görsel) alt bloğunda ve açıklama metinlerinde kullanılır.
            Değişiklik yazdığınız anda kaydedilir. Boş bırakılan satır hiç yazılmaz; uyarı boşsa kategori görsellerinde
            “Veri destekli sinyal, garanti değil.” yazar.
          </p>
        </div>
        <button
          type="button"
          disabled={isDefault}
          onClick={() => save(DEFAULT_STORY_TEXTS)}
          className="rounded-xl border border-navy-500 px-3.5 py-2 text-sm font-bold hover:bg-navy-600 disabled:opacity-40"
        >
          Varsayılana sıfırla
        </button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3">
        {STORY_TEXT_FIELDS.map(({ key, label, maxLength }) => (
          <label key={key} className="block text-sm font-semibold">
            {label}
            <input
              type="text"
              value={texts[key]}
              maxLength={maxLength}
              onChange={(e) => save({ ...texts, [key]: e.target.value })}
              data-testid={`story-text-${key}`}
              className="mt-1 block w-full rounded-lg border border-navy-500 bg-navy-800 px-2.5 py-1.5 text-sm font-normal outline-none focus:border-brand"
            />
          </label>
        ))}
      </div>
    </section>
  )
}
