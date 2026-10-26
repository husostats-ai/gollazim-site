import { describe, expect, it } from 'vitest'
import { GOLDEN_VARIANTS, payloadSha256, tableFlags } from './__fixtures__/payloadGoldenVariants'

// matchForms'un tablo satırı / engel hesabı verifiedTableRows'a ayrıldı. Özetler ayrımdan ÖNCEKİ kodla
// (56503ef) alınmıştır ve yeniden üretilmez: bu sabit girdilerle üye paketinin tamamı birebir aynı kalmalıdır.
const BEFORE_SPLIT: Record<string, string> = {
  dogrulanmis: 'f4c5a2e473bddbc8f955758dca247db407019ca35949c187334ba48669e48ca6',
  ppgFarkli: '08b8738976b532cbe3cf9b8501900b13735bb4d6bc6e218002eed0158c71a682',
  ppgYok: 'bd48e031c838d7a75b45e4083f182ecc54bde9dc5b1a9a4e51a96f149ff2898f',
  eskiGoruntu: 'bd48e031c838d7a75b45e4083f182ecc54bde9dc5b1a9a4e51a96f149ff2898f',
  golSutunuYok: 'bd48e031c838d7a75b45e4083f182ecc54bde9dc5b1a9a4e51a96f149ff2898f',
  formVeCsYok: '5d66399b3f1893eddb390bd26d6cc6ffdee2a65d940b60e1491d0d27f162c93f',
  tablodaYok: '77b61fe739c61593c54aa680a6ea10a607a46adb2789ccd09d18f1656e2f1458',
  gecmisYok: 'bd48e031c838d7a75b45e4083f182ecc54bde9dc5b1a9a4e51a96f149ff2898f',
}

describe('üye paketi: lig tablosu satırları ayrımdan önceki çıktıyla aynı', () => {
  it('her sabit girdinin özeti var', () => {
    expect(Object.keys(GOLDEN_VARIANTS).sort()).toEqual(Object.keys(BEFORE_SPLIT).sort())
  })

  it.each(Object.keys(BEFORE_SPLIT))('%s', (key) => {
    expect(payloadSha256(GOLDEN_VARIANTS[key]())).toBe(BEFORE_SPLIT[key])
  })

  // Özet bir şey değişti der ama neyin değiştiğini söylemez; hangi satırların girdiği de açıkça beklenir.
  // [ev sıra, deplasman sıra, ev form, deplasman form]
  it('girdi başına hangi sıra ve form satırları pakete giriyor', () => {
    const standingsOnly = { 'Kuzey Yıldızı': [true, true, false, false], 'Doğu Gençlik': [true, false, false, false] }
    expect(tableFlags(GOLDEN_VARIANTS.dogrulanmis())).toEqual({ 'Kuzey Yıldızı': [true, true, true, true], 'Doğu Gençlik': [true, false, false, false] })
    expect(tableFlags(GOLDEN_VARIANTS.ppgFarkli())).toEqual({ 'Kuzey Yıldızı': [true, true, true, false], 'Doğu Gençlik': [true, false, true, false] })
    for (const key of ['ppgYok', 'eskiGoruntu', 'golSutunuYok', 'gecmisYok']) expect(tableFlags(GOLDEN_VARIANTS[key]()), key).toEqual(standingsOnly)
    expect(tableFlags(GOLDEN_VARIANTS.formVeCsYok())).toEqual({ 'Kuzey Yıldızı': [true, true, true, true], 'Doğu Gençlik': [true, false, false, false] })
    expect(tableFlags(GOLDEN_VARIANTS.tablodaYok())).toEqual({ 'Kuzey Yıldızı': [false, true, false, true], 'Doğu Gençlik': [true, false, false, false] })
  })
})
