import { RELIABILITY_LABELS, SAMPLE_HINT, sampleText } from '../services/analysis/reliability'
import type { Reliability, ReliabilityLevel } from '../services/analysis/types'

const TONE: Record<ReliabilityLevel, string> = {
  high: 'border-win-line bg-win-soft text-win',
  medium: 'border-warn-line bg-warn-soft text-warn',
  low: 'border-loss-line bg-loss-soft text-loss-text',
  unknown: 'border-navy-500 bg-navy-600 text-muted',
  unmeasured: 'border-navy-500 bg-navy-600 text-muted',
  market: 'border-info-line bg-info-soft text-info',
  'market-partial': 'border-info-line bg-info-soft text-info',
}

const TITLE: Record<ReliabilityLevel, string> = {
  high: 'Yüzdeler geniş bir maç örneklemine dayanıyor.',
  medium: 'Yüzdeler orta büyüklükte bir maç örneklemine dayanıyor.',
  low: 'Yüzdeler az sayıda maça dayanıyor; %100 gibi değerler yanıltıcı olabilir.',
  unknown: 'Bu maç için örneklem büyüklüğü çıkarılamadı.',
  unmeasured: 'Korner ve kart verisinin kaç maça dayandığı CSV’den ölçülemiyor.',
  market: 'Yüzde, 1X2 ve 2.5 Alt/Üst oranlarına kalibre edilmiş skor modelinden geliyor.',
  'market-partial': '2.5 Alt/Üst oranı yok: taraf 1X2 oranlarından, toplam gol xG ve gol ortalamasından tahmin edildi.',
}

/** compact: liste satırları için kısa biçim */
export default function ReliabilityBadge({ reliability, compact }: { reliability: Reliability; compact?: boolean }) {
  const { level, sampleSize } = reliability
  const isMarket = level === 'market' || level === 'market-partial'
  const sample = sampleSize !== null ? (compact ? `≥${sampleSize} maç` : sampleText(sampleSize)) : null
  return (
    <span
      title={sample ? `${TITLE[level]} ${SAMPLE_HINT}` : TITLE[level]}
      // Uzun biçim çok dar ekranda (320 px) kartı taşırmasın diye satır atlayabilir.
      className={`inline-flex max-w-full items-center gap-x-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        compact ? 'whitespace-nowrap' : 'flex-wrap'
      } ${TONE[level]}`}
    >
      {!compact && !isMarket && <span className="font-normal opacity-80">Veri güvenilirliği:</span>}
      {compact && level === 'unmeasured' ? 'Güv. ölçülemedi' : RELIABILITY_LABELS[level]}
      {sample && <span className="font-normal opacity-80">· {sample}</span>}
    </span>
  )
}
