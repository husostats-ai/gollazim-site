import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AiVerdict, Match, Pick } from '../../types'
import { buildCategoryAiStats } from '../ai/aiStats'
import { collectAiMatches } from '../ai/collect'
import { buildPrompts } from '../ai/prompt'
import { analyzeDay } from '../analysis/engine'
import { buildRawPrompts } from '../rawCompare/promptV3'
import { buildStarStats } from '../stats/starStats'
import { buildStats } from '../stats/statsEngine'
import { AI_VERDICTS, DAY, dayMatches, memberInput, MARKET_LIMIT, PICKS, THRESHOLDS } from './__fixtures__/rawData'
import { buildMemberPayload } from './payload'

// Yalnızca ölçüm için tutulan admin kayıt alanları (dondurulan öneri). Davranışı etkilemezler:
// üye paketine, istatistiğe, görsellere (Story, öne çıkanlar, sonuç) ve AI prompt'una girmezler.

const COMMIT_CANARY = 'c0ffee1'
const UPLOADED_CANARY = '2026-10-04T05:06:07.000Z'
const PICK_RECORD_KEYS = ['sampleAtFreeze', 'rankAtFreeze', 'appCommit', 'statsUploadedAt'] as const

const withRecord = (picks: Pick[]): Pick[] => picks.map((p, i) => ({ ...p, sampleAtFreeze: 37, rankAtFreeze: 900 + i, appCommit: COMMIT_CANARY, statsUploadedAt: UPLOADED_CANARY }))

/** Kaynak klasördeki (testler hariç) dosyaların metni */
const sources = (dir: string): [string, string][] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes('__fixtures__'))
    .map((f) => [join(dir, f), readFileSync(join(dir, f), 'utf8')])

describe('dondurulan önerinin ölçüm kayıt alanları yalnızca admin verisinde kalır', () => {
  it('üye paketi: alanlar ve değerleri hiç geçmez; paket alanlar olmadan kurulanla birebir aynı', () => {
    const plain = buildMemberPayload(memberInput())
    const recorded = buildMemberPayload(memberInput({ picks: withRecord(PICKS) }))
    expect(recorded).toEqual(plain)
    const text = JSON.stringify(recorded)
    for (const key of PICK_RECORD_KEYS) expect(text, key).not.toContain(key)
    expect(text).not.toContain(COMMIT_CANARY)
    expect(text).not.toContain(UPLOADED_CANARY)
  })

  it('istatistik ve yıldız istatistiği alanlardan etkilenmez', () => {
    expect(buildStats(withRecord(PICKS))).toEqual(buildStats(PICKS))
    expect(buildStarStats(withRecord(PICKS))).toEqual(buildStarStats(PICKS))
  })

  it('görsel, Story, AI, istatistik ve üye kodu alanları okumaz (yalnızca dondurma yazar)', () => {
    for (const dir of ['src/services/image', 'src/services/story', 'src/services/ai', 'src/services/stats', 'src/services/member', 'src/member', 'src/services/highlights', 'src/services/streak']) {
      for (const [file, text] of sources(dir)) for (const key of PICK_RECORD_KEYS) expect(text.includes(key), `${file}: ${key}`).toBe(false)
    }
    const writers = sources('src').filter(([, text]) => /rankAtFreeze|sampleAtFreeze|statsUploadedAt/.test(text)).map(([file]) => file).sort()
    expect(writers).toEqual(['src/services/results/freeze.ts', 'src/services/results/resultService.ts', 'src/types.ts'])
  })
})

// Oran geçmişi (maç) ve prompt türü (AI cevabı): yalnızca admin verisi; analize, istatistiğe, üye paketine,
// görsellere ve AI prompt'una girmez.
const ODDS_CANARY = 7.77
const withOddsHistory = (matches: Match[]): Match[] =>
  matches.map((m) => ({ ...m, oddsHistory: [{ at: '2026-10-03T03:03:03.000Z', odds: { home: ODDS_CANARY, draw: 3.33, away: 4.44, over25: 1.11, under25: 9.99, bttsYes: 1.23, bttsNo: 4.56, ht05Over: 1.01, ht05Under: 8.88 } }] }))
