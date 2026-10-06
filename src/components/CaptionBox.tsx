import { useEffect, useState } from 'react'
import { copyText } from '../utils/clipboard'

interface Props {
  /** Üretilen Instagram açıklaması ve Telegram mesajı; kaynak değişince kutular yeniden dolar */
  instagram: string
  telegram: string
  testId: string
}

function Field({ label, source, testId }: { label: string; source: string; testId: string }) {
  const [text, setText] = useState(source)
  const [copied, setCopied] = useState<boolean | null>(null)
  // Seçim ya da ayar değişince metin yeniden üretilir; elle yapılan düzeltme o zaman sıfırlanır.
  useEffect(() => {
    setText(source)
    setCopied(null)
  }, [source])

  return (
    <label className="block min-w-0 text-xs font-semibold">
      <span className="flex flex-wrap items-center justify-between gap-2">
        {label}
        <button
          type="button"
          onClick={async () => setCopied(await copyText(text))}
          data-testid={`${testId}-copy`}
          className="rounded-lg border border-brand px-2.5 py-1.5 text-xs font-bold text-brand hover:bg-navy-600"
        >
          {copied === true ? 'Kopyalandı' : copied === false ? 'Kopyalanamadı' : 'Kopyala'}
        </button>
      </span>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setCopied(null)
        }}
        rows={8}
        data-testid={testId}
        className="mt-1.5 block w-full rounded-lg border border-navy-500 bg-navy-800 px-2.5 py-2 text-sm leading-snug font-normal outline-none focus:border-brand"
      />
    </label>
  )
}

/** Paylaşım için düzenlenebilir iki metin kutusu. Kayıt oluşturmaz; yalnızca kopyalar. */
export default function CaptionBox({ instagram, telegram, testId }: Props) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 rounded-xl border border-line bg-navy-800 p-3 md:grid-cols-2" data-testid={`${testId}-box`}>
      <Field label="Instagram açıklaması" source={instagram} testId={`${testId}-instagram`} />
      <Field label="Telegram mesajı" source={telegram} testId={`${testId}-telegram`} />
      <p className="text-[11px] text-muted md:col-span-2">
        Metinler düzenlenebilir. Kopyalamak paylaşıldı kaydı oluşturmaz. Telegram, Instagram, uyarı ve hashtag metinleri
        Admin sayfasından değiştirilir.
      </p>
    </div>
  )
}
