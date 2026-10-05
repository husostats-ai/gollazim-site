import { describe, expect, it } from 'vitest'
import { AI_CHUNK_SIZE } from '../../config/ai'
import { defaultThresholds } from '../../config/categories'
import type { AiVerdict, Pick } from '../../types'
import { analyzeDay } from '../analysis/engine'
import { makeMatch } from '../analysis/testUtils'
import { isBackupFile } from '../data/backupFormat'
import { buildAiStats } from './aiStats'
import { collectAiMatches } from './collect'
import { numberMap, parseAiResponse, parseLine } from './parser'
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
      '#numara | KARAR | gerekçe | risk',
      'Güçlü, Orta, Zayıf, Eleme',
      'Markdown tablosu, kalın yazı',
      'en fazla iki cümle',
      '5 Ekim 2026 Pazartesi',
    ]) {
      expect(chunk.text).toContain(phrase)
    }
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
      expect(c.text).toContain('#numara | KARAR | gerekçe | risk')
      expect(c.text).toContain(DATA_START)
      expect(c.text).toContain('Gemini için yönerge')
      expect(c.text).toContain(`${c.total} parçalı listenin ${c.index}. parçasıdır (#${c.from}–#${c.to})`)
    }
    expect(chunks[1].text).not.toContain('#6 |')
    expect(chunks[1].text).not.toContain('#13 |')
  })
})

