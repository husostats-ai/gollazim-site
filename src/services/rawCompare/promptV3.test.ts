import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Match } from '../../types'
import { collectAiMatches, type AiMatchItem } from '../ai/collect'
import { buildPrompts, matchBlock } from '../ai/prompt'
import { analyzeDay } from '../analysis/engine'
import { DAY, dayMatches, THRESHOLDS } from '../member/__fixtures__/rawData'
import { buildRawPrompts, PROMPT_V3_DATE_MARK, PROMPT_V3_GROUP_SIZE, PROMPT_V3_HEAD, PROMPT_V3_TAIL, rawPromptLine } from './promptV3'

// "Ham veri" promptu (sürüm 3): sabit metin, maç listesi, gruplama ve numaralama.

const START = '=== MAÇLAR ==='
const END = '=== MAÇLAR SONU ==='
const fake = (n: number): AiMatchItem => ({ match: { id: `m${n}`, uploadId: 'u', date: DAY, time: `${String(10 + Math.floor(n / 6)).padStart(2, '0')}:${String((n % 6) * 10).padStart(2, '0')}`, league: 'Testland · Deneme Ligi', home: `Ev ${n}`, away: `Dep ${n}`, stats: {} } as Match, predictions: [], evaluate: ['over25'] })
const fakes = (count: number) => Array.from({ length: count }, (_, i) => fake(i + 1))
/** "=== MAÇLAR ===" ile "=== MAÇLAR SONU ===" arasındaki satırlar */
const listOf = (text: string): string[] => text.slice(text.indexOf(`${START}\n`) + START.length + 1, text.indexOf(`\n${END}`)).split('\n')

describe('sabit metin', () => {
  it('metnin özeti değişmedi (elle düzenlenmez)', () => {
    expect(createHash('sha256').update(PROMPT_V3_HEAD + PROMPT_V3_TAIL).digest('hex')).toBe('633557341d18dbed3f8517a9204112f569893d6fb12155768294e5e86bfdc1b8')
    expect(PROMPT_V3_HEAD.split(PROMPT_V3_DATE_MARK)).toHaveLength(2)
    expect(PROMPT_V3_HEAD.endsWith(`\n${START}\n`)).toBe(true)
    expect(PROMPT_V3_TAIL).toBe(`${END}\n`)
  })

  // Kaynak dosya repoya girmez; yereldeyse üretilen metin onunla bayt bayt karşılaştırılır.
  const SOURCE = 'samples/ham-veri/prompt-v3.txt'
  it.runIf(existsSync(SOURCE))('dosyadaki örnek maçlar ve "[TARİH]" ile üretilen metin dosyayla birebir aynı', () => {
    const source = readFileSync(SOURCE, 'utf8')
    const items = listOf(source).map((line): AiMatchItem => {
      const [, time, league, teams] = line.split(' | ')
      const [home, away] = teams.split(' - ')
      return { match: { id: line, uploadId: 'u', date: '2026-10-08', time, league, home, away, stats: {} }, predictions: [], evaluate: ['over25'] }
    })
    expect(items).toHaveLength(3)
    expect(buildRawPrompts(items, PROMPT_V3_DATE_MARK)).toEqual([{ index: 1, total: 1, from: 1, to: 3, text: source }])
  })
})

