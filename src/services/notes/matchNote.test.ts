import { describe, expect, it } from 'vitest'
import type { MatchNote } from '../../types'
import { applyNoteChange, cleanNoteText, MATCH_NOTE_LIMITS, memberNoteInputs, normalizeMatchNotes } from './matchNote'
import { checkSource, encodeWithinLimit, fitSize, NOTE_JPEG_QUALITIES, NOTE_SOURCE_LIMITS } from './noteImage'

const NOW = new Date('2026-10-25T09:00:00.000Z')
const MATCH = '2026-10-25|ev|deplasman'
const IMAGE = { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGOQqzgBRww4OQA4KhBpUsYmbgAAAABJRU5ErkJggg==', w: 4, h: 3 }

/** Verilen bayt boyutunda (base64 çözülmüş) sahte data: adresi */
const fakeDataUrl = (type: 'image/jpeg' | 'image/png', bytes: number): string => `data:${type};base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`

const saved = (change: Parameters<typeof applyNoteChange>[2], existing?: MatchNote): MatchNote | null => {
  const result = applyNoteChange(MATCH, existing, change, NOW)
  if (!result.ok) throw new Error(result.reason)
  return result.note
}

describe('maç notu: kaydetme kuralları', () => {
  it('sınırlar üye paketinin şemasıyla aynıdır', () => {
    expect(MATCH_NOTE_LIMITS).toEqual({ text: 600, side: 900, imageBytes: 300 * 1024 })
  })

  it('yeni not: "Üyelere göster" varsayılan olarak açık; okununca aynı', () => {
    expect(saved({ text: 'Kadro açıklandı.' })).toEqual({ matchId: MATCH, text: 'Kadro açıklandı.', publish: true, updatedAt: NOW.toISOString() })
    expect(saved({ image: IMAGE })).toEqual({ matchId: MATCH, image: IMAGE, publish: true, updatedAt: NOW.toISOString() })
  })

  it('600 karakter sınırı: 600 kabul, 601 ret; sınır temizlenmiş metne uygulanır', () => {
    expect(saved({ text: 'a'.repeat(600) })?.text).toHaveLength(600)
    const tooLong = applyNoteChange(MATCH, undefined, { text: 'a'.repeat(601) }, NOW)
    expect(tooLong).toEqual({ ok: false, reason: 'Not en fazla 600 karakter olabilir.' })
    // Baştaki/sondaki boşluk sayılmaz.
    expect(saved({ text: `   ${'a'.repeat(600)}  \n` })?.text).toHaveLength(600)
  })

  it('düz metin: HTML olduğu gibi saklanır (yorumlanmaz); satır sonları korunur, denetim karakterleri atılır', () => {
    expect(saved({ text: '<b>kalın</b> <img src=x onerror=alert(1)>' })?.text).toBe('<b>kalın</b> <img src=x onerror=alert(1)>')
    expect(cleanNoteText('  bir\r\niki\rüç\u0000\u0007\tdört  ')).toBe('bir\niki\nüç\tdört')
  })

  it('bağlantı içeren metin reddedilir (paket bağlantı taşımaz)', () => {
    for (const text of ['bkz. https://ornek.test', 'http://x.y', 'www.ornek.test']) expect(applyNoteChange(MATCH, undefined, { text }, NOW).ok, text).toBe(false)
  })

  it('metin ve görsel ayrı silinir; ikisi de yoksa not silinir (null)', () => {
    const both = saved({ text: 'not', image: IMAGE })!
    expect(saved({ image: null }, both)).toEqual({ matchId: MATCH, text: 'not', publish: true, updatedAt: NOW.toISOString() })
    expect(saved({ text: '' }, both)).toEqual({ matchId: MATCH, image: IMAGE, publish: true, updatedAt: NOW.toISOString() })
    expect(saved({ text: '   ', image: null }, both)).toBeNull()
    expect(saved({ text: '' })).toBeNull()
  })

  it('"Üyelere göster" değişikliği korunur; dokunulmayan alan değişmez', () => {
    const hidden = saved({ publish: false }, saved({ text: 'not', image: IMAGE })!)!
    expect(hidden.publish).toBe(false)
    expect(saved({ text: 'yeni' }, hidden)).toMatchObject({ text: 'yeni', image: IMAGE, publish: false })
  })

  it('geçersiz görsel reddedilir (tür, boyut, kenar)', () => {
    for (const image of [{ ...IMAGE, dataUrl: 'data:image/gif;base64,R0lGODlh' }, { ...IMAGE, w: 901 }, { ...IMAGE, h: 0 }, { ...IMAGE, dataUrl: fakeDataUrl('image/jpeg', 300 * 1024 + 1) }]) expect(applyNoteChange(MATCH, undefined, { image }, NOW).ok).toBe(false)
    expect(applyNoteChange(MATCH, undefined, { image: { ...IMAGE, dataUrl: fakeDataUrl('image/jpeg', 300 * 1024) } }, NOW).ok).toBe(true)
  })
})

describe('maç notu: yedekten okuma', () => {
  const ids = new Set([MATCH, 'diger'])

  it('notu olmayan eski yedek: hiç not gelmez', () => {
    expect(normalizeMatchNotes(undefined, ids)).toEqual([])
    expect(normalizeMatchNotes(null, ids)).toEqual([])
  })

  it('geçerli not olduğu gibi gelir; işareti olmayan not "Üyelere göster" sayılır', () => {
    const note: MatchNote = { matchId: MATCH, text: 'not', image: IMAGE, publish: false, updatedAt: NOW.toISOString() }
    expect(normalizeMatchNotes([note], ids)).toEqual([note])
    expect(normalizeMatchNotes([{ matchId: MATCH, text: 'not', updatedAt: NOW.toISOString() }], ids)).toEqual([{ matchId: MATCH, text: 'not', publish: true, updatedAt: NOW.toISOString() }])
  })

  it('maçı yedekte olmayan, boş, bozuk ve tekrarlanan not atlanır; bozuk görselin metni kalır', () => {
    const notes = normalizeMatchNotes(
      [
        { matchId: 'silinmis', text: 'yetim not', publish: true },
        { matchId: 'diger', publish: true },
        'bozuk',
        { matchId: MATCH, text: 'ilk', image: { dataUrl: 'javascript:1', w: 4, h: 3 }, publish: true },
        { matchId: MATCH, text: 'ikinci', publish: true },
      ],
      ids,
    )
    expect(notes.map((n) => [n.matchId, n.text, n.image])).toEqual([[MATCH, 'ilk', undefined]])
  })
})

describe('maç notu: paket girdisi', () => {
  it('yalnızca "Üyelere göster" açık notlar; yalnızca metin ve görsel', () => {
    const notes: MatchNote[] = [
      { matchId: 'a', text: 'açık', image: IMAGE, publish: true, updatedAt: NOW.toISOString() },
      { matchId: 'b', text: 'gizli', publish: false, updatedAt: NOW.toISOString() },
      { matchId: 'c', image: IMAGE, publish: true, updatedAt: NOW.toISOString() },
    ]
    expect(memberNoteInputs(notes)).toEqual([{ matchId: 'a', text: 'açık', image: IMAGE }, { matchId: 'c', image: IMAGE }])
  })
})

describe('not görseli: küçültme sınırları', () => {
  it('en uzun kenar 900 pikseli geçmez; küçük görsel büyütülmez', () => {
    expect(fitSize(1920, 1080)).toEqual({ w: 900, h: 506 })
    expect(fitSize(1080, 2400)).toEqual({ w: 405, h: 900 })
    expect(fitSize(1080, 8000)).toEqual({ w: 122, h: 900 })
    expect(fitSize(640, 480)).toEqual({ w: 640, h: 480 })
    expect(fitSize(9000, 3)).toEqual({ w: 900, h: 1 })
  })

  it('yalnızca PNG, JPG ve WEBP; kaynak dosya en fazla 20 MB', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) expect(checkSource(type, 1000), type).toBeNull()
    for (const type of ['image/gif', 'image/svg+xml', 'image/bmp', 'image/heic', 'application/pdf', '']) expect(checkSource(type, 1000), type).toMatch(/Yalnızca PNG, JPG ve WEBP/)
    expect(checkSource('image/png', NOTE_SOURCE_LIMITS.bytes)).toBeNull()
    expect(checkSource('image/png', NOTE_SOURCE_LIMITS.bytes + 1)).toMatch(/Dosya çok büyük/)
  })

  const size = { w: 900, h: 506 }
  /** Kaliteye göre boyut veren sahte JPEG kodlayıcı; denenen kaliteler kaydedilir */
  const jpegBy = (bytesAt: (q: number) => number, tried: number[] = []) => (q: number) => {
    tried.push(q)
    return fakeDataUrl('image/jpeg', bytesAt(q))
  }
  const noPng = () => {
    throw new Error('şeffaf olmayan görselde PNG denenmemeli')
  }

  it('JPEG kalite ~0.82; sınıra sığınca ilk basamakta kalır', () => {
    const tried: number[] = []
    const result = encodeWithinLimit(size, false, noPng, jpegBy(() => 120 * 1024, tried))
    expect(result).toMatchObject({ ok: true, type: 'image/jpeg', quality: 0.82, image: { w: 900, h: 506 } })
    expect(tried).toEqual([0.82])
    expect(NOTE_JPEG_QUALITIES[0]).toBe(0.82)
  })

  it('300 KB üstüne çıkarsa kalite düşürülür', () => {
    const tried: number[] = []
    const result = encodeWithinLimit(size, false, noPng, jpegBy((q) => (q > 0.65 ? 400 * 1024 : 250 * 1024), tried))
    expect(result).toMatchObject({ ok: true, quality: 0.62 })
    expect(tried).toEqual([0.82, 0.72, 0.62])
  })

  it('en düşük kalitede de büyükse reddedilir ve nedeni yazılır', () => {
    const result = encodeWithinLimit(size, false, noPng, jpegBy(() => 512 * 1024))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('Görsel 900×506 piksele küçültülüp en düşük kalitede kodlandığında bile 512 KB; sınır 300 KB. Daha sade ya da daha küçük bir görsel deneyin.')
  })

  it('şeffaf görsel: PNG sınıra sığarsa PNG; sığmazsa JPEG basamakları', () => {
    expect(encodeWithinLimit(size, true, () => fakeDataUrl('image/png', 200 * 1024), jpegBy(() => 1))).toMatchObject({ ok: true, type: 'image/png', quality: null })
    expect(encodeWithinLimit(size, true, () => fakeDataUrl('image/png', 700 * 1024), jpegBy(() => 90 * 1024))).toMatchObject({ ok: true, type: 'image/jpeg', quality: 0.82 })
  })

  it('tarayıcı JPEG kodlayamazsa (PNG döndürürse) reddedilir', () => {
    expect(encodeWithinLimit(size, false, noPng, () => fakeDataUrl('image/png', 10))).toEqual({ ok: false, reason: 'Tarayıcı görseli JPEG olarak kodlayamadı.' })
  })
})
