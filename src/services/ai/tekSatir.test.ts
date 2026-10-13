import { describe, expect, it } from 'vitest'
import { AI_PROVIDERS } from '../../config/ai'
import { defaultThresholds } from '../../config/categories'
import { analyzeDay } from '../analysis/engine'
import { makeMatch } from '../analysis/testUtils'
import { CHATGPT_TEK_SATIR_1, CHATGPT_TEK_SATIR_2, CHATGPT_TEK_SATIR_SORULAN } from './__fixtures__/chatgptTekSatir'
import { collectAiMatches } from './collect'
import { askedMap, numberMap, PARSE_ERROR_CAUSE_LABELS, parseAiResponse, parseAiResponseDetailed, parseLineDetailed } from './parser'
import { buildPrompts } from './prompt'

describe('gerçek ChatGPT cevabı: bütün maçlar tek satırda (13 Ekim 2026)', () => {
  const numbers = numberMap(CHATGPT_TEK_SATIR_SORULAN.map((_, i) => `m${i + 1}`))
  const asked = askedMap(CHATGPT_TEK_SATIR_SORULAN)

  it('fixture iki tek satırdır', () => {
    for (const text of [CHATGPT_TEK_SATIR_1, CHATGPT_TEK_SATIR_2]) expect(text).not.toMatch(/[\r\n]/)
    expect(CHATGPT_TEK_SATIR_SORULAN).toHaveLength(30)
  })

  it.each([
    ['arada satır sonu var', '\n'],
    ['arada boş satır var (CRLF)', '\r\n\r\n'],
    ['arada satır sonu yok', ' '],
  ])('tek yapıştırma, %s: 30 maçın tamamı okunur, 0 hata, 0 eksik', (_, separator) => {
    const r = parseAiResponseDetailed(`${CHATGPT_TEK_SATIR_1}${separator}${CHATGPT_TEK_SATIR_2}`, numbers, asked)
    expect(r.errors).toEqual([])
    expect(r.missing).toEqual([])
    expect(r.ignored).toBe(0)
    expect(r.skipped).toBe(0)
    expect(r.verdicts.map((v) => v.number)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
    r.verdicts.forEach((v, i) => {
      // Kararlar tam olarak sorulan kategoriler içindir; cevapsız ya da uyarılı kategori yok.
      expect(Object.keys(v.decisions).sort(), `#${v.number}`).toEqual([...CHATGPT_TEK_SATIR_SORULAN[i]].sort())
      expect(v.unanswered, `#${v.number}`).toEqual([])
      expect(v.warnings, `#${v.number}`).toEqual([])
      expect(v.score, `#${v.number}`).toBeDefined()
      expect(v.reason).not.toContain('|')
      expect(`${v.reason} ${v.risk}`).not.toMatch(/#\d/)
    })
  })

  it('parçalar ayrı ayrı: 20 ve 10 maç; diğer parçanın maçları eksik görünür', () => {
    const first = parseAiResponse(CHATGPT_TEK_SATIR_1, numbers, asked)
    expect([first.verdicts.length, first.errors.length]).toEqual([20, 0])
    expect(first.missing).toEqual(Array.from({ length: 10 }, (_, i) => i + 21))
    const second = parseAiResponse(CHATGPT_TEK_SATIR_2, numbers, asked)
    expect([second.verdicts.length, second.errors.length]).toEqual([10, 0])
    expect(second.missing).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })

  it('tek tek alanlar: kararlar, gerekçe, risk ve skor kaymaz', () => {
    const r = parseAiResponse(`${CHATGPT_TEK_SATIR_1} ${CHATGPT_TEK_SATIR_2}`, numbers, asked)
    const of = (n: number) => r.verdicts.find((v) => v.number === n)!
    expect(of(1)).toMatchObject({ decisions: { ht05: 'medium', btts: 'reject' }, risk: 'Çok küçük örneklem, model ve piyasa çelişkisi', score: { home: 1, away: 2 } })
    expect(of(1).reason).toMatch(/^İlk yarı golü için piyasa olasılığı %71; .* bilgileri bilinmiyor\.$/)
    expect(of(13)).toMatchObject({ decisions: { over25: 'medium', ht05: 'medium', over25btts: 'medium' }, score: { home: 2, away: 2 } })
    expect(of(20)).toMatchObject({ decisions: { ht05: 'medium' }, risk: 'İlk yarı modeli yok', score: { home: 1, away: 1 } })
    expect(of(21)).toMatchObject({ decisions: { over25: 'reject' }, score: { home: 1, away: 0 } })
    expect(of(30)).toMatchObject({ decisions: { over25: 'medium' }, risk: 'Sınırlı örneklem', score: { home: 1, away: 3 } })
  })

  it('satır başına tek maç yazılmış hâliyle birebir aynı sonucu verir', () => {
    const oneLine = `${CHATGPT_TEK_SATIR_1} ${CHATGPT_TEK_SATIR_2}`
    const perLine = oneLine.replace(/ (?=#\d+ \|)/g, '\n')
    expect(perLine.split('\n')).toHaveLength(30)
    expect(parseAiResponse(oneLine, numbers, asked).verdicts).toEqual(parseAiResponse(perLine, numbers, asked).verdicts)
  })
})

describe('cevabı çözme: aynı satıra yazılmış maçlar', () => {
  const numbers = numberMap(['mA', 'mB', 'mC', 'mD'])
  const asked = askedMap([['over25', 'ht05', 'btts'], ['over25', 'btts'], ['ht05'], ['over25', 'ht05', 'btts', 'over25btts']])
  const parse = (text: string) => parseAiResponseDetailed(text, numbers, asked)
  const many = (n: number) => ({
    numbers: numberMap(Array.from({ length: n }, (_, i) => `m${i + 1}`)),
    asked: askedMap(Array.from({ length: n }, () => ['over25' as const])),
    text: Array.from({ length: n }, (_, i) => `#${i + 1} | 2.5 ÜST: Orta | Gerekçe ${i + 1}. | Risk ${i + 1} | SKOR: 1-${i % 5}`).join(' '),
  })

  it.each([20, 10])('tek satırda %i maç', (n) => {
    const input = many(n)
    const r = parseAiResponseDetailed(input.text, input.numbers, input.asked)
    expect(r.errors).toEqual([])
    expect(r.missing).toEqual([])
    expect(r.verdicts.map((v) => [v.number, v.reason, v.risk, v.score?.away])).toEqual(
      Array.from({ length: n }, (_, i) => [i + 1, `Gerekçe ${i + 1}.`, `Risk ${i + 1}`, i % 5]),
    )
  })

  it('skorsuz maçlar, kalın numara ve baştaki açıklama', () => {
    const r = parse('İşte cevaplar: **#1** | 2.5 ÜST: Orta | Gerekçe. | Risk **#2** | KG VAR: Zayıf | Gerekçe. | Risk | SKOR: 0-0 #3 | İY 0.5 ÜST: Güçlü | Gerekçe. | Risk')
    expect(r.errors).toEqual([])
    expect(r.ignored).toBe(1)
    expect(r.verdicts.map((v) => [v.number, v.risk, v.score])).toEqual([
      [1, 'Risk', undefined],
      [2, 'Risk', { home: 0, away: 0 }],
      [3, 'Risk', undefined],
    ])
  })

  it('gerekçede geçen "#3" ve "#3 |" bölmez', () => {
    const r = parse('#1 | 2.5 ÜST: Orta | Ligde #3 sırada; #2 | deplasman eksik, #4 |hücum zayıf. | Risk #3 kadar | SKOR: 2-1 #2 | KG VAR: Zayıf | Gerekçe. | Risk')
    expect(r.errors).toEqual([])
    expect(r.verdicts.map((v) => v.number)).toEqual([1, 2])
    expect(r.verdicts[0]).toMatchObject({ reason: 'Ligde #3 sırada; #2 | deplasman eksik, #4 | hücum zayıf.', risk: 'Risk #3 kadar', score: { home: 2, away: 1 } })
    expect(r.missing).toEqual([3, 4])
  })

  it('listede olmayan numara bölmez', () => {
    const r = parse('#1 | 2.5 ÜST: Orta | Gerekçe. | Risk #9 | 2.5 ÜST: Orta | x | y')
    expect(r.verdicts.map((v) => v.number)).toEqual([1])
    expect(r.errors).toEqual([])
  })

  it('aynı numara aynı satırda iki kez: ikincisi karar sayılmaz, hata olur', () => {
    const r = parse('#1 | 2.5 ÜST: Orta | Gerekçe. | Risk #1 | 2.5 ÜST: Zayıf | Başka. | Risk #2 | KG VAR: Orta | Gerekçe. | Risk')
    expect(r.verdicts.map((v) => [v.number, v.decisions])).toEqual([
      [1, { over25: 'medium' }],
      [2, { btts: 'medium' }],
    ])
    expect(r.errors).toEqual([{ line: 1, text: '#1 | 2.5 ÜST: Zayıf | Başka. | Risk', message: '#1 cevapta birden fazla kez geçiyor.', cause: 'duplicate', number: 1 }])
  })

  it('gerekçede fazladan | (tek satırlı biçimde)', () => {
    const r = parse('#2 | 2.5 ÜST: Orta ; KG VAR: Zayıf | Ev sahibi 3|2 formda | deplasman eksik. | Rotasyon #3 | İY 0.5 ÜST: Orta | a | b | c | Risk | SKOR: 1-0')
    expect(r.errors).toEqual([])
    expect(r.verdicts.map((v) => [v.number, v.reason, v.risk])).toEqual([
      [2, 'Ev sahibi 3 | 2 formda | deplasman eksik.', 'Rotasyon'],
      [3, 'a | b | c', 'Risk'],
    ])
  })

  it('yarım / bozuk maç yalnızca kendisi hataya düşer', () => {
    const cut = parse('#1 | 2.5 ÜST: Orta | Gerekçe. | Risk | SKOR: 1-0 #2 | KG VAR: Orta | Gerekçe ya')
    expect(cut.verdicts.map((v) => v.number)).toEqual([1])
    expect(cut.verdicts[0]).toMatchObject({ risk: 'Risk', score: { home: 1, away: 0 } })
    expect(cut.errors).toEqual([expect.objectContaining({ line: 1, number: 2, cause: 'fields', text: '#2 | KG VAR: Orta | Gerekçe ya' })])
    const bare = parse('#1 | 2.5 ÜST: Orta | Gerekçe. | Risk #2 |')
    expect(bare.verdicts[0].risk).toBe('Risk')
    expect(bare.errors.map((e) => [e.number, e.cause])).toEqual([[2, 'fields']])
  })

  it('satır sonları: CRLF, tek başına CR, Unicode satır ayırıcı, boş satırlar', () => {
    const lines = ['#1 | 2.5 ÜST: Orta | Gerekçe. | Risk', '#2 | KG VAR: Orta | Gerekçe. | Risk', '#3 | İY 0.5 ÜST: Orta | Gerekçe. | Risk']
    const expected = parse(lines.join('\n')).verdicts
    expect(expected).toHaveLength(3)
    for (const separator of ['\r\n', '\r', ' ', '\n\n  \n', ' ']) expect(parse(lines.join(separator)).verdicts, JSON.stringify(separator)).toEqual(expected)
  })
})

describe('cevabı çözme: atıf ve kaynak işaretleri', () => {
  const numbers = numberMap(['mA', 'mB'])
  const asked = askedMap([['over25', 'btts'], ['ht05']])
  const parse = (text: string) => parseAiResponseDetailed(text, numbers, asked)

  it('atıflar silinir; alanlar kaymaz', () => {
    const r = parse(
      '#1 | 2.5 ÜST: Orta [1] ; KG VAR: Zayıf【4†source】 | Ev sahibi formda [2, 3] ve golcü dönüyor¹ ([Mackolik](https://www.mackolik.com/mac?utm_source=chatgpt.com)). | Rotasyon citeturn0search1 | SKOR: 2-1 【7†L1-L4】 #2 | İY 0.5 ÜST: Güçlü | Gerekçe (ESPN) https://espn.com/x?utm_source=chatgpt.com | Risk[^2] | SKOR: 1-0 (ESPN)',
    )
    expect(r.errors).toEqual([])
    expect(r.verdicts).toHaveLength(2)
    expect(r.verdicts[0]).toMatchObject({
      decisions: { over25: 'medium', btts: 'weak' },
      warnings: [],
      reason: 'Ev sahibi formda ve golcü dönüyor (Mackolik).',
      risk: 'Rotasyon',
      score: { home: 2, away: 1 },
    })
    expect(r.verdicts[1]).toMatchObject({ decisions: { ht05: 'strong' }, reason: 'Gerekçe (ESPN)', risk: 'Risk', score: { home: 1, away: 0 } })
  })

  it('atıf içermeyen metin değişmez: düz parantez, köşeli metin ve çift boşluk kalır', () => {
    const r = parse('#1 | 2.5 ÜST: Orta | Kaleci [sakat]  oynamıyor (QSL). | Küçük  örneklem')
    expect(r.verdicts[0]).toMatchObject({ reason: 'Kaleci [sakat]  oynamıyor (QSL).', risk: 'Küçük  örneklem' })
  })
})

describe('cevabı çözme: kısa hata nedeni ve yok sayılan kararlar', () => {
  const numbers = numberMap(['mA', 'mB', 'mC'])
  const asked = askedMap([['over25', 'btts'], ['over25'], ['ht05']])

  it('her hata maç numarası ve kısa nedenle gelir', () => {
    const r = parseAiResponseDetailed(
      [
        '#1 | 2.5 ÜST: Orta',
        '#1 | KORNER 8.5 ÜST: Güçlü | Gerekçe. | Risk',
        '#1 | 2.5 ÜST: Belki | Gerekçe. | Risk',
        '#3 | KG VAR: Orta | Gerekçe. | Risk',
        '#2 | Orta | Gerekçe. | Risk',
        '#2 | 2.5 ÜST: Orta |  | Risk',
        '#9 | 2.5 ÜST: Orta | Gerekçe. | Risk',
        'x | y | z | t',
        '#1 | 2.5 ÜST: Orta | Gerekçe. | Risk',
        '#1 | 2.5 ÜST: Orta | Gerekçe. | Risk',
      ].join('\n'),
      numbers,
      asked,
    )
    expect(r.errors.map((e) => [e.line, e.number, e.cause])).toEqual([
      [1, 1, 'fields'],
      [2, 1, 'category'],
      [3, 1, 'decision'],
      [4, 3, 'notAsked'],
      [5, 2, 'oldFormat'],
      [6, 2, 'emptyReason'],
      [7, 9, 'unknownNumber'],
      [8, undefined, 'noNumber'],
      [10, 1, 'duplicate'],
    ])
    expect(PARSE_ERROR_CAUSE_LABELS).toMatchObject({ fields: 'alan sayısı yanlış', category: 'kategori tanınmadı', decision: 'karar kelimesi geçersiz' })
    // Eski dönüş biçimi aynı hataları yalnızca satır, metin ve mesajla verir.
    const plain = parseAiResponse('#1 | 2.5 ÜST: Orta', numbers, asked)
    expect(Object.keys(plain.errors[0]).sort()).toEqual(['line', 'message', 'text'])
    expect(Object.keys(plain).sort()).toEqual(['errors', 'ignored', 'missing', 'verdicts'])
  })

  it('sorulmayan kategori kararı: uyarı aynen kalır, ayrıca sayılır', () => {
    const r = parseAiResponseDetailed('#3 | İLK YARI 0.5 ÜST: Orta ; KG VAR: Güçlü ; 2.5 ÜST: Zayıf | Gerekçe. | Risk #2 | 2.5 ÜST: Orta | Gerekçe. | Risk', numbers, asked)
    expect(r.skipped).toBe(2)
    expect(r.verdicts[0].decisions).toEqual({ ht05: 'medium' })
    expect(r.verdicts[0].warnings).toEqual(['#3: KG VAR bu maç için sorulmadı; karar yok sayıldı.', '#3: 2.5 ÜST bu maç için sorulmadı; karar yok sayıldı.'])
    expect(r.verdicts[1].warnings).toEqual([])
  })

  it('elle düzeltme: tek maç ayrıntılı çözülür', () => {
    expect(parseLineDetailed('#2 | 2.5 ÜST: Güçlü | Gerekçe. | Risk', numbers, asked)).toMatchObject({ kind: 'verdict', skipped: 0, verdict: { number: 2 } })
    expect(parseLineDetailed('#2 | 2.5 ÜST: Güçlü', numbers, asked)).toMatchObject({ kind: 'error', cause: 'fields', number: 2 })
  })
})

describe('prompt: her maç ayrı satıra', () => {
  const items = collectAiMatches(
    analyzeDay(
      Array.from({ length: 5 }, (_, i) => makeMatch({ over25Pct: 90 }, { home: `Takım ${i + 1}`, time: '20:00' })),
      defaultThresholds(),
    ),
  )
  const rule = '- Her maçı AYRI BİR SATIRA yaz: her satır #numara ile başlasın ve satır sonuyla bitsin. Birden fazla maçı aynı satıra yazma.'

  it('kural her parçada ve her yapay zekâda CEVAP BİÇİMİ bölümündedir', () => {
    for (const provider of AI_PROVIDERS) {
      const chunks = buildPrompts(items, provider.id, 'x', 2)
      expect(chunks).toHaveLength(3)
      for (const chunk of chunks) {
        const format = chunk.text.slice(chunk.text.indexOf('CEVAP BİÇİMİ'), chunk.text.indexOf('=== VERİ BAŞLANGICI ==='))
        expect(format.split('\n')).toContain(rule)
        expect(format).toContain('- Her maç için tek satır yaz: #numara | KATEGORİ: KARAR ; KATEGORİ: KARAR | gerekçe | risk | SKOR: ev-deplasman')
        expect(format).toContain('- Verilen numaraları aynen kullan; maçları yeniden numaralama ve maç atlama.')
        expect(chunk.text).not.toContain('satır atlama')
      }
    }
  })
})
