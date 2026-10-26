import { describe, expect, it } from 'vitest'
import { formSha256, GOLDEN_VARIANTS, payloadSha256, tableFlags } from './__fixtures__/payloadGoldenVariants'

// Üye paketinin lig tablosu satırları için sabit, tamamen sentetik girdiler. Özetler yeniden üretilmez; bir kural
// bilerek değişince yeni değer, neyin değiştiği aşağıdaki beklentilerle birlikte yazılır.
//
// Geçmiş: 56503ef'de alınan özetler (matchForms → verifiedTableRows ayrımında paket birebir aynı kaldı) sıra satırı
// kuralıyla değişti: sıra satırı artık form satırı gibi maçtan önceki görüntüden ve yalnızca doğrulandıysa yazılır.
// Sonra paket sürümü 14 ile yeniden değişti: v 13 → 14 ve istatistikte htScoreless yerine ht05Note. Bu iki alan
// çıkarılınca 8 paketin hepsi bir önceki sürümle (968ddc9) birebir aynıydı (tek seferlik karşılaştırma).
const PAYLOAD: Record<string, string> = {
  dogrulanmis: '365fb11bd305a4005e955ed1d23b0a6899debfeb826deeba8e9df2b5461ae90a',
  ppgFarkli: '4f1a3cb9ad91ed9b3623a4b3a1044cb19b3c5da2545877443f0598a7d6ff0344',
  ppgYok: '9f86e574e2a32a742ae719905f4da3ad414b033aa1ff6edda7f784475564d646',
  eskiGoruntu: '9f86e574e2a32a742ae719905f4da3ad414b033aa1ff6edda7f784475564d646',
  golSutunuYok: 'eec201a1f4539e44898d4f336700d7f936816ab5485ec6092c2fa2db48f8ba44',
  formVeCsYok: 'f93179e90617b106ea6d7eed444819a47a8e3f09000bb3103047c89267bd0692',
  tablodaYok: 'b2f407d55d346d63fa5307994df9d45c0824c239f9f983c88a3d6c0ef5854c8d',
  gecmisYok: '9f86e574e2a32a742ae719905f4da3ad414b033aa1ff6edda7f784475564d646',
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
