import Papa from 'papaparse'
import { AI_DECISIONS, AI_PROVIDERS, decisionLabel } from '../../config/ai'
import { CATEGORIES, categoriesInGroup, getCategory, type CategoryId } from '../../config/categories'
import type { AiVerdict, Match, MatchResult, Pick, ScoreLine, SharedPick, Thresholds } from '../../types'
import { toAppDateTime } from '../../utils/date'
import { formatDay, formatNumber, formatRate, shiftDate } from '../../utils/format'
import { AI_SOURCES, buildAiStats, type AiSource } from '../ai/aiStats'
import { MODEL_CONFLICT_LIMIT } from '../analysis/goalModel'
import { RELIABILITY_LABELS } from '../analysis/reliability'
import { stat } from '../analysis/stat'
import { findActiveShared, sharedPicksOnly } from '../story/shared'
import { backfillMarket, buildMarketStats } from './marketStats'
import { actualScore, buildScoreStats } from './scoreStats'
import { buildStarStats, frozenStars, recomputedNote, STAR_LEVELS } from './starStats'
import { buildStats, LOW_SAMPLE_LIMIT, tally, type Tally } from './statsEngine'

// İstatistik sayfasındaki tabloların düz metin (markdown) özeti ve ayrıntılı CSV.
// Yeni bir hesap içermez: sayılar statsEngine, marketStats ve aiStats çıktılarıdır ve
// sayfadaki biçimle (formatRate) yazılır. Metne kişisel veri, ham CSV içeriği ya da
// ayar anahtarı girmez.

export type SummaryScope = { kind: 'all' } | { kind: 'last7' } | { kind: 'last30' } | { kind: 'range'; from: string; to: string }

export const SCOPE_OPTIONS: { kind: SummaryScope['kind']; label: string }[] = [
  { kind: 'all', label: 'Tümü' },
  { kind: 'last7', label: 'Son 7 gün' },
  { kind: 'last30', label: 'Son 30 gün' },
  { kind: 'range', label: 'Tarih aralığı' },
]

export { frozenStars }

export const AI_GUIDE =
  'Aşağıda futbol istatistik tarama sitemin ölçülmüş sonuçları var. Görevin: sayıları yorumla; (1) hangi kategoriler yeterli örnekle güvenilir sonuç veriyor, (2) hangi farklar gerçek, hangileri küçük örneklem gürültüsü olabilir, (3) hazır yüzde, model ve piyasa karşılaştırmalarından ne çıkıyor, (4) hangi eşik/ayar değişikliklerini denemeye değer buluyorsun ve bunun için kaç sonuç daha gerekir. Kurallar: sayı uydurma, n<20 olan satırlardan kesin sonuç çıkarma, bahis tavsiyesi verme, belirsizliği açıkça söyle, kısa ve maddeli yaz.'

export const NO_DATA_TEXT = 'Henüz sonuçlanmış öneri yok'

/** Kapsamın tarih sınırları (dahil); "Tümü"nde sınır yoktur */
export function scopeBounds(scope: SummaryScope, today: string): { from: string | null; to: string | null } {
  if (scope.kind === 'last7') return { from: shiftDate(today, -6), to: today }
  if (scope.kind === 'last30') return { from: shiftDate(today, -29), to: today }
  if (scope.kind === 'range') return scope.from <= scope.to ? { from: scope.from, to: scope.to } : { from: scope.to, to: scope.from }
  return { from: null, to: null }
}

export const inScope = (date: string, bounds: { from: string | null; to: string | null }): boolean =>
  (bounds.from === null || date >= bounds.from) && (bounds.to === null || date <= bounds.to)

