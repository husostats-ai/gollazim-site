import { useEffect, useState } from 'react'
import { DEFAULT_MARKET_CONFLICT_LIMIT, MARKET_CONFLICT_LIMIT_RANGE } from '../services/analysis/market'
import { useApp } from '../state/AppContext'

const parseLimit = (text: string): number | null => {
  if (!/^\d{1,3}$/.test(text.trim())) return null
  const value = Number(text)
  return value >= MARKET_CONFLICT_LIMIT_RANGE.min && value <= MARKET_CONFLICT_LIMIT_RANGE.max ? value : null
}

/** "Piyasa çelişkisi" rozetinin sınırı. */
export default function MarketLimitPanel() {
  const { marketConflictLimit: saved, saveMarketConflictLimit } = useApp()
  const [draft, setDraft] = useState(String(saved))
  const invalid = parseLimit(draft) === null

  // Yedek yükleme gibi dışarıdan gelen değişiklikleri yansıt.
  useEffect(() => setDraft(String(saved)), [saved])

  const onChange = (text: string) => {
    setDraft(text)
    const value = parseLimit(text)
    if (value !== null && value !== saved) void saveMarketConflictLimit(value)
  }

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4">
      <h2 className="font-extrabold tracking-wide">AYARLAR: PİYASA ÇELİŞKİSİ SINIRI</h2>
      <p className="mt-1 text-sm text-muted">
        Hazır yüzde ile oranlardan çıkarılan piyasa yüzdesi arasındaki fark en az bu kadar puansa kartta “Piyasa
        çelişkisi” rozeti görünür. Yüzdeyi, eşiği, yıldızı ve sıralamayı etkilemez. Daha önce dondurulmuş önerilerin
        kayıtlı çelişki bilgisi değişmez.
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="market-conflict-limit" className="text-sm font-semibold">
          Çelişki sınırı
          {saved !== DEFAULT_MARKET_CONFLICT_LIMIT && (
            <span className="block text-xs font-normal text-muted">varsayılan {DEFAULT_MARKET_CONFLICT_LIMIT} puan</span>
          )}
        </label>
        <div className="flex items-center gap-1.5">
          <input
            id="market-conflict-limit"
            type="number"
            inputMode="numeric"
            min={MARKET_CONFLICT_LIMIT_RANGE.min}
            max={MARKET_CONFLICT_LIMIT_RANGE.max}
            step={1}
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => invalid && setDraft(String(saved))}
            aria-invalid={invalid}
            data-testid="market-conflict-limit"
            className={`w-20 rounded-lg border bg-navy-800 px-2.5 py-1.5 text-right text-sm font-bold outline-none focus:border-brand ${
              invalid ? 'border-loss' : 'border-navy-500'
            }`}
          />
          <span className="text-sm font-bold text-muted">puan</span>
        </div>
      </div>
    </section>
  )
}
