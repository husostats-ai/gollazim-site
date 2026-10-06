import { describe, expect, it } from 'vitest'
import { drawStory, type StoryData, type StoryRow } from './storyGenerator'

// Test ortamında (node) gerçek tuval yoktur; bu yüzden PNG karşılaştırılamaz.
// Onun yerine tuvale yapılan çağrılar sırasıyla kaydedilir: çizim kodundaki
// istenmeyen bir değişiklik (konum, renk, yazı boyutu, sıra) kaydı değiştirir.
// Tasarım bilerek değiştirildiyse kayıt `npx vitest run -u` ile yenilenir.

type Call = [name: string, ...args: unknown[]]

function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = []
  const state: Record<string, unknown> = { font: '10px sans-serif' }
  const gradient = (kind: string, args: unknown[]) => {
    const id = `${kind}(${args.join(',')})`
    return { addColorStop: (offset: number, color: string) => calls.push(['addColorStop', id, offset, color]), toJSON: () => id }
  }
  // Genişlik, yazı boyutuyla orantılı sabit bir kuraldır: sığdırma dallarını tetiklemeye yeter.
  const measureText = (text: string) => ({ width: [...text].length * parseFloat(/(\d+(?:\.\d+)?)px/.exec(String(state.font))![1]) * 0.56 })
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop === 'measureText') return measureText
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return (...args: unknown[]) => gradient(prop, args)
      if (prop in target) return target[prop]
      return (...args: unknown[]) => void calls.push([prop, ...args])
    },
    set(target, prop: string, value) {
      target[prop] = value
      calls.push(['=', prop, value])
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

const TEAMS = ['Galatasaray', 'Fenerbahçe', 'Peterborough United', 'Bosnia Herzegovina U21', 'İstanbul Başakşehir', 'Ipswich Town U21']
const rows = (count: number): StoryRow[] =>
  Array.from({ length: count }, (_, i) => ({
    home: TEAMS[i % TEAMS.length],
    away: TEAMS[(i + 3) % TEAMS.length],
    time: i % 4 === 3 ? undefined : `${18 + (i % 4)}:${i % 2 ? '45' : '00'}`,
    league: i % 5 === 4 ? undefined : 'Süper Lig',
    percent: 95 - i * 3,
    stars: 5 - (i % 5),
  }))

const record = (data: StoryData, logo: CanvasImageSource | null = null) => {
  const { ctx, calls } = recordingContext()
  drawStory(ctx, data, logo)
  return calls.map((c) => JSON.stringify(c)).join('\n')
}

describe('drawStory çizim kaydı', () => {
  // 1 maç: yüksek kart; 4: geniş düzen; 15: sıkışık düzen. Başlıklar tek satır, küçülen ve ikiye bölünen adları kapsar.
  const cases: [string, StoryData][] = [
    ['1 maç, kısa başlık', { categoryLabel: '2.5 ÜST', dateLabel: '6 Ekim 2026 Salı', rows: rows(1) }],
    ['4 maç, uzun başlık', { categoryLabel: 'İLK YARI 0.5 ÜST', dateLabel: '6 Ekim 2026 Salı', rows: rows(4) }],
    ['15 maç, bölünen başlık', { categoryLabel: 'DEPLASMAN KAZANIR & 2.5 ÜST', dateLabel: '6 Ekim 2026 Salı', rows: rows(15) }],
  ]
  it.each(cases)('%s', (_, data) => {
    expect(record(data)).toMatchSnapshot()
  })

  it('logo varsa rozete kırpılarak çizilir', () => {
    const logo = { toJSON: () => 'logo' } as unknown as CanvasImageSource
    expect(record({ categoryLabel: 'KG VAR', dateLabel: '6 Ekim 2026 Salı', rows: [] }, logo)).toMatchSnapshot()
  })
})
