import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GOLDEN_VARIANTS, goldenOf } from './__fixtures__/payloadGoldenVariants'

// matchForms'un tablo satırı / engel hesabı verifiedTableRows'a ayrıldı. Bu sabit girdilerle üye paketi
// ayrımdan ÖNCEKİ çıktıyla birebir aynı kalmalıdır (paketin tamamının sha256'sı karşılaştırılır).
const GOLDEN = JSON.parse(readFileSync(new URL('./__fixtures__/payloadGolden.json', import.meta.url), 'utf8')) as Record<string, unknown>

describe('üye paketi: lig tablosu satırları ayrımdan önceki çıktıyla aynı', () => {
  it.each(Object.keys(GOLDEN_VARIANTS))('%s', (key) => {
    expect(goldenOf(GOLDEN_VARIANTS[key]())).toEqual(GOLDEN[key])
  })
})
