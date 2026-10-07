import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { CATEGORIES, getCategory, type CategoryId } from '../../config/categories'
import { normalizeStoryTexts } from '../../config/storyTexts'
import type { BackupFile, Match } from '../../types'
import { toAppDateTime } from '../../utils/date'
import { formatLongDate } from '../../utils/format'
import { buildAiStats } from '../ai/aiStats'
import { analyzeDay } from '../analysis/engine'
import { assessReliability } from '../analysis/reliability'
import { scoreForecast } from '../analysis/scoreForecast'
import { isBackupFile } from '../data/backupFormat'
import { storyFromAnalysis } from '../image/storyGenerator'
import { matchStandings } from '../league/standing'
import { buildDailySummary } from '../stats/dailySummary'
import { backfillMarket, buildMarketStats } from '../stats/marketStats'
import { buildScoreStats } from '../stats/scoreStats'
import { buildStarStats } from '../stats/starStats'
import { buildStats } from '../stats/statsEngine'
import { ABSENT, canonical, pickRecord } from './canonical'
import { buildDetailCsv, buildStatsSummary } from '../stats/statsSummary'
import { sharedPicksOnly } from '../story/shared'

// Geliştirme aracı, normal test çalıştırmasında atlanır.
// REF_BACKUP=samples/gollazim-yedek-….json npm run referans : JSON yedekten analiz,
// dondurulmuş öneri, istatistik ve özet çıktılarının deterministik dökümünü REF_OUT
// (varsayılan samples/ref) altına yazar. Bir değişikliğin analizi etkilemediğini
// göstermek için değişiklikten önce ve sonra çalıştırılıp ozetler.sha256 karşılaştırılır.
// Çıktılar veri içerir ve repoya girmez (samples/ .gitignore'dadır).

/** Kategori başına 4 / 8 / 15 maçlık story görseli referansı: toplam 12 PNG */
export const STORY_REF = {
  date: '2026-10-06',
  categories: ['over25', 'ht05', 'btts', 'sh05'] as const satisfies readonly CategoryId[],
  counts: [4, 8, 15] as const,
}

export const storyRefFileName = (categoryId: CategoryId, count: number): string => `kategori-${getCategory(categoryId).slug}-${count}-mac.png`

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

it.runIf(process.env.REF_BACKUP)('referans dökümü', () => {
  const raw = readFileSync(process.env.REF_BACKUP!, 'utf8')
  const backup: unknown = JSON.parse(raw)
  if (!isBackupFile(backup)) throw new Error('REF_BACKUP bir GOLLAZIM yedeği değil.')
  const b: BackupFile = backup
  const outDir = process.env.REF_OUT ?? 'samples/ref'
  mkdirSync(outDir, { recursive: true })

  // Saat yedeğin alındığı ana sabitlenir; çıktı çalıştırma zamanından etkilenmez.
  const now = new Date(b.exportedAt)
  const today = toAppDateTime(now).date
  const limit = b.marketConflictLimit ?? 25
  const verdicts = b.aiVerdicts ?? []
  const shared = b.sharedPicks ?? []
  const tables = b.leagueTables ?? []
  const aliases = b.teamAliases ?? []
  const dates = [...new Set(b.matches.map((m) => m.date))].sort()
  const byDate = (date: string): Match[] => b.matches.filter((m) => m.date === date)

  // 1) Maç başına N ve seviye, lig sırası, skor olasılıkları
  const matches = [...b.matches]
    .sort((x, y) => (x.id < y.id ? -1 : 1))
    .map((m) => ({
      id: m.id,
      reliability: assessReliability(m),
      standings: matchStandings(m, byDate(m.date), tables, aliases, now),
      scoreForecast: scoreForecast(m),
      scoreSnapshot: m.scoreSnapshot ?? ABSENT,
    }))

  // 2) Gün gün analiz: iki sıralamada da listelerin tam içeriği ve sırası
  const analysis = dates.map((date) => ({
    date,
    ...Object.fromEntries(
      (['percent', 'cautious'] as const).map((sortMode) => {
        const day = analyzeDay(byDate(date), b.thresholds, sortMode, limit)
        return [
          sortMode,
          CATEGORIES.map((c) => {
            const { predictions, ...rest } = day[c.id]
            return { ...rest, predictions: predictions.map(({ match, ...p }, i) => ({ rank: i + 1, matchId: match.id, ...p })) }
          }),
        ]
      }),
    ),
  }))

  // 3) Dondurulmuş öneriler: kayıtlı alanlar aynen; kayıtta olmayan alan açıkça işaretlenir
  const picks = [...b.picks].sort((x, y) => (x.id < y.id ? -1 : 1)).map(pickRecord)

  // 4) İstatistik sayfası değerleri
  const sharedOnly = sharedPicksOnly(b.picks, shared)
  const statsPage = {
    all: { stats: buildStats(b.picks), stars: buildStarStats(b.picks) },
    shared: { stats: buildStats(sharedOnly), stars: buildStarStats(sharedOnly) },
    ai: buildAiStats(b.picks, verdicts),
    market: buildMarketStats(backfillMarket(b.picks, b.matches, limit)),
    score: buildScoreStats({ matches: b.matches, results: b.results, verdicts }),
    daily: dates.map((date) => ({ date, summary: buildDailySummary(b.picks, date) })),
  }

  // 5) "Analiz için özet" metni ve ayrıntılı CSV
  const summaryInput = { now, today, picks: b.picks, matches: b.matches, results: b.results, verdicts, shared, thresholds: b.thresholds, marketConflictLimit: limit }
  const summary = (['all', 'last7', 'last30'] as const)
    .map((kind) => `===== kapsam: ${kind} =====\n${buildStatsSummary({ ...summaryInput, scope: { kind }, includeGuide: kind === 'all' })}\n`)
    .join('\n')
  const detailCsv = buildDetailCsv({ ...summaryInput, scope: { kind: 'all' } }) + '\n'

  // 6) Story görseli girdileri (PNG'ler scripts/referans-png.mjs ile tarayıcıda üretilir)
  const storyDay = analyzeDay(byDate(STORY_REF.date), b.thresholds, 'percent', limit)
  const stories = STORY_REF.categories.flatMap((categoryId) =>
    STORY_REF.counts.map((count) => {
      const a = storyDay[categoryId]
      if (a.predictions.length < count) throw new Error(`${categoryId}: ${STORY_REF.date} gününde ${count} öneri yok (${a.predictions.length}).`)
      return { file: storyRefFileName(categoryId, count), data: storyFromAnalysis({ ...a, predictions: a.predictions.slice(0, count) }, formatLongDate(STORY_REF.date)) }
    }),
  )
  expect(stories).toHaveLength(12)

  const files: Record<string, string> = {
    'maclar.json': canonical(matches),
    'analiz.json': canonical(analysis),
    'oneriler.json': canonical(picks),
    'istatistik.json': canonical(statsPage),
    'ozet.txt': summary,
    'ayrinti.csv': detailCsv,
    'story-girdi.json': canonical({ texts: normalizeStoryTexts(b.storyTexts), stories }),
  }
  for (const [name, text] of Object.entries(files)) writeFileSync(join(outDir, name), text)
  const manifest =
    [`${sha256(raw)}  (girdi) ${process.env.REF_BACKUP!.split('/').pop()}`, ...Object.entries(files).map(([name, text]) => `${sha256(text)}  ${name}`)].join('\n') + '\n'
  writeFileSync(join(outDir, 'ozetler.sha256'), manifest)
})
