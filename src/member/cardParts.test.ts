import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MEMBER_MARKET_LABEL } from '../services/member/labels'
import type { MemberOther } from '../services/member/payload'
import MemberOthers from './MemberOthers'
import MemberSpread from './MemberSpread'
import MemberStars from './MemberStars'
import { othersTitle, spreadPoints, spreadText, STARS_NOTE, starsButtonLabel } from './view'

const textOf = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const spread = (points: ReturnType<typeof spreadPoints>) => renderToStaticMarkup(createElement(MemberSpread, { points }))

describe('yüzde çubuğu: yalnızca kartta olan değerler', () => {
  it('3 değer: Model, Piyasa, Geçmiş (geçmiş sıklık listesi)', () => {
    const points = spreadPoints({ percent: 75, model: 67, mkt: 69 }, 'over25', MEMBER_MARKET_LABEL)
    expect(points).toEqual([
      { kind: 'model', label: 'Model', value: 67 },
      { kind: 'market', label: 'Piyasa', value: 69 },
      { kind: 'history', label: 'Geçmiş', value: 75 },
    ])
    const markup = spread(points)
    expect(markup.match(/data-testid="member-spread-dot"/g)).toHaveLength(3)
    expect(textOf(markup)).toBe('Model %67 Piyasa %69 Geçmiş %75 Üç yüzde arası fark: 8 puan')
  })

  it('2 değer: piyasa yoksa nokta ve etiket çizilmez, metin "İki yüzde"', () => {
    const points = spreadPoints({ percent: 82, model: 70, mkt: undefined }, 'btts', MEMBER_MARKET_LABEL)
    expect(points.map((p) => p.kind)).toEqual(['model', 'history'])
    const markup = spread(points)
    expect(markup.match(/data-testid="member-spread-dot"/g)).toHaveLength(2)
    expect(markup).not.toContain('data-kind="market"')
    expect(textOf(markup)).toBe('Model %70 Geçmiş %82 İki yüzde arası fark: 12 puan')
  })

  it('1 değer: çubuk ve fark satırı hiç çizilmez', () => {
    const points = spreadPoints({ percent: 88, model: null, mkt: undefined }, 'ht05', MEMBER_MARKET_LABEL)
    expect(points.map((p) => p.kind)).toEqual(['history'])
    expect(spread(points)).toBe('')
    expect(spreadText(points)).toBeNull()
    expect(spread(spreadPoints({ percent: 58, model: 61, mkt: undefined }, 'homeWin15', MEMBER_MARKET_LABEL))).toBe('')
  })

  it('hesaplanan tahmin listelerinde büyük yüzde "Geçmiş" diye çizilmez; Taraf & Gol ikinci hesabın kendi adıyla', () => {
    expect(spreadPoints({ percent: 72, model: null, mkt: undefined }, 'cards35', MEMBER_MARKET_LABEL)).toEqual([])
    expect(spread([])).toBe('')
    expect(spreadPoints({ percent: 58, model: 61, mkt: undefined }, 'homeWin15', MEMBER_MARKET_LABEL)).toEqual([{ kind: 'model', label: 'İkinci hesap', value: 61 }])
  })

  it('fark gösterilen yuvarlanmış değerlerin en büyüğü ile en küçüğü arasıdır; eşitse 0 puan', () => {
    expect(spreadText([{ kind: 'model', label: 'Model', value: 40 }, { kind: 'market', label: 'Piyasa', value: 66 }, { kind: 'history', label: 'Geçmiş', value: 100 }])).toBe('Üç yüzde arası fark: 60 puan')
    expect(spreadText([{ kind: 'market', label: 'Piyasa', value: 70 }, { kind: 'history', label: 'Geçmiş', value: 70 }])).toBe('İki yüzde arası fark: 0 puan')
  })

  it('çakışan noktalar dikeyde ayrılır', () => {
    const markup = spread(spreadPoints({ percent: 70, model: 69, mkt: 70 }, 'over25', MEMBER_MARKET_LABEL))
    const shifts = [...markup.matchAll(/calc\(-50% \+ (-?\d+)px\)/g)].map((m) => Number(m[1]))
    expect(new Set(shifts).size).toBeGreaterThan(1)
  })
})

describe('diğer analizler: katlanabilir bölüm', () => {
  const others: MemberOther[] = [
    { categoryId: 'ht05', percent: 91, reliability: 'high' },
    { categoryId: 'cards35', percent: 79, reliability: 'unmeasured' },
  ] as MemberOther[]

  it('N = 0 ise bölüm hiç çizilmez', () => {
    expect(renderToStaticMarkup(createElement(MemberOthers, { others: [] }))).toBe('')
  })

  it('N > 0: başlık "Diğer analizler (N)", varsayılan kapalı, düğme ve bağlı içerik; metinler aynen', () => {
    const markup = renderToStaticMarkup(createElement(MemberOthers, { others }))
    const button = /<button[^>]*data-testid="member-others-toggle"[^>]*>([\s\S]*?)<\/button>/.exec(markup)!
    expect(textOf(button[1])).toBe(`${othersTitle(2)} ▾`)
    expect(button[0]).toContain('aria-expanded="false"')
    const controls = /aria-controls="([^"]+)"/.exec(button[0])![1]
    expect(markup).toContain(`id="${controls}"`)
    expect(markup).toMatch(/class="[^"]*invisible[^"]*grid-rows-\[0fr\][^"]*motion-reduce:transition-none|class="[^"]*motion-reduce:transition-none[^"]*invisible/)
    expect(textOf(/data-testid="member-others">([\s\S]*?)<\/p>/.exec(markup)![1])).toBe('Aynı maçın diğer önerileri: İLK YARI 0.5 ÜST %91 · KART 3.5 ÜST %79 (hesaplanan)')
  })
})

describe('yıldız açıklaması', () => {
  it('yıldızlar düğmedir; erişilebilir adı var, balon kapalı gelir', () => {
    const markup = renderToStaticMarkup(createElement(MemberStars, { count: 3 }))
    expect(markup).toMatch(/<button[^>]*aria-label="3 \/ 5 yıldız, açıklama"[^>]*aria-expanded="false"/)
    expect(markup).toContain('role="img" aria-label="3 / 5 yıldız"')
    expect(markup).not.toContain('member-stars-note')
    expect(starsButtonLabel(5)).toBe('5 / 5 yıldız, açıklama')
  })

  it('açıklama kesinlik izlenimi vermez', () => {
    expect(STARS_NOTE).not.toMatch(/kesin|garanti|güvenli|değer|avantaj|oran|kaynak/i)
    expect(STARS_NOTE).toContain('sonucu öngörmez')
  })
})