export interface SummaryInput {
  /** Özetin oluşturulduğu an */
  now: Date
  /** Bugün (Europe/Istanbul, YYYY-MM-DD); "son N gün" buna göre hesaplanır */
  today: string
  scope: SummaryScope
  includeGuide: boolean
  /** Tüm dondurulmuş öneriler; kapsam burada uygulanır */
  picks: Pick[]
  /** Önerilerin maç kayıtları (silinmiş olanlar eksik olabilir) */
  matches: Match[]
  /** Girilmiş skorlar (skor tahminleri bölümü ve CSV için); verilmezse o bölüm boş çıkar */
  results?: MatchResult[]
  verdicts: AiVerdict[]
  shared: SharedPick[]
  thresholds: Thresholds
  marketConflictLimit: number
}

const SOURCE_LABELS: Record<AiSource, string> = { chatgpt: 'ChatGPT', gemini: 'Gemini', consensus: 'Ortak karar' }

const table = (header: string[], rows: (string | number)[][]): string =>
  [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')

/** Sayfadaki "%77,2 · 31 öneri" biçimi; n sonuçlanmış (tuttu + tutmadı) öneridir */
export const rateCell = (t: Tally): string => `${formatRate(t.rate)} · n=${t.decided}`
const lowMark = (t: Tally): string => (t.decided > 0 && t.lowSample ? 'az veri' : '')
const signed = (value: number | null): string => (value === null ? '—' : `${value > 0 ? '+' : ''}${formatNumber(value)} puan`)

const unique = <T,>(values: T[]): T[] => [...new Set(values)]

/** Kapsama giren öneriler, kararlar ve paylaşım kayıtları */
export function scopeData(input: Pick_<SummaryInput, 'picks' | 'verdicts' | 'shared' | 'scope' | 'today'>) {
  const bounds = scopeBounds(input.scope, input.today)
  return {
    bounds,
    picks: input.picks.filter((p) => inScope(p.date, bounds)),
    verdicts: input.verdicts.filter((v) => inScope(v.date, bounds)),
    shared: input.shared.filter((r) => inScope(r.date, bounds)),
  }
}

type Pick_<T, K extends keyof T> = { [P in K]: T[P] }

/** Analiz için düz metin (markdown) özet. */
export function buildStatsSummary(input: SummaryInput): string {
  const { bounds, picks, verdicts, shared } = scopeData(input)
  const stats = buildStats(picks)
  const { overall } = stats
  const scopeLabel = SCOPE_OPTIONS.find((o) => o.kind === input.scope.kind)!.label
  const created = toAppDateTime(input.now)
  const dates = unique(picks.map((p) => p.date)).sort()

  const out: string[] = []
  if (input.includeGuide) out.push(AI_GUIDE, '')
  out.push('# GOL LAZIM istatistik özeti', '')
  out.push(
    `- Oluşturulma: ${formatDay(created.date)} ${created.time} (Europe/Istanbul)`,
    `- Kapsam: ${scopeLabel}${bounds.from && bounds.to ? ` (${formatDay(bounds.from)} – ${formatDay(bounds.to)})` : ''}`,
  )
  if (overall.decided === 0) {
    out.push(`- Dondurulmuş öneri: ${overall.total}`, '', `${NO_DATA_TEXT}.`)
    return out.join('\n')
  }
  out.push(
    `- Veri olan günler: ${dates.length} (${formatDay(dates[0])} – ${formatDay(dates[dates.length - 1])})`,
    `- Benzersiz maç: ${stats.matches.total} (en az bir önerisi sonuçlanan: ${stats.matches.decided})`,
    `- Dondurulmuş öneri: ${overall.total}`,
    `- Sonuçlanmış öneri (tuttu + tutmadı): ${overall.decided} (tutan ${overall.won}, tutmayan ${overall.lost})`,
    `- Değerlendirilemedi: ${overall.void}`,
    `- Bekliyor: ${overall.pending}`,
    `- Genel başarı: ${formatRate(overall.rate)}`,
    '',
    `Başarı oranı = tutan / (tutan + tutmayan). "Değerlendirilemedi" ve "bekliyor" orana girmez. n = sonuçlanmış öneri sayısı. "az veri": n < ${LOW_SAMPLE_LIMIT}. Aynı maç birden çok kategoride önerilebilir; her öneri ayrı sayılır.`,
    '',
  )

  out.push('## Güncel eşikler', '')
  out.push(table(['Kategori', 'Eşik'], CATEGORIES.map((c) => [c.label, `%${input.thresholds[c.id] ?? c.defaultThreshold}`])))
  out.push('', 'Öneriler, dondurulduğu andaki eşiklerle kaydedilir.', '')

  out.push('## Kategori başarısı', '')
  out.push(
    table(
      ['Kategori', 'Sonuçlanan', 'Tutan', 'Başarı', 'Az veri', 'Değerlendirilemedi', 'Bekliyor'],
      stats.byCategory.map((b) => [getCategory(b.key).label, b.tally.decided, b.tally.won, formatRate(b.tally.rate), lowMark(b.tally), b.tally.void, b.tally.pending]),
    ),
    '',
  )

  out.push('## Veri güvenilirliğine göre başarı', '')
  out.push(
    table(
      ['Güvenilirlik', 'Sonuçlanan', 'Tutan', 'Başarı', 'Az veri'],
      stats.byReliability.map((b) => [RELIABILITY_LABELS[b.key], b.tally.decided, b.tally.won, formatRate(b.tally.rate), lowMark(b.tally)]),
    ),
    '',
    'Güvenilirlik, önerinin dondurulduğu andaki rozettir.',
    '',
  )

  const stars = buildStarStats(picks)
  out.push('## Yıldız sayısına göre başarı', '')
  if (stars.byCategory.length === 0) out.push('Yıldızı bulunabilen öneri yok.', '')
  else {
    out.push(
      table(
        ['Yıldız', 'Sonuçlanan', 'Tutan', 'Başarı', 'Az veri'],
        stars.byStars.map((b) => [`${b.key} yıldız`, b.tally.decided, b.tally.won, formatRate(b.tally.rate), lowMark(b.tally)]),
      ),
      '',
      'Kategori bazında (her hücre: başarı · n):',
      '',
      table(['Kategori', ...STAR_LEVELS.map((s) => `${s} yıldız`)], stars.byCategory.map((row) => [getCategory(row.key).label, ...row.byStars.map(rateCell)])),
      '',
    )
  }
  out.push(
    [
      'Yıldız, önerinin dondurulduğu anda kartta görünen değerdir.',
      recomputedNote(stars) && `${recomputedNote(stars)}: yıldız kaydı eklenmeden önce dondurulmuş önerilerde yıldız, kayıtlı yüzde, güvenilirlik ve model çelişkisinden analizdeki kuralla yeniden bulundu.`,
      stars.missing > 0 && `${stars.missing} eski öneride (Taraf & Gol ya da güvenilirliği kayıtlı olmayan) yıldız bulunamadığı için bu tablolara girmez.`,
    ]
      .filter(Boolean)
      .join(' '),
    '',
  )

  const daily = stats.daily.slice(-14)
  out.push(`## Günlük sonuçlar${stats.daily.length > daily.length ? ' (son 14 gün)' : ''}`, '')
  out.push(table(['Gün', 'Genel başarı', 'Sonuçlanan', 'Tutan', 'Dondurulmuş öneri'], daily.map((b) => [formatDay(b.key), formatRate(b.tally.rate), b.tally.decided, b.tally.won, b.tally.total])), '')

  out.push('## Kalibrasyon: hazır yüzde ve gol modeli', '')
  if (!stats.goalModel) out.push('Model yüzdesi kayıtlı öneri yok.', '')
  else {
    out.push(
      table(
        ['Kategori', 'Hazır ort.', 'Model ort.', 'Gerçekleşen', 'Ort. fark (hazır − model)'],
        stats.goalModel.calibration.map((r) => [r.key === 'all' ? 'Dört kategori birlikte' : getCategory(r.key).label, formatRate(r.ready), formatRate(r.model), rateCell(r.tally), signed(r.gap)]),
      ),
      '',
      table(['Model çelişkisi', 'Başarı'], stats.goalModel.byConflict.map((b) => [b.key === 'conflict' ? 'Çelişkili' : 'Çelişkisiz', rateCell(b.tally)])),
      '',
      `2.5 / 3.5 / 4.5 Üst ve KG Var önerilerinden model yüzdesi dondurulmuş olanlar. Model çelişkisi: hazır yüzde ile model arasında ${MODEL_CONFLICT_LIMIT} puandan fazla fark. Ortalamalar sonuçlanmış öneriler üzerindendir.${
        stats.goalModel.withoutModel > 0 ? ` ${stats.goalModel.withoutModel} önerinin model yüzdesi kayıtlı değil; tabloya girmez.` : ''
      }`,
      '',
    )
  }

  const market = buildMarketStats(backfillMarket(picks, input.matches, input.marketConflictLimit))
  out.push('## Kalibrasyon: hazır yüzde ve piyasa', '')
  if (!market) out.push('Piyasa yüzdesi olan öneri yok.', '')
  else {
    out.push(
      table(
        ['Kategori', 'Hazır ort.', 'Piyasa ort.', 'Gerçekleşen', 'Çelişkisiz', 'Çelişkili', 'Oran yok'],
        market.rows.map((r) => [r.key === 'all' ? 'Hepsi birlikte' : getCategory(r.key).label, formatRate(r.ready), formatRate(r.market), rateCell(r.tally), rateCell(r.clear), rateCell(r.conflict), r.noOdds]),
      ),
      '',
      `Piyasa yüzdesi: iki yönlü oranın marjdan arındırılmış olasılığı. Çelişkili: hazır yüzde ile piyasa arasında en az ${input.marketConflictLimit} puan fark. ${market.backfilled} önerinin piyasa yüzdesi dondurma anında kayıtlı değildi; maç kaydındaki oranlardan geriye dönük hesaplandı.${
        market.unknown > 0 ? ` ${market.unknown} öneri, maç kaydı silindiği için hesaplanamadı ve tabloya girmez.` : ''
      }`,
      '',
    )
  }

  out.push('## Kalibrasyon: Taraf & Gol', '')
  if (!stats.sideGoals) out.push('Taraf & Gol önerisi yok.', '')
  else {
    out.push(
      table(
        ['Liste', 'Ort. tahmin', 'Gerçekleşen', 'Fark (gerçekleşen − tahmin)'],
        stats.sideGoals.calibration.map((r) => [
          r.key === 'all' ? 'Tüm Taraf & Gol' : getCategory(r.key).label,
          formatRate(r.predicted),
          rateCell(r.tally),
          r.predicted === null || r.tally.rate === null ? '—' : signed(Math.round((r.tally.rate - r.predicted) * 10) / 10),
        ]),
      ),
      '',
      table(['xG çelişkisi', 'Başarı'], stats.sideGoals.byConflict.map((b) => [b.key === 'conflict' ? 'Çelişkili' : 'Çelişkisiz', rateCell(b.tally)])),
      '',
    )
  }

  const ai = buildAiStats(picks, verdicts)
  out.push('## Yapay zekâ kararlarının başarısı', '')
  if (!ai) out.push('Kayıtlı yapay zekâ kararı yok.', '')
  else {
    out.push(
      table(['Kaynak', 'Kararı kayıtlı maç', 'Onayladığı (Güçlü / Orta) maçlarda başarı'], AI_SOURCES.map((s) => [SOURCE_LABELS[s], ai.matches[s], rateCell(ai.approved[s])])),
      '',
      table(['Karar', ...AI_SOURCES.map((s) => SOURCE_LABELS[s])], ai.byDecision.map((row) => [decisionLabel(row.decision), ...AI_SOURCES.map((s) => rateCell(row.tallies[s]))])),
      '',
      'Karar maç bazındadır; başarı o maçın dondurulmuş önerilerinin sonucuyla ölçülür. Ortak karar: iki yapay zekânın aynı kararı verdiği maçlar.',
      '',
    )
  }

  const sharedPicks = sharedPicksOnly(picks, shared)
  const sharedStats = buildStats(sharedPicks)
  out.push('## Paylaşılan ve tüm öneriler', '')
  out.push(
    table(
      ['Kategori', 'Tüm öneriler', 'Paylaşılanlar'],
      [
        ...stats.byCategory.map((b) => [getCategory(b.key).label, rateCell(b.tally), rateCell(sharedStats.byCategory.find((s) => s.key === b.key)?.tally ?? tally([]))]),
        ['Genel', rateCell(overall), rateCell(sharedStats.overall)],
      ],
    ),
    '',
    'Paylaşılan: indirilen bir kategori Story görselinde yer alan öneri.',
    '',
  )

  const scores = buildScoreStats({ matches: input.matches.filter((m) => inScope(m.date, bounds)), results: input.results ?? [], verdicts })
  out.push('## Skor tahminleri (deney)', '')
  out.push(
    table(
      ['Kaynak', 'Tam skor', 'Sonuç (1/X/2)', 'Toplam gol ort. hata', 'n', 'Az veri'],
      scores.rows.map((r) => [r.label, formatRate(r.exact), formatRate(r.outcome), r.totalGoalsError === null ? '—' : formatNumber(r.totalGoalsError), r.n, r.n > 0 && r.lowSample ? 'az veri' : '']),
    ),
    '',
    `Kapsamda skoru girilmiş ${scores.scored} maç. Yalnızca skoru girilmiş ve o kaynağın tahmini olan maçlar sayılır. Model: maç ilk "tamamlandı" kaydedilirken alınan en olası skor. Referanslar (her maçta aynı skor) skoru girilmiş tüm maçlarda ölçülür.${
      scores.late > 0 ? ` ${scores.late} yapay zekâ tahmini maç başladıktan sonra kaydedildiği için sayılmadı.` : ''
    }`,
    '',
  )

  const cornerIds = categoriesInGroup('corners').map((c) => c.id)
  const cardIds = categoriesInGroup('cards').map((c) => c.id)
  const voidIn = (ids: CategoryId[]) => picks.filter((p) => p.outcome === 'void' && ids.includes(p.categoryId)).length
  const matchIds = unique(picks.map((p) => p.matchId))
  const records = input.matches.filter((m) => matchIds.includes(m.id))
  const lacks = (test: (m: Match) => boolean) => records.filter(test).length
  const positive = (m: Match, field: Parameters<typeof stat>[1]) => (stat(m, field) ?? 0) > 0
  out.push('## Veri kısıtları', '')
  out.push(
    `- Korner sayısı girilmediği için değerlendirilemeyen korner önerisi: ${voidIn(cornerIds)}`,
    `- Kart sayısı girilmediği için değerlendirilemeyen kart önerisi: ${voidIn(cardIds)}`,
    `- Diğer kategorilerde değerlendirilemeyen öneri: ${overall.void - voidIn(cornerIds) - voidIn(cardIds)}`,
    `- Sonuçlanmış önerisi ${LOW_SAMPLE_LIMIT}'den az olan kategori: ${stats.byCategory.filter((b) => b.tally.lowSample).length} / ${stats.byCategory.length}`,
    `- Maç kaydı duran maç: ${records.length} / ${matchIds.length}`,
    `- Bunlardan 1X2 oranı eksik: ${lacks((m) => !(positive(m, 'oddsHome') && positive(m, 'oddsDraw') && positive(m, 'oddsAway')))}`,
    `- 2.5 Alt/Üst oranı eksik: ${lacks((m) => !(positive(m, 'oddsOver25') && positive(m, 'oddsUnder25')))}`,
    `- Maç öncesi xG eksik: ${lacks((m) => !(positive(m, 'homeXg') && positive(m, 'awayXg')))}`,
    `- Güvenilirlik "Düşük" olan sonuçlanmış öneri: ${stats.byReliability.find((b) => b.key === 'low')?.tally.decided ?? 0} / ${overall.decided}`,
  )
  return out.join('\n')
}

export const DETAIL_CSV_COLUMNS = [
  'tarih',
  'kategori',
  'ev_sahibi',
  'deplasman',
  'lig',
  'hazir_yuzde',
  'model_yuzde',
  'piyasa_yuzde',
  'yildiz',
  'guvenilirlik',
  ...AI_PROVIDERS.map((p) => `ai_${p.id}`),
  'paylasildi',
  'sonuc',
  'mac_skoru',
  'model_skor',
  ...AI_PROVIDERS.map((p) => `ai_${p.id}_skor`),
] as const

const OUTCOME_TEXT = { won: 'tuttu', lost: 'tutmadı', void: 'değerlendirilemedi' } as const

/**
 * Ayrıntılı maç tablosu: skoru girilmiş her dondurulmuş öneri için bir satır
 * (tuttu / tutmadı / değerlendirilemedi; bekleyenler girmez). Kayıtta olmayan
 * alan boş bırakılır.
 */
const scoreText = (score: ScoreLine | null | undefined): string => (score ? `${score.home}-${score.away}` : '')

export function buildDetailRows(
  input: Pick_<SummaryInput, 'picks' | 'matches' | 'results' | 'verdicts' | 'shared' | 'scope' | 'today' | 'marketConflictLimit'>,
): string[][] {
  const { picks, verdicts, shared } = scopeData(input)
  const matchById = new Map(input.matches.map((m) => [m.id, m]))
  const resultById = new Map((input.results ?? []).map((r) => [r.matchId, r]))
  const filled = backfillMarket(picks, input.matches, input.marketConflictLimit).picks
  const order = (id: CategoryId) => CATEGORIES.findIndex((c) => c.id === id)
  return filled
    .filter((p): p is Pick & { outcome: keyof typeof OUTCOME_TEXT } => p.outcome !== 'pending')
    .sort((a, b) => a.date.localeCompare(b.date) || order(a.categoryId) - order(b.categoryId) || b.percent - a.percent || a.matchId.localeCompare(b.matchId))
    .map((p) => {
      const match = matchById.get(p.matchId)
      const stars = frozenStars(p)
      const verdictOf = (provider: string) => verdicts.find((v) => v.matchId === p.matchId && v.provider === provider)
      const verdict = (provider: string) => {
        const found = verdictOf(provider)
        return found ? decisionLabel(found.decision) : ''
      }
      // Maç başladıktan sonra kaydedilen skor tahmini ölçüme girmediği için burada da boş kalır.
      const aiScore = (provider: string) => {
        const found = verdictOf(provider)
        return found && !found.scoreLate ? scoreText(found.score) : ''
      }
      return [
        p.date,
        getCategory(p.categoryId).label,
        match?.home ?? '',
        match?.away ?? '',
        match?.league ?? '',
        String(p.percent),
        p.secondPercent != null ? String(p.secondPercent) : '',
        typeof p.marketPercent === 'number' ? String(p.marketPercent) : '',
        stars === null ? '' : String(stars),
        p.reliability ? RELIABILITY_LABELS[p.reliability] : '',
        ...AI_PROVIDERS.map((provider) => verdict(provider.id)),
        findActiveShared(shared, p.date, p.categoryId, p.matchId) ? 'evet' : 'hayır',
        OUTCOME_TEXT[p.outcome],
        scoreText(actualScore(resultById.get(p.matchId))),
        scoreText(match?.scoreSnapshot?.best),
        ...AI_PROVIDERS.map((provider) => aiScore(provider.id)),
      ]
    })
}

/** Ayrıntılı maç tablosunun CSV metni (başlık satırıyla). */
export const buildDetailCsv = (input: Parameters<typeof buildDetailRows>[0]): string =>
  Papa.unparse({ fields: [...DETAIL_CSV_COLUMNS], data: buildDetailRows(input) })

export const summaryFileName = (today: string): string => `gollazim-istatistik-ozeti-${today}.txt`
export const detailFileName = (today: string): string => `gollazim-oneriler-${today}.csv`

/** AI kararlarının etiketleri (CSV'yi okuyanlar için) */
export const AI_DECISION_LABELS = AI_DECISIONS.map((d) => d.label)
