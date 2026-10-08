import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { AI_CATEGORY_IDS, AI_CHUNK_SIZE, AI_PROVIDERS, type AiDecision } from '../../config/ai'
import { defaultThresholds } from '../../config/categories'
import type { AiVerdict, Pick } from '../../types'
import { analyzeDay } from '../analysis/engine'
import { makeMatch } from '../analysis/testUtils'
import { isBackupFile } from '../data/backupFormat'
import { AI_SOURCES, buildCategoryAiStats, buildLegacyAiStats } from './aiStats'
import { agreementLabel, agreementText, majorityDecision, summarizeVerdicts } from './consensus'
import { collectAiMatches } from './collect'
import { askedMap, numberMap, OLD_FORMAT_MESSAGE, parseAiResponse, parseLine } from './parser'
import { buildPrompts, DATA_END, DATA_START, matchBlock } from './prompt'

const collect = (matches: ReturnType<typeof makeMatch>[]) => collectAiMatches(analyzeDay(matches, defaultThresholds()))

// Piyasa evi net favori görüyor, xG tersini söylüyor: Taraf & Gol'de çelişki
const rich = makeMatch(
  {
    over25Pct: 90,
    bttsPct: 85,
    avgGoals: 3.2,
    avgCorners: 9.5,
    avgCards: 4.34,
    homePpg: 2.33,
    awayPpg: 0.5,
    homeXg: 0.8,
    awayXg: 1.9,
    oddsHome: 1.15,
    oddsDraw: 9,
    oddsAway: 17,
    oddsOver25: 1.35,
    oddsUnder25: 3.2,
  },
  { home: 'Şanlıurfaspor', away: 'Iğdır FK', time: '20:45', league: 'Türkiye · 1. Lig' },
)
const early = makeMatch({ over25Pct: 80 }, { home: 'Erken', away: 'Maç', time: '12:00' })
const weak = makeMatch({ over25Pct: 40, bttsPct: 30 }, { home: 'Zayıf', away: 'Maç', time: '10:00' })

