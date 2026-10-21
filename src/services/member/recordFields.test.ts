import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Pick } from '../../types'
import { buildStarStats } from '../stats/starStats'
import { buildStats } from '../stats/statsEngine'
import { PICKS, memberInput } from './__fixtures__/rawData'
import { buildMemberPayload } from './payload'

// Yalnızca ölçüm için tutulan admin kayıt alanları (dondurulan öneri). Davranışı etkilemezler:
// üye paketine, istatistiğe, görsellere (Story, öne çıkanlar, sonuç) ve AI prompt'una girmezler.

const COMMIT_CANARY = 'c0ffee1'
const UPLOADED_CANARY = '2026-10-04T05:06:07.000Z'
const PICK_RECORD_KEYS = ['sampleAtFreeze', 'rankAtFreeze', 'appCommit', 'statsUploadedAt'] as const

const withRecord = (picks: Pick[]): Pick[] => picks.map((p, i) => ({ ...p, sampleAtFreeze: 37, rankAtFreeze: 900 + i, appCommit: COMMIT_CANARY, statsUploadedAt: UPLOADED_CANARY }))

/** Kaynak klasördeki (testler hariç) dosyaların metni */
const sources = (dir: string): [string, string][] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes('__fixtures__'))
    .map((f) => [join(dir, f), readFileSync(join(dir, f), 'utf8')])

describe('dondurulan önerinin ölçüm kayıt alanları yalnızca admin verisinde kalır', () => {
  it('üye paketi: alanlar ve değerleri hiç geçmez; paket alanlar olmadan kurulanla birebir aynı', () => {
    const plain = buildMemberPayload(memberInput())
    const recorded = buildMemberPayload(memberInput({ picks: withRecord(PICKS) }))
    expect(recorded).toEqual(plain)
    const text = JSON.stringify(recorded)
    for (const key of PICK_RECORD_KEYS) expect(text, key).not.toContain(key)
    expect(text).not.toContain(COMMIT_CANARY)
    expect(text).not.toContain(UPLOADED_CANARY)
  })

  it('istatistik ve yıldız istatistiği alanlardan etkilenmez', () => {
    expect(buildStats(withRecord(PICKS))).toEqual(buildStats(PICKS))
    expect(buildStarStats(withRecord(PICKS))).toEqual(buildStarStats(PICKS))
  })

  it('görsel, Story, AI, istatistik ve üye kodu alanları okumaz (yalnızca dondurma yazar)', () => {
    for (const dir of ['src/services/image', 'src/services/story', 'src/services/ai', 'src/services/stats', 'src/services/member', 'src/member', 'src/services/highlights', 'src/services/streak']) {
      for (const [file, text] of sources(dir)) for (const key of PICK_RECORD_KEYS) expect(text.includes(key), `${file}: ${key}`).toBe(false)
    }
    const writers = sources('src').filter(([, text]) => /rankAtFreeze|sampleAtFreeze|statsUploadedAt/.test(text)).map(([file]) => file).sort()
    expect(writers).toEqual(['src/services/results/freeze.ts', 'src/services/results/resultService.ts', 'src/types.ts'])
  })
})
