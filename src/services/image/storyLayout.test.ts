import { describe, expect, it } from 'vitest'
import { MAX_MATCHES_PER_CATEGORY } from '../../config/categories'
import { ellipsize, fitTeams, layoutRows, LIST_AREA, pickFontSize } from './storyLayout'

// Her karakter 10 birim genişliğinde sayılır
const measure = (text: string) => [...text].length * 10

describe('layoutRows', () => {
  it('1 ile 15 arasındaki her maç sayısında liste alanın içinde kalır', () => {
    for (let n = 1; n <= MAX_MATCHES_PER_CATEGORY; n++) {
      const { rowHeight, gap, top } = layoutRows(n)
      const bottom = top + rowHeight * n + gap * (n - 1)
      expect(top).toBeGreaterThanOrEqual(LIST_AREA.top)
      expect(bottom).toBeLessThanOrEqual(LIST_AREA.bottom)
      expect(rowHeight).toBeGreaterThanOrEqual(56)
    }
  })

  it('az maçta kart büyür ve liste her zaman başlığın altından başlar', () => {
    expect(layoutRows(1)).toMatchObject({ roomy: true, rowHeight: 220, top: LIST_AREA.top })
    expect(layoutRows(2).rowHeight).toBe(200)
    expect(layoutRows(3).rowHeight).toBe(180)
    expect(layoutRows(4)).toMatchObject({ rowHeight: 150, top: LIST_AREA.top })
  })

  it('az maçta geniş, çok maçta sıkışık düzen kullanır', () => {
    expect(layoutRows(7)).toMatchObject({ roomy: true, rowHeight: 138 })
    expect(layoutRows(15).roomy).toBe(false)
  })
})

describe('ellipsize', () => {
  it('sığan metne dokunmaz, sığmayanı kırpar', () => {
    expect(ellipsize('Galatasaray', 200, measure)).toBe('Galatasaray')
    const cut = ellipsize('İstanbul Başakşehir Futbol Kulübü', 120, measure)
    expect(cut).toBe('İstanbul Ba…')
    expect(measure(cut)).toBeLessThanOrEqual(120)
  })

  it('Türkçe karakterleri bozmaz', () => {
    expect(ellipsize('Çaykur Rizespor Şğüöıİ', 1000, measure)).toBe('Çaykur Rizespor Şğüöıİ')
    expect(ellipsize('Şanlıurfaspor', 60, measure)).toBe('Şanlı…')
  })
})

describe('fitTeams', () => {
  it('sığıyorsa tam yazar', () => {
    expect(fitTeams('Romania', 'Sweden', 400, measure)).toBe('Romania – Sweden')
  })

  it('iki uzun adı eşit paylaştırarak kısaltır, deplasman kaybolmaz', () => {
    const text = fitTeams('Fenerbahçe Spor Kulübü Akademi', 'İstanbul Başakşehir Rezerv', 330, measure)
    expect(text).toBe('Fenerbahçe Spo…' + ' – ' + 'İstanbul Başak…')
    expect(measure(text)).toBeLessThanOrEqual(330)
  })

  it('kısa takımın kullanmadığı yer uzun olana kalır', () => {
    const text = fitTeams('Fenerbahçe Spor Kulübü Akademi', 'Göztepe', 330, measure)
    expect(text).toBe('Fenerbahçe Spor Kulübü…' + ' – ' + 'Göztepe')
    expect(measure(text)).toBeLessThanOrEqual(330)
  })
})

describe('pickFontSize', () => {
  it('sığan en büyük boyutu, hiçbiri sığmazsa en küçüğü seçer', () => {
    expect(pickFontSize([40, 32, 26], (s) => s <= 32)).toBe(32)
    expect(pickFontSize([40, 32, 26], () => false)).toBe(26)
  })
})