describe('collectAiMatches', () => {
  const items = collect([rich, early, weak])

  it('eşiği geçen maçları benzersiz maç bazında toplar; eşiği geçmeyen maç girmez', () => {
    expect(items.map((i) => i.match.id)).toEqual([early.id, rich.id])
  })

  it('başlama saatine göre sıralar ve maçın geçtiği tüm kategorileri getirir', () => {
    expect(items[0].predictions.map((p) => p.categoryId)).toEqual(['over25'])
    expect(items[1].predictions.map((p) => p.categoryId)).toEqual(['over25', 'btts', 'homeWin15', 'homeWin25'])
  })

  it('hiçbir maç eşiği geçmiyorsa boş döner', () => {
    expect(collect([weak])).toEqual([])
  })

  it('karar istenen kategoriler: dört listeden maçın ilk 15\'te olduğu kategoriler, kayıt defteri sırasıyla', () => {
    expect(AI_CATEGORY_IDS).toEqual(['over25', 'ht05', 'btts', 'over25btts'])
    expect(items.map((i) => i.evaluate)).toEqual([['over25'], ['over25', 'btts']])
    const all = makeMatch({ over25Pct: 90, ht05Pct: 95, bttsPct: 90, homeXg: 2.4, awayXg: 2.2, sh05Pct: 95 }, { home: 'Dört', time: '09:00' })
    expect(collect([all])[0].evaluate).toEqual(['over25', 'ht05', 'btts', 'over25btts'])
  })

  it('dört kategorinin hiçbirinde olmayan maç (yalnızca 2. yarı, korner, kart…) listeye hiç girmez', () => {
    const others = makeMatch({ sh05Pct: 95, corners85Pct: 95, avgCards: 7, over35Pct: 90 }, { home: 'Yalnız Korner', time: '11:00' })
    const analysis = analyzeDay([others, early], defaultThresholds())
    // Maç başka listelerde eşiği geçiyor…
    expect((['sh05', 'corners85', 'cards35', 'over35'] as const).every((id) => analysis[id].predictions.some((p) => p.match.id === others.id))).toBe(true)
    // …ama yapay zekâya sorulmuyor ve prompta girmiyor.
    const collected = collect([others, early])
    expect(collected.map((i) => i.match.id)).toEqual([early.id])
    const prompt = buildPrompts(collected, 'chatgpt', 'x')[0].text
    expect(prompt).not.toContain('Yalnız Korner')
    expect(prompt.match(/^#\d+ \|/gm)).toHaveLength(1)
  })

  it('16. sıradaki maç (listede görünmeyen) o kategori için sorulmaz', () => {
    const many = Array.from({ length: 16 }, (_, i) => makeMatch({ over25Pct: 99 - i }, { home: `Sıra ${String(i + 1).padStart(2, '0')}`, time: '20:00' }))
    expect(collect(many)).toHaveLength(15)
    expect(collect(many).some((i) => i.match.home === 'Sıra 16')).toBe(false)
  })
})

describe('prompt üretimi', () => {
  const items = collect([rich, early])
  const [chunk] = buildPrompts(items, 'chatgpt', '5 Ekim 2026 Pazartesi')
  const data = chunk.text.slice(chunk.text.indexOf(DATA_START), chunk.text.indexOf(DATA_END))

  it('her maça sırayla numara verir ve veriyi ayrı bir blokta tutar', () => {
    expect(chunk).toMatchObject({ index: 1, total: 1, from: 1, to: 2 })
    expect(chunk.text.indexOf(DATA_START)).toBeGreaterThan(0)
    expect(chunk.text.indexOf(DATA_END)).toBeGreaterThan(chunk.text.indexOf(DATA_START))
    expect(data).toContain('#1 | 12:00 | lig yok | Erken - Maç')
    expect(data).toContain('#2 | 20:45 | Türkiye · 1. Lig | Şanlıurfaspor - Iğdır FK')
    expect(data.match(/^#\d+ \|/gm)).toHaveLength(2)
  })

  it('kategorileri, yüzdeleri, güvenilirlik ve çelişki bilgisini içerir', () => {
    const block = matchBlock(items[1], 2)
    // xG toplamı 2,7: model 2.5 Üst %51, KG Var %47; hazır yüzdelerle fark 25 puandan büyük
    expect(block).toContain('2.5 ÜST %90 (güvenilirlik: Bilinmiyor; model %51; Model çelişkisi; xG zayıf)')
    expect(block).toContain('KG VAR %85 (güvenilirlik: Bilinmiyor; model %47; Model çelişkisi; xG zayıf)')
    expect(block).toMatch(/EV KAZANIR & 1\.5 ÜST %\d+ \(güvenilirlik: Piyasa tabanlı; xG modeli %\d+; Çelişki; xG zayıf\)/)
  })

  it('istatistikleri Türkçe ondalıkla yazar; olmayan değer için "veri yok" der', () => {
    const block = matchBlock(items[1], 2)
    expect(block).toContain('Gol ortalaması: 3,2')
    expect(block).toContain('Korner ortalaması: 9,5')
    expect(block).toContain('Kart ortalaması: 4,34')
    expect(block).toContain('Maç başı puan (PPG): ev 2,33 / deplasman 0,5')
    expect(block).toContain('Maç öncesi xG: ev 0,8 / deplasman 1,9')
    expect(block).toContain('1X2 oranları: 1,15 / 9 / 17')
    const bare = matchBlock(items[0], 1)
    expect(bare).toContain('Gol ortalaması: veri yok')
    expect(bare).toContain('Maç başı puan (PPG): veri yok')
    expect(bare).toContain('1X2 oranları: veri yok')
  })

  it('her maç için gol modeli satırı ekler; hesaplanamayan değer "veri yok" olur', () => {
    expect(matchBlock(items[1], 2)).toContain('Gol modeli: 2.5 Üst %51 ; 3.5 Üst %29 ; 4.5 Üst %14 ; KG Var %47')
    // Bu maçta xG de gol ortalaması da yok
    expect(matchBlock(items[0], 1)).toContain('Gol modeli: 2.5 Üst veri yok ; 3.5 Üst veri yok ; 4.5 Üst veri yok ; KG Var veri yok')
    // Yalnızca gol ortalaması varsa üst çizgileri hesaplanır, KG Var hesaplanmaz
    const [onlyAverage] = collect([makeMatch({ over25Pct: 80, avgGoals: 3 })])
    expect(matchBlock(onlyAverage, 1)).toContain('Gol modeli: 2.5 Üst %58 ; 3.5 Üst %35 ; 4.5 Üst %18 ; KG Var veri yok')
    expect(chunk.text).toContain('"Gol modeli" satırı')
    expect(chunk.text).toContain('25 puandan fazla fark varsa "Model çelişkisi" yazar')
  })

  it('kuralları ve cevap biçimini içerir', () => {
    for (const phrase of [
      'Yalnızca aşağıdaki VERİ bloğundaki bilgileri ve kendi aradığın kaynakları kullan',
      'Veri uydurma',
      '"bilinmiyor" yaz',
      'Kesinlik iddia etme',
      'Her maç için "Değerlendir" satırındaki HER kategoriye ayrı bir KARAR ver: Güçlü, Orta, Zayıf veya Eleme. Listede olmayan kategoriye karar verme.',
      '#numara | KATEGORİ: KARAR ; KATEGORİ: KARAR | gerekçe | risk | SKOR: ev-deplasman',
      'Kategori adlarını "Değerlendir" satırındakiyle birebir aynı yaz.',
      "Örnek satır: #3 | 2.5 ÜST: Orta ; KG VAR: Orta ; İLK YARI 0.5 ÜST: Zayıf | İki takımın xG'si yüksek, model 2.5 Üst'ü destekliyor (QSL). | Küçük örneklem | SKOR: 2-2",
      'Markdown tablosu, kalın yazı',
      'en fazla iki cümle',
      '5 Ekim 2026 Pazartesi',
    ]) {
      expect(chunk.text).toContain(phrase)
    }
  })

  it('her maç bloğunun son satırı "Değerlendir": yalnızca o maçın karar istenen kategorileri', () => {
    expect(matchBlock(items[0], 1).split('\n').pop()).toBe('Değerlendir: 2.5 ÜST')
    expect(matchBlock(items[1], 2).split('\n').pop()).toBe('Değerlendir: 2.5 ÜST ; KG VAR')
    // Veri bloğundaki "Öneriler" satırı değişmedi: maçın tüm kategorileri orada durur.
    expect(matchBlock(items[1], 2)).toMatch(/^Öneriler: .*EV KAZANIR & 1\.5 ÜST/m)
    expect(data.match(/^Değerlendir: /gm)).toHaveLength(2)
  })

  it('KURALLAR bölümü ve eski tek kararlı biçim: kurallar aynı, eski biçim satırı yok', () => {
    const rules = chunk.text.slice(chunk.text.indexOf('KURALLAR'), chunk.text.indexOf('GÖREV'))
    expect(createHash('sha256').update(rules).digest('hex')).toBe('2b14f61fa56f846aa54e00561c9bd124221a44760546033d60ad2de2664bd4e6')
    expect(chunk.text).not.toContain('#numara | KARAR | gerekçe | risk')
    expect(chunk.text).not.toContain('tek bir KARAR ver')
  })

  it('seçilen yapay zekâya göre yönerge ekler; yönerge veri bloğundan sonra gelir', () => {
    const gemini = buildPrompts(items, 'gemini', 'x')[0].text
    expect(chunk.text).toContain('ChatGPT için yönerge')
    expect(chunk.text).not.toContain('Gemini için yönerge')
    expect(gemini).toContain('Gemini için yönerge')
    expect(gemini).toContain('Google Arama')
    for (const text of [chunk.text, gemini]) {
      expect(text).toMatch(/sakatlık.*kadro.*rotasyon.*motivasyon/s)
      expect(text).toContain('kaynağın adını')
      expect(text.lastIndexOf('için yönerge')).toBeGreaterThan(text.indexOf(DATA_END))
    }
    // veri bloğu iki yapay zekâ için aynıdır
    expect(gemini.slice(gemini.indexOf(DATA_START), gemini.indexOf(DATA_END))).toBe(data)
  })

  it('Claude promptu diğerleriyle aynıdır; yalnızca son satırdaki yönerge farklıdır', () => {
    const claude = buildPrompts(items, 'claude', 'x')[0].text
    const body = (text: string) => text.slice(0, text.lastIndexOf('\n'))
    expect(body(claude)).toBe(body(buildPrompts(items, 'chatgpt', 'x')[0].text))
    expect(body(claude)).toBe(body(buildPrompts(items, 'gemini', 'x')[0].text))
    expect(claude.slice(claude.lastIndexOf('\n') + 1)).toMatch(/^Claude için yönerge: Cevap vermeden önce web arama özelliğini aç\. /)
    expect(claude).not.toContain('ChatGPT için yönerge')
  })

  it('ChatGPT ve Gemini yönergeleri Claude eklenirken değişmedi', () => {
    const hash = (id: string) => createHash('sha256').update(AI_PROVIDERS.find((p) => p.id === id)!.instruction).digest('hex')
    expect(hash('chatgpt')).toBe('4fda49c603816953c9c415de4e651bea77f64bad0d0108a06d95a54e69dd1398')
    expect(hash('gemini')).toBe('d163eb80110936218e5afb9ab5d91a5b3a7eccfb9f8cc58f92526044c3dfc299')
  })

  it('maç yoksa parça üretmez', () => {
    expect(buildPrompts([], 'chatgpt', 'x')).toEqual([])
  })
})

describe('parçalara bölme', () => {
  const many = (n: number) =>
    collect(Array.from({ length: n }, (_, i) => makeMatch({ over25Pct: 90 }, { home: `Takım ${String(i + 1).padStart(2, '0')}`, time: '20:00' })))

  it('20 maça kadar tek parça, 21 maçta iki parça', () => {
    expect(AI_CHUNK_SIZE).toBe(20)
    // 2.5 Üst listesi en fazla 15 maç gösterdiği için 20+ maç birden çok kategoriden gelir
    const items = [...many(15), ...collect(Array.from({ length: 15 }, (_, i) => makeMatch({ bttsPct: 95 }, { home: `KG ${i}` })))]
    expect(buildPrompts(items.slice(0, 20), 'chatgpt', 'x')).toHaveLength(1)
    const chunks = buildPrompts(items.slice(0, 21), 'chatgpt', 'x')
    expect(chunks.map((c) => [c.index, c.total, c.from, c.to])).toEqual([
      [1, 2, 1, 20],
      [2, 2, 21, 21],
    ])
  })

  it('numaralar parçalar arasında devam eder ve her parça kendi başına tamdır', () => {
    const chunks = buildPrompts(many(15), 'gemini', 'x', 6)
    expect(chunks.map((c) => [c.from, c.to])).toEqual([[1, 6], [7, 12], [13, 15]])
    const numbers = chunks.flatMap((c) => [...c.text.matchAll(/^#(\d+) \|/gm)].map((m) => Number(m[1])))
    expect(numbers).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
    for (const c of chunks) {
      expect(c.text).toContain('KURALLAR')
      expect(c.text).toContain('#numara | KATEGORİ: KARAR ; KATEGORİ: KARAR | gerekçe | risk | SKOR: ev-deplasman')
      expect(c.text).toContain(DATA_START)
      expect(c.text).toContain('Gemini için yönerge')
      expect(c.text).toContain(`${c.total} parçalı listenin ${c.index}. parçasıdır (#${c.from}–#${c.to})`)
    }
    expect(chunks[1].text).not.toContain('#6 |')
    expect(chunks[1].text).not.toContain('#13 |')
  })
})

describe('cevabı çözme (kategori bazlı)', () => {
  const numbers = numberMap(['mA', 'mB', 'mC', 'mD'])
  // #1: üç kategori, #2: iki kategori, #3: tek kategori, #4: dört kategori
  const asked = askedMap([['over25', 'ht05', 'btts'], ['over25', 'btts'], ['ht05'], ['over25', 'ht05', 'btts', 'over25btts']])
  const parse = (text: string) => parseAiResponse(text, numbers, asked)
  const line = (text: string) => parseLine(text, numbers, asked)
  const verdictOf = (text: string) => {
    const result = line(text)
    if (result.kind !== 'verdict') throw new Error(`karar değil: ${JSON.stringify(result)}`)
    return result.verdict
  }

  it('kullanıcının örnek satırı: her kategoriye ayrı karar, gerekçe, risk ve skor', () => {
    const v = verdictOf("#1 | 2.5 ÜST: Orta ; KG VAR: Orta ; İLK YARI 0.5 ÜST: Zayıf | İki takımın xG'si yüksek, model 2.5 Üst'ü destekliyor (QSL). | Küçük örneklem | SKOR: 2-2")
    expect(v).toEqual({
      number: 1,
      matchId: 'mA',
      decisions: { over25: 'medium', btts: 'medium', ht05: 'weak' },
      asked: ['over25', 'ht05', 'btts'],
      unanswered: [],
      warnings: [],
      reason: "İki takımın xG'si yüksek, model 2.5 Üst'ü destekliyor (QSL).",
      risk: 'Küçük örneklem',
      score: { home: 2, away: 2 },
    })
  })

  it('eşleştirme yalnızca numarayladır; satır sırası ve kategori sırası önemli değildir', () => {
    const r = parse(['#2 | KG VAR: Eleme ; 2.5 ÜST: Güçlü | Gerekçe. | Risk', '#1 | İLK YARI 0.5 ÜST: Orta ; 2.5 ÜST: Orta ; KG VAR: Orta | Gerekçe. | Risk'].join('\n'))
    expect(r.errors).toEqual([])
    expect(r.verdicts.map((v) => [v.matchId, v.decisions])).toEqual([
      ['mB', { btts: 'reject', over25: 'strong' }],
      ['mA', { ht05: 'medium', over25: 'medium', btts: 'medium' }],
    ])
    expect(r.missing).toEqual([3, 4])
  })

  it('büyük/küçük harf ve Türkçe karakter farklarını hoş görür (ÜST/UST, İ/I, 2,5/2.5, & / ve)', () => {
    const variants = [
      '2.5 ÜST: Orta ; İLK YARI 0.5 ÜST: Orta ; KG VAR: Orta ; 2.5 ÜST & KG VAR: Orta',
      '2.5 UST: orta ; ILK YARI 0.5 UST: ORTA ; kg var: Orta ; 2.5 UST & KG VAR: orta',
      '2,5 üst: Orta ; ilk yarı 0,5 üst: Orta ; Kg Var: Orta ; 2,5 Üst ve KG Var: Orta',
      '2.5ÜST:Orta;İLK  YARI 0.5 ÜST :Orta;KG VAR : Orta;2.5 ÜST&KG VAR:Orta',
      '**2.5 Üst**: **Orta** ; İY 0.5 Üst: Orta ; KG Var: Orta ; 2.5 Üst & KG Var: Orta',
    ]
    for (const decisions of variants) {
      const v = verdictOf(`#4 | ${decisions} | Gerekçe. | Risk`)
      expect(v.decisions, decisions).toEqual({ over25: 'medium', ht05: 'medium', btts: 'medium', over25btts: 'medium' })
      expect(v.warnings, decisions).toEqual([])
    }
    // Madde imi, tablo kenarı ve numara yazımları
    expect(verdictOf('- | 3. | ilk yari 0.5 ust: güçlü | Gerekçe. | Risk |').decisions).toEqual({ ht05: 'strong' })
  })

  it('"2.5 ÜST & KG VAR" tek kategoridir; "2.5 ÜST ; KG VAR" iki ayrı kategoridir', () => {
    expect(verdictOf('#4 | 2.5 ÜST & KG VAR: Güçlü | Gerekçe. | Risk').decisions).toEqual({ over25btts: 'strong' })
    expect(verdictOf('#4 | 2.5 ÜST: Güçlü ; KG VAR: Zayıf | Gerekçe. | Risk').decisions).toEqual({ over25: 'strong', btts: 'weak' })
  })

  it('cevapta olmayan kategori: o yapay zekâ o kategoride cevapsız sayılır', () => {
    const v = verdictOf('#1 | 2.5 ÜST: Orta | Gerekçe. | Risk')
    expect(v.decisions).toEqual({ over25: 'medium' })
    expect(v.unanswered).toEqual(['ht05', 'btts'])
    expect(v.warnings).toEqual([])
  })

  it('sorulmayan kategoriye yazılan karar yok sayılır ve uyarı üretir', () => {
    const v = verdictOf('#3 | İLK YARI 0.5 ÜST: Orta ; KG VAR: Güçlü | Gerekçe. | Risk')
    expect(v.decisions).toEqual({ ht05: 'medium' })
    expect(v.unanswered).toEqual([])
    expect(v.warnings).toEqual(['#3: KG VAR bu maç için sorulmadı; karar yok sayıldı.'])
  })

  it('okunamayan parça maç ve metinle bildirilir; satırın geri kalanı kaydedilir', () => {
    const v = verdictOf('#1 | 2.5 ÜST: Orta ; KORNER 8.5 ÜST: Güçlü ; KG VAR: Belki ; İLK YARI Orta | Gerekçe. | Risk')
    expect(v.decisions).toEqual({ over25: 'medium' })
    expect(v.unanswered).toEqual(['ht05', 'btts'])
    expect(v.warnings).toEqual([
      '#1: “KORNER 8.5 ÜST: Güçlü” okunamadı (kategori adı tanınmadı); bu parça kaydedilmedi.',
      '#1 KG VAR: KARAR tanınmadı (“Belki”); bu kategori cevapsız sayıldı. Beklenen: Güçlü, Orta, Zayıf, Eleme.',
      '#1: “İLK YARI Orta” okunamadı (kategori adı tanınmadı); bu parça kaydedilmedi.',
    ])
    // Aynı kategori iki kez: ilki kullanılır.
    const twice = verdictOf('#1 | 2.5 ÜST: Orta ; 2.5 ÜST: Güçlü | Gerekçe. | Risk')
    expect(twice.decisions).toEqual({ over25: 'medium' })
    expect(twice.warnings).toEqual(['#1: 2.5 ÜST satırda iki kez geçiyor; ilki kullanıldı.'])
  })

  it('eski biçimli cevap (maç başına tek karar) reddedilir', () => {
    for (const old of ['#1 | Orta | Ev sahibi gollü (kaynak). | Rotasyon | SKOR: 2-1', '#2 | ELEME | Kadro belirsiz. | Sakatlık', '| 3 | **güçlü** | Gerekçe | Risk |']) {
      const result = line(old)
      expect(result, old).toEqual({ kind: 'error', message: OLD_FORMAT_MESSAGE })
    }
    expect(OLD_FORMAT_MESSAGE).toContain('Eski biçim; promptu yeniden kopyalayın.')
    const r = parse('#1 | Orta | Gerekçe. | Risk\n#2 | 2.5 ÜST: Orta ; KG VAR: Orta | Gerekçe. | Risk')
    expect(r.verdicts.map((v) => v.number)).toEqual([2])
    expect(r.errors).toEqual([{ line: 1, text: '#1 | Orta | Gerekçe. | Risk', message: OLD_FORMAT_MESSAGE }])
  })

  it('hatalı satırlar hangi maçın ve neyin okunamadığını söyler; geçerli satırlar yine de çözülür', () => {
    const r = parse(
      [
        'İşte değerlendirmem:',
        '#1 | 2.5 ÜST: Orta ; İLK YARI 0.5 ÜST: Orta ; KG VAR: Orta | Gerekçe. | Risk',
        '#2 | 2.5 ÜST: Belki ; KG VAR: Olabilir | Gerekçe. | Risk',
        '#3 | İLK YARI 0.5 ÜST: Orta |  | Risk',
        '#9 | 2.5 ÜST: Orta | Gerekçe. | Risk',
        '#4 | 2.5 ÜST: Orta',
        '#1 | 2.5 ÜST: Zayıf | Gerekçe. | Risk',
        '|---|---|---|',
        '#numara | KATEGORİ: KARAR | gerekçe | risk',
      ].join('\n'),
    )
    expect(r.verdicts.map((v) => v.number)).toEqual([1])
    expect(r.ignored).toBe(3)
    expect(r.errors.map((e) => [e.line, e.message])).toEqual([
      [3, expect.stringContaining('#2: hiçbir kategori kararı okunamadı. Beklenen: 2.5 ÜST: KARAR ; KG VAR: KARAR.')],
      [4, 'Gerekçe boş.'],
      [5, '#9 numaralı bir maç listede yok.'],
      [6, expect.stringContaining('4 alan bekleniyor')],
      [7, '#1 cevapta birden fazla kez geçiyor.'],
    ])
    expect(r.errors[0].message).toContain('#2 2.5 ÜST: KARAR tanınmadı (“Belki”)')
    expect(r.missing).toEqual([2, 3, 4])
  })

  it('gerekçede fazladan | geçerse bozulmaz; skor isteğe bağlıdır', () => {
    const v = verdictOf('#2 | 2.5 ÜST: Orta ; KG VAR: Zayıf | Ev sahibi 3|2 formda | deplasman eksik. | Rotasyon')
    expect(v.reason).toBe('Ev sahibi 3 | 2 formda | deplasman eksik.')
    expect(v.risk).toBe('Rotasyon')
    expect(v.score).toBeUndefined()
    expect(verdictOf('#2 | 2.5 ÜST: Orta | Gerekçe. | Risk | Skor tahmini 1:0').score).toEqual({ home: 1, away: 0 })
    expect(verdictOf('#2 | 2.5 ÜST: Orta | Gerekçe. | Risk | SKOR: yok')).toMatchObject({ risk: 'Risk' })
  })

  it('elle düzeltilen satır tek başına yeniden çözülebilir', () => {
    expect(line('#3 | İY 0.5 ÜST: Güçlü | Düzeltilmiş gerekçe. | Risk').kind).toBe('verdict')
    expect(line('Açıklama cümlesi.').kind).toBe('ignored')
  })

  it('boş metin hata üretmez; tüm maçlar eksik görünür', () => {
    expect(parse('  \n\n')).toEqual({ verdicts: [], errors: [], ignored: 0, missing: [1, 2, 3, 4] })
  })
})

describe('yapay zekâ istatistikleri: kategori bazlı ve eski kararlar ayrı ölçülür', () => {
  let n = 0
  const pick = (matchId: string, categoryId: Pick['categoryId'], outcome: Pick['outcome']): Pick => ({ id: `p${++n}`, matchId, categoryId, date: '2026-10-05', percent: 80, threshold: 75, outcome, frozenAt: 'x' })
  const base = (matchId: string, provider: AiVerdict['provider']) => ({ id: `${matchId}|${provider}`, matchId, date: '2026-10-05', provider, reason: 'r', risk: 'k', savedAt: 'x' })
  const fresh = (matchId: string, provider: AiVerdict['provider'], byCategory: AiVerdict['byCategory']): AiVerdict => ({ ...base(matchId, provider), byCategory, asked: Object.keys(byCategory!) as AiVerdict['asked'] })
  const legacy = (matchId: string, provider: AiVerdict['provider'], decision: NonNullable<AiVerdict['decision']>): AiVerdict => ({ ...base(matchId, provider), decision })
  const row = (t: { won: number; lost: number; rate: number | null; decided: number }) => [t.won, t.lost, t.rate, t.decided]

  // A (yeni): 2.5 ÜST 3/3 Güçlü -> tuttu · KG VAR 2 Orta + 1 Zayıf -> tutmadı · 2. yarı önerisi (karar yok) -> tuttu
  // B (yeni): 2.5 ÜST üç farklı karar -> tuttu · İY 0.5 ÜST yalnızca ChatGPT Eleme -> tutmadı
  // L (eski): maç geneli ChatGPT Güçlü, Gemini Güçlü -> 2.5 ÜST tuttu, korner tutmadı
  const picks = [
    pick('A', 'over25', 'won'), pick('A', 'btts', 'lost'), pick('A', 'sh05', 'won'),
    pick('B', 'over25', 'won'), pick('B', 'ht05', 'lost'),
    pick('L', 'over25', 'won'), pick('L', 'corners85', 'lost'),
  ]
  const verdicts = [
    fresh('A', 'chatgpt', { over25: 'strong', btts: 'medium' }), fresh('A', 'gemini', { over25: 'strong', btts: 'medium' }), fresh('A', 'claude', { over25: 'strong', btts: 'weak' }),
    fresh('B', 'chatgpt', { over25: 'strong', ht05: 'reject' }), fresh('B', 'gemini', { over25: 'medium' }), fresh('B', 'claude', { over25: 'weak' }),
    legacy('L', 'chatgpt', 'strong'), legacy('L', 'gemini', 'strong'),
  ]
  const category = buildCategoryAiStats(picks, verdicts)!
  const old = buildLegacyAiStats(picks, verdicts)!
  const level = (stats: typeof category, d: string) => stats.byDecision.find((b) => b.decision === d)!.tallies

  it('kategori bazlı: karar yalnızca kendi kategorisindeki öneriyle ölçülür', () => {
    expect(AI_SOURCES).toEqual(['chatgpt', 'gemini', 'claude', 'majority'])
    // (maç, kategori) çifti sayıları
    expect(category.units).toEqual({ chatgpt: 4, gemini: 3, claude: 3, majority: 2 })
    // ChatGPT onayı: A 2.5 ÜST (tuttu), A KG VAR (tutmadı), B 2.5 ÜST (tuttu). A'nın 2. yarı önerisi girmez.
    expect(row(category.approved.chatgpt)).toEqual([2, 1, 66.7, 3])
    expect(row(category.approved.gemini)).toEqual([2, 1, 66.7, 3])
    // Claude: A 2.5 ÜST Güçlü (tuttu); A KG VAR Zayıf ve B 2.5 ÜST Zayıf onay değil
    expect(row(category.approved.claude)).toEqual([1, 0, 100, 1])
    expect(row(level(category, 'weak').claude)).toEqual([1, 1, 50, 2])
    expect(row(level(category, 'reject').chatgpt)).toEqual([0, 1, 0, 1])
    expect(Math.max(...Object.values(category.approved).map((t) => t.total))).toBeLessThanOrEqual(3)
  })

  it('kategori bazlı çoğunluk: her kategori ayrı (3/3 Güçlü, 2/3 Orta); üç farklı karar ve tek karar çoğunluk değildir', () => {
    expect(row(level(category, 'strong').majority)).toEqual([1, 0, 100, 1]) // A 2.5 ÜST
    expect(row(level(category, 'medium').majority)).toEqual([0, 1, 0, 1]) // A KG VAR
    expect(row(category.approved.majority)).toEqual([1, 1, 50, 2])
    expect(row(level(category, 'reject').majority)).toEqual([0, 0, null, 0])
  })

  it('eski maç geneli kararlar ayrı dökümde: maçın bütün önerileri sayılır, kategori kararları girmez', () => {
    expect(old.units).toEqual({ chatgpt: 1, gemini: 1, claude: 0, majority: 1 })
    expect(row(old.approved.chatgpt)).toEqual([1, 1, 50, 2]) // L: 2.5 ÜST tuttu + korner tutmadı
    expect(row(old.approved.majority)).toEqual([1, 1, 50, 2])
    expect(row(old.approved.claude)).toEqual([0, 0, null, 0])
  })

  it('iki döküm birbirine karışmaz', () => {
    expect(buildCategoryAiStats(picks, verdicts.filter((v) => v.matchId === 'L'))).toBeNull()
    expect(buildLegacyAiStats(picks, verdicts.filter((v) => v.matchId !== 'L'))).toBeNull()
    expect(buildCategoryAiStats(picks, verdicts.filter((v) => v.matchId !== 'L'))).toEqual(category)
    expect(buildLegacyAiStats(picks, verdicts.filter((v) => v.matchId === 'L'))).toEqual(old)
    expect(buildCategoryAiStats(picks, [])).toBeNull()
    expect(buildLegacyAiStats(picks, [])).toBeNull()
  })

  it('yeni cevapta saklanan eski karar eski dökümde kalır; kategori dökümüne girmez', () => {
    const both: AiVerdict = { ...fresh('L', 'chatgpt', { over25: 'weak' }), decision: 'strong' }
    const mixed = [both, legacy('L', 'gemini', 'strong')]
    expect(row(buildLegacyAiStats(picks, mixed)!.approved.chatgpt)).toEqual([1, 1, 50, 2])
    expect(row(level(buildCategoryAiStats(picks, mixed)!, 'weak').chatgpt)).toEqual([1, 0, 100, 1])
  })
})

describe('karar özeti: ortalama değil çoğunluk', () => {
  const of = (...decisions: AiDecision[]) => summarizeVerdicts(decisions.map((decision) => ({ decision })))
  const text = (...decisions: AiDecision[]) => agreementText(of(...decisions)!)

  it('üç karar: 3/3 aynı, 2/3 çoğunluk, 3 farklı', () => {
    expect(of('medium', 'medium', 'medium')).toEqual({ kind: 'unanimous', voters: 3, votes: 3, decision: 'medium' })
    expect(of('strong', 'medium', 'medium')).toEqual({ kind: 'majority', voters: 3, votes: 2, decision: 'medium' })
    expect(of('strong', 'medium', 'weak')).toEqual({ kind: 'split', voters: 3, votes: 1, decision: null })
    expect(text('medium', 'medium', 'medium')).toBe('3/3 aynı · Orta')
    expect(text('strong', 'reject', 'strong')).toBe('2/3 çoğunluk · Güçlü')
    expect(text('strong', 'medium', 'weak')).toBe('3 farklı')
    expect(agreementLabel(of('strong', 'reject', 'strong')!)).toBe('2/3 çoğunluk')
  })

  it('seviyeler ortalanmaz: Güçlü + Zayıf + Eleme "Orta" olmaz, iki onay farklı seviyedeyse çoğunluk yoktur', () => {
    expect(majorityDecision([{ decision: 'strong' }, { decision: 'weak' }, { decision: 'reject' }])).toBeNull()
    expect(majorityDecision([{ decision: 'strong' }, { decision: 'medium' }, { decision: 'reject' }])).toBeNull()
  })

  it('sonuç karar sırasından bağımsızdır', () => {
    const orders: AiDecision[][] = [['weak', 'strong', 'weak'], ['strong', 'weak', 'weak'], ['weak', 'weak', 'strong']]
    for (const order of orders) expect(text(...order)).toBe('2/3 çoğunluk · Zayıf')
  })

  it('eski günler (iki karar): aynıysa 2/2 aynı ve çoğunluk sayılır, farklıysa çoğunluk yoktur', () => {
    expect(of('strong', 'strong')).toEqual({ kind: 'unanimous', voters: 2, votes: 2, decision: 'strong' })
    expect(text('strong', 'strong')).toBe('2/2 aynı · Güçlü')
    expect(of('strong', 'medium')).toEqual({ kind: 'split', voters: 2, votes: 1, decision: null })
    expect(text('strong', 'medium')).toBe('2 farklı')
  })

  it('tek karar ya da hiç karar: özet yok', () => {
    expect(of('strong')).toBeNull()
    expect(of()).toBeNull()
    expect(majorityDecision([])).toBeNull()
  })
})

describe('yedek uyumluluğu', () => {
  const old = { app: 'gollazim', version: 1, exportedAt: 'x', uploads: [], matches: [], results: [], picks: [], thresholds: {} }

  it('yapay zekâ alanı olmayan eski yedek geçerlidir', () => {
    expect(isBackupFile(old)).toBe(true)
  })

  it('yapay zekâ kararlarını içeren yeni yedek geçerlidir', () => {
    expect(isBackupFile({ ...old, aiVerdicts: [], aiPrompts: [] })).toBe(true)
  })

  it('bozuk yedek reddedilir', () => {
    expect(isBackupFile({ ...old, aiVerdicts: 'x' })).toBe(false)
    expect(isBackupFile({ ...old, app: 'baska' })).toBe(false)
    expect(isBackupFile({ ...old, matches: undefined })).toBe(false)
    expect(isBackupFile(null)).toBe(false)
  })
})
