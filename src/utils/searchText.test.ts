import { describe, expect, it } from 'vitest'
import { foldText, matchesSearch } from './searchText'

describe('arama metni', () => {
  it('Türkçe harfler ve büyük/küçük harf fark etmez', () => {
    expect(foldText('Başakşehir')).toBe('basaksehir')
    expect(foldText('İSTANBUL  Çağlayan')).toBe('istanbul caglayan')
    expect(foldText('IĞDIR ığdır')).toBe('igdir igdir')
    expect(foldText('Göztepe Ümraniye')).toBe('goztepe umraniye')
  })

  it('aksansız ya da büyük harfle yazınca Türkçe ad bulunur', () => {
    for (const query of ['basaksehir', 'BASAKSEHIR', 'başakşehir', 'BAŞAKŞEHİR', 'sehir', '  Basak ']) {
      expect(matchesSearch('İstanbul Başakşehir', query), query).toBe(true)
    }
    expect(matchesSearch('Turkey Süper Lig', 'super lig')).toBe(true)
    expect(matchesSearch('Turkey Süper Lig', 'SUPER TURKEY')).toBe(true)
    expect(matchesSearch('İstanbul Başakşehir', 'kasimpasa')).toBe(false)
  })

  it('boş arama her şeyi getirir', () => {
    expect(matchesSearch('England Premier League', '')).toBe(true)
    expect(matchesSearch('England Premier League', '   ')).toBe(true)
  })
})