describe('prompt üretimi', () => {
  const items = collectAiMatches(analyzeDay(dayMatches(DAY), THRESHOLDS, 'percent'))
  const [prompt] = buildRawPrompts(items, '5 Ekim 2026')

  it('yalnızca tarih ve maç listesi değişir; metnin geri kalanı birebir', () => {
    expect(items.length).toBeGreaterThan(3)
    expect(items.length).toBeLessThanOrEqual(PROMPT_V3_GROUP_SIZE)
    expect(prompt.text.startsWith(PROMPT_V3_HEAD.replace(PROMPT_V3_DATE_MARK, '5 Ekim 2026'))).toBe(true)
    expect(prompt.text.endsWith(`\n${PROMPT_V3_TAIL}`)).toBe(true)
    expect(prompt.text).toContain('Aşağıdaki maçlar 5 Ekim 2026 (Europe/Istanbul) tarihlidir.')
    expect(prompt.text).not.toContain(PROMPT_V3_DATE_MARK)
    expect(prompt.text.length).toBe(PROMPT_V3_HEAD.length - PROMPT_V3_DATE_MARK.length + '5 Ekim 2026'.length + listOf(prompt.text).join('\n').length + 1 + PROMPT_V3_TAIL.length)
  })

  it('maç seçimi, sırası ve numaraları AI ANALİZİ promptuyla aynı', () => {
    const lines = listOf(prompt.text)
    expect(lines).toHaveLength(items.length)
    // Aynı maç başlığı satırı…
    expect(lines).toEqual(items.map((item, i) => matchBlock(item, i + 1).split('\n')[0]))
    // …ve AI ANALİZİ promptunun kendi metninde aynı numarayla geçiyor.
    const aiText = buildPrompts(items, 'chatgpt', '5 Ekim 2026').map((chunk) => chunk.text).join('\n')
    for (const line of lines) expect(aiText).toContain(`${line}\nÖneriler: `)
    expect(lines[0]).toMatch(/^#1 \| \d{2}:\d{2} \| Testland · Deneme Ligi \| .+ - .+$/)
    expect(prompt).toMatchObject({ index: 1, total: 1, from: 1, to: items.length })
  })

  it('öneri, istatistik ya da model satırı eklenmez', () => {
    for (const line of listOf(prompt.text)) expect(line).toMatch(/^#\d+ \| [^|]+ \| [^|]+ \| [^|]+$/)
    expect(listOf(prompt.text).join('\n')).not.toMatch(/Öneriler|İstatistik|Gol modeli|Piyasa|%/)
  })

  it('saati ya da ligi olmayan maç AI ANALİZİ promptundaki gibi yazılır', () => {
    const bare = { ...fake(1).match, time: undefined, league: undefined }
    expect(rawPromptLine(bare, 4)).toBe('#4 | saat yok | lig yok | Ev 1 - Dep 1')
  })
})

describe('gruplama ve numaralama', () => {
  it("maç yoksa prompt yok; 8'e kadar tek prompt", () => {
    expect(buildRawPrompts([], '8 Ekim 2026')).toEqual([])
    expect(buildRawPrompts(fakes(1), '8 Ekim 2026').map((p) => [p.index, p.total, p.from, p.to])).toEqual([[1, 1, 1, 1]])
    expect(buildRawPrompts(fakes(8), '8 Ekim 2026').map((p) => [p.index, p.total, p.from, p.to])).toEqual([[1, 1, 1, 8]])
  })

  it("8'den fazla maç 8'erli gruplara bölünür; numaralar gruplar arasında devam eder", () => {
    const nine = buildRawPrompts(fakes(9), '8 Ekim 2026')
    expect(nine.map((p) => [p.index, p.total, p.from, p.to])).toEqual([
      [1, 2, 1, 8],
      [2, 2, 9, 9],
    ])
    expect(listOf(nine[1].text)).toEqual(['#9 | 11:30 | Testland · Deneme Ligi | Ev 9 - Dep 9'])

    const many = buildRawPrompts(fakes(19), '8 Ekim 2026')
    expect(many.map((p) => [p.index, p.total, p.from, p.to])).toEqual([
      [1, 3, 1, 8],
      [2, 3, 9, 16],
      [3, 3, 17, 19],
    ])
    // Her maç tam bir kez, sırayla; her prompt tam metni kendi içinde taşır.
    expect(many.flatMap((p) => listOf(p.text)).map((line) => line.split(' | ')[0])).toEqual(Array.from({ length: 19 }, (_, i) => `#${i + 1}`))
    for (const p of many) {
      expect(p.text.startsWith(PROMPT_V3_HEAD.replace(PROMPT_V3_DATE_MARK, '8 Ekim 2026'))).toBe(true)
      expect(p.text.endsWith(PROMPT_V3_TAIL)).toBe(true)
      expect(listOf(p.text)).toHaveLength(p.to - p.from + 1)
    }
  })
})
