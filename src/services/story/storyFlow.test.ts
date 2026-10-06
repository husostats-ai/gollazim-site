import { describe, expect, it, vi } from 'vitest'
import type { Match, SharedPick } from '../../types'
import { activeShared, recordShare } from './shared'
import { downloadStory, previewStory } from './storyFlow'

const DAY = '2026-10-05'
const match = (id: string, time = '20:00'): Match => ({ id, uploadId: 'u', date: DAY, time, home: id, away: 'x', stats: {} })
const png = () => new Blob(['png'])

/** Kayıt deposu: uygulamadaki gibi mevcut kayıtlarla birleştirir */
const store = (now: () => string) => {
  const records: SharedPick[] = []
  const record = vi.fn(async (matches: Match[]) => {
    const added = recordShare(records, { date: DAY, categoryId: 'over25', matches, now: now() })
    records.push(...added)
    return added
  })
  return { records, record }
}

describe('Story akışı: önizleme ve indirme', () => {
  it('önizleme görseli üretir ama hiçbir kayıt oluşturmaz', async () => {
    const { records, record } = store(() => '2026-10-05T09:00:00.000Z')
    const render = vi.fn(async () => png())
    const preview = await previewStory({ render }, [match('a'), match('b')])
    expect(render).toHaveBeenCalledTimes(1)
    expect(preview.blob).toBeInstanceOf(Blob)
    expect(preview.matches.map((m) => m.id)).toEqual(['a', 'b'])
    // Kaç kez önizlenirse önizlensin
    await previewStory({ render }, [match('a'), match('b'), match('c')])
    expect(record).not.toHaveBeenCalled()
    expect(records).toEqual([])
  })

  it('indirme, önizlenen görseldeki maçları kaydeder', async () => {
    const { records, record } = store(() => '2026-10-05T09:00:00.000Z')
    const preview = await previewStory({ render: async () => png() }, [match('a'), match('b')])
    expect(await downloadStory({ record }, preview)).toEqual({ added: 2, late: 0 })
    expect(record).toHaveBeenCalledTimes(1)
    expect(activeShared(records).map((r) => r.matchId)).toEqual(['a', 'b'])
  })

  it('önizlemeden sonra seçim değişse de indirilen görseldeki maçlar kaydedilir', async () => {
    const { records, record } = store(() => '2026-10-05T09:00:00.000Z')
    const selected = [match('a'), match('b')]
    const preview = await previewStory({ render: async () => png() }, selected)
    selected.push(match('c'))
    await downloadStory({ record }, preview)
    expect(records.map((r) => r.matchId)).toEqual(['a', 'b'])
  })

  it('aynı görseli yeniden indirmek yeni kayıt açmaz; farklı görsel birleşir', async () => {
    const { records, record } = store(() => '2026-10-05T09:00:00.000Z')
    const first = await previewStory({ render: async () => png() }, [match('a'), match('b')])
    await downloadStory({ record }, first)
    expect(await downloadStory({ record }, first)).toEqual({ added: 0, late: 0 })
    const second = await previewStory({ render: async () => png() }, [match('b'), match('c')])
    expect(await downloadStory({ record }, second)).toEqual({ added: 1, late: 0 })
    expect(activeShared(records).map((r) => r.matchId)).toEqual(['a', 'b', 'c'])
  })

  it('maç sonrası işareti önizleme anına değil indirme anına göre konur', async () => {
    // Maç 20:00 (17:00 UTC). Önizleme 19:50'de, indirme 20:10'da.
    let now = '2026-10-05T16:50:00.000Z'
    const { records, record } = store(() => now)
    const preview = await previewStory({ render: async () => png() }, [match('a', '20:00'), match('b', '23:00')])
    now = '2026-10-05T17:10:00.000Z'
    expect(await downloadStory({ record }, preview)).toEqual({ added: 2, late: 1 })
    expect(records.map((r) => [r.matchId, r.afterKickoff, r.sharedAt])).toEqual([
      ['a', true, now],
      ['b', false, now],
    ])
  })
})