describe('cevabı çözme', () => {
  const numbers = numberMap(['mA', 'mB', 'mC', 'mD'])

  it('doğru biçimli satırları numaraya göre maça bağlar', () => {
    const r = parseAiResponse(
      [
        '#1 | Güçlü | Ev sahibi formda. Kadro tam (kaynak: BBC). | Erken kırmızı kart',
        '#2 | Orta | Deplasman rotasyona gidebilir. | Rotasyon',
        '#3 | Zayıf | Veri az, sakatlık durumu bilinmiyor. | Örneklem küçük',
        '#4 | Eleme | İki kilit oyuncu sakat. | Kadro eksik',
      ].join('\n'),
      numbers,
    )
    expect(r.errors).toEqual([])
    expect(r.missing).toEqual([])
    expect(r.verdicts.map((v) => [v.number, v.matchId, v.decision])).toEqual([
      [1, 'mA', 'strong'],
      [2, 'mB', 'medium'],
      [3, 'mC', 'weak'],
      [4, 'mD', 'reject'],
    ])
    expect(r.verdicts[0]).toMatchObject({ reason: 'Ev sahibi formda. Kadro tam (kaynak: BBC).', risk: 'Erken kırmızı kart' })
  })

  it('eşleştirme yalnızca numarayladır: satırdaki takım adı dikkate alınmaz, sıra önemli değildir', () => {
    const r = parseAiResponse('#3 | Orta | mA takımı için yazılmış gibi duran gerekçe. | yok\n#1 | Eleme | x. | y', numbers)
    expect(r.verdicts.map((v) => [v.number, v.matchId])).toEqual([
      [3, 'mC'],
      [1, 'mA'],
    ])
    expect(r.missing).toEqual([2, 4])
  })

  it('kalın yazı, madde imi, tablo çizgisi ve büyük/küçük harf farkını hoş görür', () => {
    const r = parseAiResponse(
      [
        'İşte değerlendirmem:',
        '',
        '| #numara | KARAR | gerekçe | risk |',
        '|---|---|---|---|',
        '| #1 | **GÜÇLÜ** | Gerekçe bir. | Risk bir |',
        '- #2 | orta | Gerekçe iki. | Risk iki',
        '3 | Zayif | Gerekçe üç. | Risk üç',
        '# 4 | eleme | Gerekçe dört. | Risk dört',
        'Not: bunlar olasılık değerlendirmesidir.',
      ].join('\n'),
      numbers,
    )
    expect(r.errors).toEqual([])
    expect(r.verdicts.map((v) => v.decision)).toEqual(['strong', 'medium', 'weak', 'reject'])
    expect(r.verdicts[3]).toMatchObject({ reason: 'Gerekçe dört.', risk: 'Risk dört' })
    expect(r.ignored).toBe(4)
  })

  it('gerekçede fazladan | geçerse bozulmaz: ilk alan numara, ikinci karar, sonuncu risk, arası gerekçe', () => {
    const one = parseLine('#2 | Orta | Ev sahibi formda | deplasman yorgun (kaynak: A | B). | Rotasyon', numbers)
    expect(one).toEqual({
      kind: 'verdict',
      verdict: {
        number: 2,
        matchId: 'mB',
        decision: 'medium',
        reason: 'Ev sahibi formda | deplasman yorgun (kaynak: A | B).',
        risk: 'Rotasyon',
      },
    })

    const r = parseAiResponse(
      [
        '#1 | Güçlü | Skor beklentisi 2|1 civarı. Kadro tam. | Erken kırmızı kart',
        '| #3 | **Zayıf** | a | b | c | d | Son alan risk |', // tablo satırı olarak gelse de
        '#4 | Eleme | Tek gerekçe. | Risk',
      ].join('\n'),
      numbers,
    )
    expect(r.errors).toEqual([])
    expect(r.verdicts.map((v) => [v.number, v.decision, v.reason, v.risk])).toEqual([
      [1, 'strong', 'Skor beklentisi 2 | 1 civarı. Kadro tam.', 'Erken kırmızı kart'],
      [3, 'weak', 'a | b | c | d', 'Son alan risk'],
      [4, 'reject', 'Tek gerekçe.', 'Risk'],
    ])
  })

  it('fazladan | olsa da kurallar aynı kalır: karar ikinci alanda aranır, gerekçe boş olamaz', () => {
    // Karar ikinci alanda değil: gerekçedeki "Orta" kelimesi karar sayılmaz
    expect(parseLine('#1 | Ev sahibi | Orta | iyi | risk', numbers)).toMatchObject({
      kind: 'error',
      message: 'KARAR tanınmadı: “Ev sahibi”. Beklenen: Güçlü, Orta, Zayıf, Eleme.',
    })
    // Aradaki tüm alanlar boşsa gerekçe boştur
    expect(parseLine('#1 | Orta |  |  | risk', numbers)).toEqual({ kind: 'error', message: 'Gerekçe boş.' })
    // Dört alandan azı yine eksik sayılır
    expect(parseLine('#1 | Orta | gerekçe', numbers).kind).toBe('error')
  })

  it('bozuk satırları hata listesine alır, geçerli satırları yine de çözer', () => {
    const r = parseAiResponse(
      [
        '#1 | Güçlü | Geçerli satır. | Risk',
        '#9 | Orta | Listede olmayan numara. | Risk',
        '#2 | Belki | Tanınmayan karar. | Risk',
        '#3 | Orta | Risk alanı yok',
        'Galatasaray - Fenerbahçe | Güçlü | Numara yok. | Risk',
        '#4 | Zayıf |  | Gerekçe boş',
        '#1 | Orta | Aynı numara ikinci kez. | Risk',
      ].join('\n'),
      numbers,
    )
    expect(r.verdicts.map((v) => v.number)).toEqual([1])
    expect(r.errors.map((e) => [e.line, e.message])).toEqual([
      [2, '#9 numaralı bir maç listede yok.'],
      [3, 'KARAR tanınmadı: “Belki”. Beklenen: Güçlü, Orta, Zayıf, Eleme.'],
      [4, '4 alan bekleniyor (#numara | KARAR | gerekçe | risk), 3 alan var.'],
      [5, 'Satır maç numarasıyla (#1 gibi) başlamıyor.'],
      [6, 'Gerekçe boş.'],
      [7, '#1 cevapta birden fazla kez geçiyor.'],
    ])
    expect(r.errors[1].text).toBe('#2 | Belki | Tanınmayan karar. | Risk')
    expect(r.missing).toEqual([2, 3, 4])
  })

  it('elle düzeltilen satır tek başına yeniden çözülebilir', () => {
    expect(parseLine('#2 | Belki | x. | y', numbers).kind).toBe('error')
    expect(parseLine('#2 | Orta | x. | y', numbers)).toEqual({
      kind: 'verdict',
      verdict: { number: 2, matchId: 'mB', decision: 'medium', reason: 'x.', risk: 'y' },
    })
  })

  it('boş metin hata üretmez; tüm maçlar eksik görünür', () => {
    expect(parseAiResponse('  \n\n', numbers)).toEqual({ verdicts: [], errors: [], ignored: 0, missing: [1, 2, 3, 4] })
  })
})

