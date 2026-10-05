import { AI_CHUNK_SIZE, AI_DECISIONS, AI_PROVIDERS, type AiProvider } from '../../config/ai'
import { getCategory } from '../../config/categories'
import { formatNumber } from '../../utils/format'
import { RELIABILITY_LABELS } from '../analysis/reliability'
import { goalModelPercent, MODEL_CONFLICT_LIMIT } from '../analysis/goalModel'
import { stat } from '../analysis/stat'
import type { Prediction } from '../analysis/types'
import type { AiMatchItem } from './collect'

export interface PromptChunk {
  /** 1'den başlar */
  index: number
  total: number
  /** Bu parçadaki ilk ve son maç numarası */
  from: number
  to: number
  text: string
}

export const DATA_START = '=== VERİ BAŞLANGICI ==='
export const DATA_END = '=== VERİ SONU ==='

const MISSING = 'veri yok'
const num = (value: number | null): string => (value === null ? MISSING : formatNumber(value))
const pair = (home: number | null, away: number | null): string =>
  home === null && away === null ? MISSING : `ev ${num(home)} / deplasman ${num(away)}`

function predictionText(p: Prediction): string {
  const details: string[] = [`güvenilirlik: ${RELIABILITY_LABELS[p.reliability.level]}`]
  if (p.reliability.sampleSize !== null) details.push(`en az ${p.reliability.sampleSize} maçlık veri`)
  // Cümle içinde: "Model" -> "model", "xG modeli" olduğu gibi
  const secondLabel = p.secondLabel.charAt(0).toLocaleLowerCase('tr') + p.secondLabel.slice(1)
  if (p.secondPercent != null) details.push(`${secondLabel} %${p.secondPercent}`)
  for (const note of p.notes) details.push(note.label)
  return `${getCategory(p.categoryId).label} %${p.percent} (${details.join('; ')})`
}

const GOAL_MODEL_LINES = [
  ['over25', '2.5 Üst'],
  ['over35', '3.5 Üst'],
  ['over45', '4.5 Üst'],
  ['btts', 'KG Var'],
] as const

/** Bir maçın veri bloğundaki dört satırı. Numara, cevabın maça bağlanacağı tek anahtardır. */
export function matchBlock(item: AiMatchItem, number: number): string {
  const { match } = item
  const odds = [stat(match, 'oddsHome'), stat(match, 'oddsDraw'), stat(match, 'oddsAway')]
  const stats = [
    `Gol ortalaması: ${num(stat(match, 'avgGoals'))}`,
    `Korner ortalaması: ${num(stat(match, 'avgCorners'))}`,
    `Kart ortalaması: ${num(stat(match, 'avgCards'))}`,
    `Maç başı puan (PPG): ${pair(stat(match, 'homePpg'), stat(match, 'awayPpg'))}`,
    `Maç öncesi xG: ${pair(stat(match, 'homeXg'), stat(match, 'awayXg'))}`,
    `1X2 oranları: ${odds.every((o) => o === null) ? MISSING : odds.map(num).join(' / ')}`,
  ]
  const model = GOAL_MODEL_LINES.map(([id, label]) => {
    const result = goalModelPercent(match, id)
    return `${label} ${result ? `%${result.percent}` : MISSING}`
  })
  return [
    `#${number} | ${match.time ?? 'saat yok'} | ${match.league ?? 'lig yok'} | ${match.home} - ${match.away}`,
    `Öneriler: ${item.predictions.map(predictionText).join(' ; ')}`,
    `İstatistik: ${stats.join(' ; ')}`,
    `Gol modeli: ${model.join(' ; ')}`,
  ].join('\n')
}

function chunkText(args: {
  provider: AiProvider
  dateLabel: string
  blocks: string[]
  index: number
  total: number
  from: number
  to: number
  matchCount: number
}): string {
  const { provider, dateLabel, blocks, index, total, from, to, matchCount } = args
  const decisions = AI_DECISIONS.map((d) => d.label).join(', ')
  const part =
    total > 1
      ? ` Bu, ${total} parçalı listenin ${index}. parçasıdır (#${from}–#${to}); yalnızca bu parçadaki maçları değerlendir.`
      : ''
  return [
    `Sen temkinli bir futbol maç analistisin. Aşağıda ${dateLabel} tarihli ${matchCount} maçın istatistik verisi ve her maç için istatistiksel olarak öne çıkan öneriler var.${part}`,
    '',
    'KURALLAR',
    '- Yalnızca aşağıdaki VERİ bloğundaki bilgileri ve kendi aradığın kaynakları kullan.',
    '- Veri uydurma. Bilmediğin ya da bulamadığın bilgi için "bilinmiyor" yaz.',
    '- Kesinlik iddia etme. Yüzdeler geçmiş maç istatistiklerinden ve oranlardan hesaplanmış olasılık tahminleridir, garanti değildir.',
    '- "veri yok" yazan alanlar için tahmin yürütme.',
    `- "Gol modeli" satırı, maç öncesi xG değerlerinden (yoksa gol ortalamasından) Poisson ile hesaplanan ikinci bir tahmindir. Önerideki hazır yüzde ile model arasında ${MODEL_CONFLICT_LIMIT} puandan fazla fark varsa "Model çelişkisi" yazar; bunu kararında dikkate al.`,
    '',
    'GÖREV',
    `Her maç için listelenen önerilerin ne kadar güvenilir olduğunu değerlendir ve tek bir KARAR ver. KARAR şunlardan biri olmalı: ${decisions}.`,
    '',
    'CEVAP BİÇİMİ',
    '- Her maç için tek satır yaz: #numara | KARAR | gerekçe | risk',
    '- Markdown tablosu, kalın yazı, başlık ve madde işareti kullanma. Bu satırlar dışında hiçbir şey yazma.',
    '- Gerekçe en fazla iki cümle olsun. Risk kısa bir ifade olsun.',
    '- Verilen numaraları aynen kullan; maçları yeniden numaralama ve satır atlama.',
    '- Örnek satır: #1 | Orta | Ev sahibi son maçlarında gollü ancak ilk 11 belirsiz (kaynak adı). | Rotasyon ihtimali',
    '',
    DATA_START,
    blocks.join('\n\n'),
    DATA_END,
    '',
    AI_PROVIDERS.find((p) => p.id === provider)!.instruction,
  ].join('\n')
}

/**
 * Maç listesinden yapıştırılmaya hazır prompt parçaları üretir. Maç sayısı
 * chunkSize'ı aşarsa birden çok parça çıkar; her parça kuralları ve cevap
 * biçimini kendi içinde taşır, numaralar parçalar arasında devam eder.
 */
export function buildPrompts(
  items: AiMatchItem[],
  provider: AiProvider,
  dateLabel: string,
  chunkSize: number = AI_CHUNK_SIZE,
): PromptChunk[] {
  const total = Math.ceil(items.length / chunkSize)
  return Array.from({ length: total }, (_, i) => {
    const slice = items.slice(i * chunkSize, (i + 1) * chunkSize)
    const from = i * chunkSize + 1
    const to = from + slice.length - 1
    const blocks = slice.map((item, j) => matchBlock(item, from + j))
    const text = chunkText({ provider, dateLabel, blocks, index: i + 1, total, from, to, matchCount: slice.length })
    return { index: i + 1, total, from, to, text }
  })
}
