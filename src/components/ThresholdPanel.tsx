import { useEffect, useState } from 'react'
import { CATEGORIES, defaultThresholds, type CategoryDef, type CategoryId } from '../config/categories'
import { useApp } from '../state/AppContext'

const parseThreshold = (text: string): number | null => {
  if (!/^\d{1,3}$/.test(text.trim())) return null
  const value = Number(text)
  return value <= 100 ? value : null
}

function ThresholdRow({ category }: { category: CategoryDef }) {
  const { thresholds, saveThresholds, analysis, matches } = useApp()
  const saved = thresholds[category.id]
  const [draft, setDraft] = useState(String(saved))
  const invalid = parseThreshold(draft) === null

  // Sıfırlama veya yedek yükleme gibi dışarıdan gelen değişiklikleri yansıt.
  useEffect(() => setDraft(String(saved)), [saved])

  const onChange = (text: string) => {
    setDraft(text)
    const value = parseThreshold(text)
    if (value !== null && value !== saved) void saveThresholds({ ...thresholds, [category.id]: value })
  }

  const a = analysis[category.id]
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
      <label htmlFor={`threshold-${category.id}`} className="min-w-0 text-sm font-semibold">
        {category.label} <span className="font-normal text-muted">minimum oranı</span>
        <span className="block text-xs font-normal text-muted">
          {matches.length === 0
            ? 'Seçili gün için maç yok'
            : `Seçili günde ${a.qualifiedCount} maç eşiği geçiyor (${a.evaluatedCount} maçtan)`}
          {saved !== category.defaultThreshold && ` · varsayılan %${category.defaultThreshold}`}
        </span>
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id={`threshold-${category.id}`}
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => invalid && setDraft(String(saved))}
          aria-invalid={invalid}
          className={`w-20 rounded-lg border bg-navy-800 px-2.5 py-1.5 text-right text-sm font-bold outline-none focus:border-brand ${
            invalid ? 'border-loss' : 'border-navy-500'
          }`}
        />
        <span className="text-sm font-bold text-muted">%</span>
      </div>
    </li>
  )
}

export default function ThresholdPanel() {
  const { thresholds, saveThresholds } = useApp()
  const defaults = defaultThresholds()
  const isDefault = (Object.keys(defaults) as CategoryId[]).every((id) => thresholds[id] === defaults[id])

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-extrabold tracking-wide">EŞİK DEĞERLERİ</h2>
          <p className="mt-1 text-sm text-muted">
            Bir kategoride yüzdesi eşiğin altında kalan maçlar gösterilmez. Değişiklik yazdığınız anda kaydedilir
            ve tüm listeler güncellenir. Daha önce skoru girilmiş maçların sonuçları etkilenmez.
          </p>
        </div>
        <button
          type="button"
          disabled={isDefault}
          onClick={() => void saveThresholds(defaults)}
          className="rounded-xl border border-navy-500 px-3.5 py-2 text-sm font-bold hover:bg-navy-600 disabled:opacity-40"
        >
          Varsayılana sıfırla
        </button>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {CATEGORIES.map((c) => (
          <ThresholdRow key={c.id} category={c} />
        ))}
      </ul>
    </section>
  )
}
