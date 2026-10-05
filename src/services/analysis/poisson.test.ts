import { describe, expect, it } from 'vitest'
import { poissonAtLeast, poissonPmf, probOver25AndBtts } from './poisson'

describe('poisson', () => {
  it('pmf bilinen değerleri verir', () => {
    expect(poissonPmf(0, 2)).toBeCloseTo(0.135335, 5)
    expect(poissonPmf(3, 2)).toBeCloseTo(0.180447, 5)
  })

  it('P(X >= k) bilinen değerleri verir', () => {
    expect(poissonAtLeast(0, 3)).toBe(1)
    expect(poissonAtLeast(4, 5)).toBeCloseTo(0.734974, 5)
    expect(poissonAtLeast(5, 5)).toBeCloseTo(0.559507, 5)
  })

  it('2.5 Üst & KG Var ortak olasılığı skor tablosunun toplamına eşittir', () => {
    const [h, a] = [2.36, 1.39]
    let sum = 0
    for (let i = 1; i < 40; i++) for (let j = 1; j < 40; j++) if (i + j >= 3) sum += poissonPmf(i, h) * poissonPmf(j, a)
    expect(probOver25AndBtts(h, a)).toBeCloseTo(sum, 9)
    expect(probOver25AndBtts(h, a)).toBeCloseTo(0.6029, 3)
  })
})
