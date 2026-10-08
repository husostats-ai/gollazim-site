import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { AI_CHUNK_SIZE, AI_PROVIDERS } from '../../config/ai'
import { defaultThresholds } from '../../config/categories'
import type { AiVerdict, Pick } from '../../types'
import { analyzeDay } from '../analysis/engine'
import { makeMatch } from '../analysis/testUtils'
import { isBackupFile } from '../data/backupFormat'
import { AI_SOURCES, buildAiStats, buildSummaryAiStats } from './aiStats'
import { agreementLabel, agreementText, majorityDecision, summarizeVerdicts } from './consensus'
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

  it('Claude cevabı aynı satır biçimiyle çözülür', () => {
    const numbers = numberMap(['m1', 'm2'])
    const parsed = parseAiResponse('#1 | Orta | Ev sahibi gollü (kaynak). | Rotasyon | SKOR: 2-1\n#2 | Eleme | Kadro belirsiz. | Sakatlık', numbers)
    expect(parsed.errors).toEqual([])
    expect(parsed.verdicts.map((v) => [v.matchId, v.decision, v.score])).toEqual([['m1', 'medium', { home: 2, away: 1 }], ['m2', 'reject', undefined]])
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
    expect(row(stats.approved.majority)).toEqual([2, 1, 66.7, 3]) // yalnızca A; C ortak ama Eleme
    expect(row(stats.approved.claude)).toEqual([0, 0, null, 0]) // Claude'suz günler
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
    expect(row(level('reject').majority)).toEqual([0, 2, 0, 2])
    expect(row(level('strong').majority)).toEqual([2, 1, 66.7, 3])
  })

  it('değerlendirilemeyen öneri orana girmez ama ayrı sayılır; hepsi az veri işaretlidir', () => {
    expect(stats.byDecision[0].tallies.gemini).toMatchObject({ void: 1, total: 5, lowSample: true })
  })

  it('kararı kaydedilmiş maç sayıları; Claude\'suz günlerde çoğunluk yalnızca iki karar aynıysa', () => {
    expect(stats.matches).toEqual({ chatgpt: 4, gemini: 4, claude: 0, majority: 2 })
  })

  it('Claude\'suz veride çoğunluk kararı, eski "Ortak karar" ile aynı sayıları verir', () => {
    const old = buildSummaryAiStats(picks, verdicts)!
    expect(stats.approved.majority).toEqual(old.approved.consensus)
    expect(stats.matches.majority).toBe(old.matches.consensus)
    expect(stats.byDecision.map((b) => b.tallies.majority)).toEqual(old.byDecision.map((b) => b.tallies.consensus))
    expect(stats.approved.chatgpt).toEqual(old.approved.chatgpt)
    expect(stats.approved.gemini).toEqual(old.approved.gemini)
  })

  // Claude'lu günler:
  // A: + Claude Güçlü -> 3/3 Güçlü
  // B: + Claude Orta -> 2/3 Orta (ChatGPT Orta, Gemini Zayıf)
  // C: + Claude Zayıf -> 2/3 Eleme
  // D: + Claude Orta -> Gemini Güçlü, Claude Orta: 2 farklı, çoğunluk yok
  // G: üçü de farklı -> çoğunluk yok
  const withClaude = [
    ...verdicts,
    verdict('A', 'claude', 'strong'),
    verdict('B', 'claude', 'medium'),
    verdict('C', 'claude', 'weak'),
    verdict('D', 'claude', 'medium'),
    verdict('G', 'chatgpt', 'strong'), verdict('G', 'gemini', 'medium'), verdict('G', 'claude', 'weak'),
  ]
  const three = buildAiStats([...picks, pick('G', 'won')], withClaude)!

  it('üç yapay zekâ: her biri ayrı, çoğunluk kararı ayrıca ölçülür', () => {
    expect(AI_SOURCES).toEqual(['chatgpt', 'gemini', 'claude', 'majority'])
    expect(three.matches).toEqual({ chatgpt: 5, gemini: 5, claude: 5, majority: 3 })
    expect(row(three.approved.claude)).toEqual([4, 1, 80, 5]) // A (2-1) + B (1-0) + D (1-0); G'de Zayıf
    expect(row(three.approved.majority)).toEqual([3, 1, 75, 4]) // A Güçlü + B Orta
    const level = (d: string) => three.byDecision.find((b) => b.decision === d)!.tallies
    expect(row(level('strong').majority)).toEqual([2, 1, 66.7, 3]) // A
    expect(row(level('medium').majority)).toEqual([1, 0, 100, 1]) // B
    expect(row(level('reject').majority)).toEqual([0, 2, 0, 2]) // C
    expect(row(level('weak').majority)).toEqual([0, 0, null, 0])
  })

  it('özetin dökümü Claude kararlarını görmez; yalnızca Claude kararı varsa döküm yoktur', () => {
    expect(buildSummaryAiStats(picks, withClaude.filter((v) => v.matchId !== 'G'))).toEqual(buildSummaryAiStats(picks, verdicts))
    expect(buildSummaryAiStats(picks, [verdict('A', 'claude', 'strong')])).toBeNull()
    expect(buildAiStats(picks, [verdict('A', 'claude', 'strong')])!.matches).toEqual({ chatgpt: 0, gemini: 0, claude: 1, majority: 0 })
  })

  it('kararı olmayan maçların önerileri hiçbir satıra girmez; hiç karar yoksa döküm üretilmez', () => {
    const all = Object.values(stats.approved).concat(stats.byDecision.flatMap((b) => Object.values(b.tallies)))
    expect(Math.max(...all.map((t) => t.total))).toBeLessThanOrEqual(5)
    expect(buildAiStats(picks, [])).toBeNull()
  })
})

describe('karar özeti: ortalama değil çoğunluk', () => {
  const of = (...decisions: AiVerdict['decision'][]) => summarizeVerdicts(decisions.map((decision) => ({ decision })))
  const text = (...decisions: AiVerdict['decision'][]) => agreementText(of(...decisions)!)

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
    const orders: AiVerdict['decision'][][] = [['weak', 'strong', 'weak'], ['strong', 'weak', 'weak'], ['weak', 'weak', 'strong']]
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
