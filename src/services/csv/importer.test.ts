import { describe, expect, it } from 'vitest'
import { estimateSampleSize } from '../analysis/reliability'
import { FOOTYSTATS_SAMPLE } from './__fixtures__/footystats'
import { parseMatchDate } from './dateParser'
import { importCsv } from './importer'
import { CsvError } from './parser'
import { parseNumber } from './values'

describe('parseNumber', () => {
  it('ondalık virgülü okur, N/A ve -1 değerlerini veri yok sayar', () => {
    expect(parseNumber('2,33')).toBe(2.33)
    expect(parseNumber('84')).toBe(84)
    expect(parseNumber('0')).toBe(0)
    expect(parseNumber('N/A')).toBeNull()
    expect(parseNumber('-1')).toBeNull()
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('abc')).toBeNull()
  })
})

describe('parseMatchDate', () => {
  it('unix zaman damgasını Türkiye saatine çevirir', () => {
    expect(parseMatchDate({ dateUnix: '1791190800' })).toEqual({ date: '2026-10-05', time: '12:00' })
  })
  it('gece yarısını geçen maçı ertesi güne yazar', () => {
    expect(parseMatchDate({ dateText: 'Oct 05 2026 - 9:30pm' })).toEqual({ date: '2026-10-06', time: '00:30' })
  })
  it('düz tarih biçimlerini okur', () => {
    expect(parseMatchDate({ dateText: '05.10.2026', time: '21:45' })).toEqual({ date: '2026-10-05', time: '21:45' })
    expect(parseMatchDate({ dateText: '2026-10-05' })).toEqual({ date: '2026-10-05', time: undefined })
    expect(parseMatchDate({ dateText: 'bozuk' })).toBeNull()
  })
})

describe('importCsv (FootyStats biçimi)', () => {
  const result = importCsv(FOOTYSTATS_SAMPLE, 'u1')
  const [first, second, third] = result.matches

  it('tüm maçları okur', () => {
    expect(result.matches).toHaveLength(3)
    expect(result.warnings).toEqual([])
    // test verisinde saat kolonu ve 2.5 Üst dışındaki oran kolonları yok
    expect(result.missingFields).toEqual(['time', 'oddsHome', 'oddsDraw', 'oddsAway', 'oddsUnder25'])
  })

  it('ilk maçın alanlarını doğru çıkarır', () => {
    expect(first).toMatchObject({ home: 'Kuzey Yıldızı', away: 'Güney Spor', date: '2026-10-05', time: '12:00' })
    expect(first.league).toBe('Testland · Deneme Ligi')
    expect(first.id).toBe('2026-10-05|kuzeyyildizi|guneyspor')
    expect(first.stats.over25Pct).toBe(50)
    expect(first.stats.homeXg).toBe(1.35)
    expect(first.stats.avgCorners).toBe(8.67)
  })

  it('tanınmayan kolonları saklar; N/A ve -1 veri yok sayılır', () => {
    expect(first.stats['Match Status']).toBe('incomplete')
    expect(first.stats['Home Team Corners']).toBeNull()
    expect(first.stats.oddsOver25).toBe(1.89)
    expect(second.stats.oddsOver25).toBeNull()
  })

  it('Türkiye saatiyle gece yarısını geçen maçı ertesi güne yazar', () => {
    expect(third).toMatchObject({ home: 'İç Anadolu FK', date: '2026-10-05', time: '00:30' })
  })

  it('örneklem büyüklüğünü yüzdelerden tahmin eder', () => {
    expect(estimateSampleSize(first)).toBe(6)
    expect(estimateSampleSize(second)).toBe(18)
  })
})

describe('importCsv hataları', () => {
  it('zorunlu kolon yoksa anlaşılır hata verir', () => {
    expect(() => importCsv('League,Over25 Average\nA,50', 'u1')).toThrow(CsvError)
    expect(() => importCsv('Home Team,Away Team\nA,B', 'u1')).toThrow(/tarih/)
  })

  it('bozuk satırı atlar, diğerlerini okur; noktalı virgül ayırıcıyı tanır', () => {
    const csv = 'Tarih;Ev Sahibi;Deplasman;Over25 Average\n05.10.2026;A;B;80\nbozuk;C;D;70\n05.10.2026;;F;60'
    const result = importCsv(csv, 'u1')
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].stats.over25Pct).toBe(80)
    expect(result.warnings).toHaveLength(2)
  })
})
