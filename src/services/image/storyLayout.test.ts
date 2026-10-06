import { describe, expect, it } from 'vitest'
import { ellipsize, fitTeams, pickFontSize } from './storyLayout'

// Her karakter 10 birim genişliğinde sayılır
const measure = (text: string) => [...text].length * 10

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
