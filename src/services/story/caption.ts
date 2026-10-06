import { getCategory, type CategoryId } from '../../config/categories'
import { CATEGORY_DESCRIPTIONS } from '../../config/categoryDescriptions'
import { leagueShortName } from '../../config/leagueAbbreviations'
import type { StoryTexts } from '../../config/storyTexts'
import { resultSummaryText } from '../image/resultStory'
import { STORY_NOTE, STORY_TIMEZONE_NOTE } from '../image/storyGenerator'
import { DAILY_TEXT } from '../image/dailyStory'
import { RESULT_LABELS, type CategoryResult, type ResultStatus } from '../stats/categoryResult'

// Paylaşım için hazır açıklama metinleri. İstatistik / öneri dili kullanılır;
// şablonda bahis dili ve hashtag yoktur (hashtagler yalnızca Admin ayarından gelir).
// Metin üretmek hiçbir kayıt oluşturmaz.

export type CaptionTarget = 'instagram' | 'telegram'

export interface CaptionMatch {
  time?: string
  home: string
  away: string
  league?: string
  percent: number
}

const blocks = (parts: (string | null | undefined | false)[]): string => parts.filter((p): p is string => Boolean(p && p.trim())).join('\n\n')

/**
 * Metnin sonu: uyarı, diğer platformun adresi ve (yalnızca Instagram'da) hashtagler.
 * Instagram açıklamasında Telegram bağlantısı, Telegram mesajında Instagram hesabı yazar.
 */
function closing(texts: StoryTexts, target: CaptionTarget): string[] {
  const telegram = texts.telegram.trim()
  const instagram = texts.instagram.trim()
  const link = target === 'instagram' ? telegram && `Telegram: ${telegram}` : instagram && `Instagram: ${instagram}`
  return [texts.disclaimer.trim() || STORY_NOTE, link, target === 'instagram' ? texts.hashtags.trim() : '']
}

/** "15:00 – Bristol City U21 – Charlton Athletic U21 – PDL – %100" */
export const captionMatchLine = (match: CaptionMatch): string =>
  [match.time, `${match.home} – ${match.away}`, leagueShortName(match.league), `%${match.percent}`].filter(Boolean).join(' – ')

/** Seçili maçlardan öneri görseli için açıklama metni. */
export function buildCaption(input: {
  target: CaptionTarget
  categoryId: CategoryId
  dateLabel: string
  matches: CaptionMatch[]
  texts: StoryTexts
}): string {
  const { target, categoryId, dateLabel, matches, texts } = input
  return blocks([
    [`GÜNÜN ${getCategory(categoryId).label} ÖNERİLERİ`, `${dateLabel} · ${STORY_TIMEZONE_NOTE}`, CATEGORY_DESCRIPTIONS[categoryId]].join('\n'),
    matches.map(captionMatchLine).join('\n'),
    ...closing(texts, target),
  ])
}

const MARKS: Record<ResultStatus, string> = { won: '✓', lost: '✗', void: '—', pending: '…' }

/** "✓ Bristol City U21 – Charlton Athletic U21 2-1 (İY 1-0)" / "— A – B · Değerlendirilemedi" */
export const captionResultLine = (row: CategoryResult['rows'][number]): string => {
  const teams = row.away ? `${row.home} – ${row.away}` : row.home
  if (row.status === 'void' || row.status === 'pending') return `${MARKS[row.status]} ${teams} · ${RESULT_LABELS[row.status]}`
  return `${MARKS[row.status]} ${teams}${row.score ? ` ${row.score}` : ''}${row.detail ? ` (${row.detail})` : ''}`
}

/** Kategori sonuç görseli için sonuç metni: özet ve maç / skor / ✓✗ listesi. */
export function buildResultCaption(input: { target: CaptionTarget; result: CategoryResult; dateLabel: string; texts: StoryTexts }): string {
  const { target, result, dateLabel, texts } = input
  const summary = result.tally.decided > 0 ? `İsabet: ${resultSummaryText(result.tally)}` : 'Sonuçlanmış öneri yok'
  return blocks([
    [`${getCategory(result.categoryId).label} SONUÇLARI`, dateLabel, CATEGORY_DESCRIPTIONS[result.categoryId], DAILY_TEXT.subtitle[result.scope]].join('\n'),
    summary,
    result.rows.map(captionResultLine).join('\n'),
    ...closing(texts, target),
  ])
}
