import { describe, expect, it } from 'vitest'
import { formSha256, GOLDEN_VARIANTS, payloadSha256, tableFlags } from './__fixtures__/payloadGoldenVariants'

// Üye paketinin lig tablosu satırları için sabit, tamamen sentetik girdiler. Özetler yeniden üretilmez; bir kural
// bilerek değişince yeni değer, neyin değiştiği aşağıdaki beklentilerle birlikte yazılır.
//
// Geçmiş: 56503ef'de alınan özetler (matchForms → verifiedTableRows ayrımında paket birebir aynı kaldı) sıra satırı
// kuralıyla değişti: sıra satırı artık form satırı gibi maçtan önceki görüntüden ve yalnızca doğrulandıysa yazılır.
const PAYLOAD: Record<string, string> = {
  dogrulanmis: 'b9203fe5250cac82d3d51540a98ebd027e2518741a1763eebea1a39939484efd',
  ppgFarkli: '0615ff3dd7d5b4d7f7d377fb9c554027a18da9240f1dfbb11d3a1aa7c968eb01',
  ppgYok: '2072b22903f1d3904bedef29ee72086a7890c17be2c1f860dbcaf675a8b613bc',
  eskiGoruntu: '2072b22903f1d3904bedef29ee72086a7890c17be2c1f860dbcaf675a8b613bc',
  golSutunuYok: '9ca74feb16ec72a37660bfa7406577c5f93b5bb2673f16e9c3e0cdf0708a8070',
  formVeCsYok: 'e5a245b7b3e1b76652da13c30750e06fcacbff2aca1db54b1231e684bfda7b77',
  tablodaYok: '23b78057ddaa6c9d168ddbcb223d22fc0256fccd818fd5b5f6ac959d46e8f11f',
  gecmisYok: '2072b22903f1d3904bedef29ee72086a7890c17be2c1f860dbcaf675a8b613bc',
}

// Yalnızca form satırlarının özeti; sıra satırı kuralı değişmeden ÖNCEKİ kodla (d15ed57) alınmıştır. Sıra satırı
// kuralı form satırlarına dokunmaz: bu değerler değişmemelidir.
const FORM_BEFORE_STANDING_RULE: Record<string, string> = {
  dogrulanmis: '1eb625d1413209843a4d1607e8dc1b422a4e78e9ad2c651391165d6831388d79',
  ppgFarkli: '47db76132a07044999feb1eec7474aaf92c520caeecccb1f70d1c5405542d746',
  ppgYok: 'a131981972a0eeacfaeb04544da7626c7dc2ef76593830cef408fa217f21b0df',
  eskiGoruntu: 'a131981972a0eeacfaeb04544da7626c7dc2ef76593830cef408fa217f21b0df',
  golSutunuYok: 'a131981972a0eeacfaeb04544da7626c7dc2ef76593830cef408fa217f21b0df',
  formVeCsYok: '84a8d4db4a0651d372d8f0118d1cd95731ec1897e71cb719f27ace09bb7ab974',
  tablodaYok: 'f464ea3da1ba416e1642da49f67d61107e2798dc570c06d3b553fac60ba37faa',
  gecmisYok: 'a131981972a0eeacfaeb04544da7626c7dc2ef76593830cef408fa217f21b0df',
}

describe('üye paketi: lig tablosu satırları (sabit girdiler)', () => {
  it('her sabit girdinin iki özeti de var', () => {
    expect(Object.keys(GOLDEN_VARIANTS).sort()).toEqual(Object.keys(PAYLOAD).sort())
    expect(Object.keys(GOLDEN_VARIANTS).sort()).toEqual(Object.keys(FORM_BEFORE_STANDING_RULE).sort())
  })

  it.each(Object.keys(PAYLOAD))('paketin tamamı: %s', (key) => {
    expect(payloadSha256(GOLDEN_VARIANTS[key]())).toBe(PAYLOAD[key])
  })

  it.each(Object.keys(FORM_BEFORE_STANDING_RULE))('form satırları sıra kuralından önceki gibi: %s', (key) => {
    expect(formSha256(GOLDEN_VARIANTS[key]())).toBe(FORM_BEFORE_STANDING_RULE[key])
  })

  // Özet bir şey değişti der ama neyin değiştiğini söylemez; hangi satırların girdiği de açıkça beklenir.
  // [ev sıra, deplasman sıra, ev form, deplasman form]; hiçbir satırı olmayan maç listede yoktur.
  it('girdi başına hangi sıra ve form satırları pakete giriyor: sıra satırı yalnızca doğrulanmış satırda', () => {
    expect(tableFlags(GOLDEN_VARIANTS.dogrulanmis())).toEqual({ 'Kuzey Yıldızı': [true, true, true, true] })
    // Doğu Gençlik: ev tarafı PPG +0,5 ile CSV'ye denk gelir ve doğrulanır; deplasman tarafları PPG farkıyla düşer.
    expect(tableFlags(GOLDEN_VARIANTS.ppgFarkli())).toEqual({ 'Kuzey Yıldızı': [true, false, true, false], 'Doğu Gençlik': [true, false, true, false] })
    // PPG yok (unverifiable), görüntü 7 günden eski (old-snapshot) ya da geçmiş yok: sıra satırı da yazılmaz.
    for (const key of ['ppgYok', 'eskiGoruntu', 'gecmisYok']) expect(tableFlags(GOLDEN_VARIANTS[key]()), key).toEqual({})
    // Gol sütunu yok: form satırı yok ama satır doğrulanır, sıra satırı yazılır.
    expect(tableFlags(GOLDEN_VARIANTS.golSutunuYok())).toEqual({ 'Kuzey Yıldızı': [true, true, false, false] })
    expect(tableFlags(GOLDEN_VARIANTS.formVeCsYok())).toEqual({ 'Kuzey Yıldızı': [true, true, true, true] })
    expect(tableFlags(GOLDEN_VARIANTS.tablodaYok())).toEqual({ 'Kuzey Yıldızı': [false, true, false, true] })
  })
})