describe('yapay zekâ istatistikleri', () => {
  let n = 0
  const pick = (matchId: string, outcome: Pick['outcome']): Pick => ({
    id: `p${++n}`,
    matchId,
    categoryId: 'over25',
    date: '2026-10-05',
    percent: 80,
    threshold: 75,
    outcome,
    frozenAt: 'x',
  })
  const verdict = (matchId: string, provider: AiVerdict['provider'], decision: AiVerdict['decision']): AiVerdict => ({
    id: `${matchId}|${provider}`,
    matchId,
    date: '2026-10-05',
    provider,
    decision,
    reason: 'r',
    risk: 'k',
    savedAt: 'x',
  })

  // A: ikisi de Güçlü (ortak) -> 2 kazandı, 1 kaybetti
  // B: ChatGPT Orta, Gemini Zayıf -> 1 kazandı
  // C: ikisi de Eleme (ortak) -> 2 kaybetti
  // D: yalnızca Gemini Güçlü -> 1 kazandı, 1 değerlendirilemedi
  // E: ChatGPT Güçlü ama skoru girilmemiş (öneri yok)
  // F: kararı olmayan maç -> hiçbir yere girmez
  const picks = [
    pick('A', 'won'), pick('A', 'won'), pick('A', 'lost'),
    pick('B', 'won'),
    pick('C', 'lost'), pick('C', 'lost'),
    pick('D', 'won'), pick('D', 'void'),
    pick('F', 'won'), pick('F', 'won'),
  ]
  const verdicts = [
    verdict('A', 'chatgpt', 'strong'), verdict('A', 'gemini', 'strong'),
    verdict('B', 'chatgpt', 'medium'), verdict('B', 'gemini', 'weak'),
    verdict('C', 'chatgpt', 'reject'), verdict('C', 'gemini', 'reject'),
    verdict('D', 'gemini', 'strong'),
    verdict('E', 'chatgpt', 'strong'),
  ]
  const stats = buildAiStats(picks, verdicts)!
  const row = (t: { won: number; lost: number; rate: number | null; decided: number }) => [t.won, t.lost, t.rate, t.decided]

  it('onaylanan (Güçlü veya Orta) maçların başarısı, yapay zekâ bazında ve ortak kararda', () => {
    expect(row(stats.approved.chatgpt)).toEqual([3, 1, 75, 4]) // A + B
    expect(row(stats.approved.gemini)).toEqual([3, 1, 75, 4]) // A + D
    expect(row(stats.approved.consensus)).toEqual([2, 1, 66.7, 3]) // yalnızca A; C ortak ama Eleme
  })

  it('karar seviyesine göre başarı', () => {
    const level = (d: string) => stats.byDecision.find((b) => b.decision === d)!.tallies
    expect(stats.byDecision.map((b) => b.decision)).toEqual(['strong', 'medium', 'weak', 'reject'])
    expect(row(level('strong').chatgpt)).toEqual([2, 1, 66.7, 3])
    expect(row(level('strong').gemini)).toEqual([3, 1, 75, 4])
    expect(row(level('medium').chatgpt)).toEqual([1, 0, 100, 1])
    expect(row(level('medium').gemini)).toEqual([0, 0, null, 0])
    expect(row(level('weak').gemini)).toEqual([1, 0, 100, 1])
    expect(row(level('reject').chatgpt)).toEqual([0, 2, 0, 2])
    expect(row(level('reject').consensus)).toEqual([0, 2, 0, 2])
    expect(row(level('strong').consensus)).toEqual([2, 1, 66.7, 3])
  })

  it('değerlendirilemeyen öneri orana girmez ama ayrı sayılır; hepsi az veri işaretlidir', () => {
    expect(stats.byDecision[0].tallies.gemini).toMatchObject({ void: 1, total: 5, lowSample: true })
  })

  it('kararı kaydedilmiş maç sayıları; ortak karar yalnızca iki karar aynıysa', () => {
    expect(stats.matches).toEqual({ chatgpt: 4, gemini: 4, consensus: 2 })
  })

  it('kararı olmayan maçların önerileri hiçbir satıra girmez; hiç karar yoksa döküm üretilmez', () => {
    const all = Object.values(stats.approved).concat(stats.byDecision.flatMap((b) => Object.values(b.tallies)))
    expect(Math.max(...all.map((t) => t.total))).toBeLessThanOrEqual(5)
    expect(buildAiStats(picks, [])).toBeNull()
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