const withPromptKind = (verdicts: AiVerdict[]): AiVerdict[] => verdicts.map((v, i) => ({ ...v, promptKind: i % 2 ? 'csv' : 'bagimsiz' }))
const HISTORY_KEYS = ['oddsHistory', 'promptKind'] as const

describe('oran geçmişi ve prompt türü yalnızca admin verisinde kalır', () => {
  it('üye paketi alanlarla ve alanlarsız birebir aynı; ad ve değerler geçmez', () => {
    const recordedDays = memberInput().days.map((d) => ({ ...d, matches: withOddsHistory(d.matches) }))
    const plain = buildMemberPayload(memberInput())
    const recorded = buildMemberPayload(memberInput({ days: recordedDays }))
    expect(recorded).toEqual(plain)
    const text = JSON.stringify(recorded)
    for (const key of HISTORY_KEYS) expect(text, key).not.toContain(key)
    for (const value of ['7.77', '9.99', '8.88', '2026-10-03T03:03:03']) expect(text, value).not.toContain(value)
  })

  it('analiz ve AI prompt\'u (CSV\'li ve CSV\'siz) oran geçmişinden etkilenmez', () => {
    const plain = dayMatches(DAY)
    const recorded = withOddsHistory(plain)
    // Analiz sonucu maç nesnesini de taşır; onun dışındaki her şey (yüzde, yıldız, sıra, notlar) birebir aynı olmalı.
    const withoutHistory = (value: unknown) => JSON.stringify(value, (key, v) => (key === 'oddsHistory' ? undefined : v))
    expect(withoutHistory(analyzeDay(recorded, THRESHOLDS, 'percent', MARKET_LIMIT))).toBe(withoutHistory(analyzeDay(plain, THRESHOLDS, 'percent', MARKET_LIMIT)))
    const prompt = (ms: Match[]) => buildPrompts(collectAiMatches(analyzeDay(ms, THRESHOLDS, 'percent', MARKET_LIMIT)), 'chatgpt', '5 Ekim 2026 Pazar').map((c) => c.text)
    expect(prompt(recorded)).toEqual(prompt(plain))
    for (const text of prompt(recorded)) expect(text).not.toContain('7.77')
    const raw = (ms: Match[]) => JSON.stringify(buildRawPrompts(collectAiMatches(analyzeDay(ms, THRESHOLDS, 'percent', MARKET_LIMIT)), '5 Ekim 2026 Pazar'))
    expect(raw(recorded)).toBe(raw(plain))
  })

  it('AI istatistikleri prompt türünden etkilenmez (eski kayıtlar "bilinmiyor" sayılır, ayrılmaz)', () => {
    expect(buildCategoryAiStats(PICKS, withPromptKind(AI_VERDICTS))).toEqual(buildCategoryAiStats(PICKS, AI_VERDICTS))
  })

  it('görsel, Story, AI servisleri, istatistik ve üye kodu alanları okumaz; yazanlar yalnızca kayıt noktaları', () => {
    for (const dir of ['src/services/image', 'src/services/story', 'src/services/ai', 'src/services/stats', 'src/services/member', 'src/member', 'src/services/highlights', 'src/services/streak', 'src/services/analysis']) {
      for (const [file, text] of sources(dir)) for (const key of HISTORY_KEYS) expect(text.includes(key), `${file}: ${key}`).toBe(false)
    }
    const writers = (key: string) => sources('src').filter(([, text]) => text.includes(key)).map(([file]) => file).sort()
    expect(writers('oddsHistory')).toEqual(['src/services/csv/oddsHistory.ts', 'src/services/csv/uploadService.ts', 'src/types.ts'])
    expect(writers('promptKind')).toEqual(['src/components/ai/ResponsePanel.tsx', 'src/types.ts'])
  })
})
