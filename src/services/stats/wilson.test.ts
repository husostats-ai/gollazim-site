import { describe, expect, it } from 'vitest'
import { wilsonInterval } from './wilson'

describe('Wilson %95 aralığı (iki yönlü)', () => {
  it('bilinen değerler', () => {
    expect(wilsonInterval(8, 10)).toEqual({ low: 49, high: 94.3 })
    expect(wilsonInterval(50, 100)).toEqual({ low: 40.4, high: 59.6 })
    expect(wilsonInterval(42, 70)).toEqual({ low: 48.3, high: 70.7 })
  })

  it('uçlarda 0 ve 100 sınırları aşılmaz', () => {
    expect(wilsonInterval(0, 5)).toEqual({ low: 0, high: 43.4 })
    expect(wilsonInterval(15, 15)).toEqual({ low: 79.6, high: 100 })
  })

  it('örneklem büyüdükçe aralık daralır; sonuçlanmış öneri yoksa null', () => {
    const width = (won: number, n: number) => wilsonInterval(won, n)!.high - wilsonInterval(won, n)!.low
    expect(width(60, 100)).toBeLessThan(width(6, 10))
    expect(wilsonInterval(0, 0)).toBeNull()
  })
})
