import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compareAnswers, matchTitle, warningsText, type MatchComparison, type TeamComparison } from './compare'
import { cleanText, extractUrl, parseAnswer, parseDate, parseScore } from './parser'
import { checkTotal, computeRates, leagueRows, venueRates, type Rate } from './rates'
import { sameOpponent, sameTeam, teamDistance } from './teams'

// Ham veri karşılaştırma: ayrıştırıcı, oran hesabı ve iki cevabın karşılaştırması.
// Buradaki iki cevap SENTETİKTİR (uydurma takımlar); yalnızca biçimi ve kuralları sınar.
// Gerçek örnek cevaplar samples/ham-veri/ altındaysa (repoya girmez) en alttaki testler de çalışır.

const A = `
Bazı açıklama cümlesi.
#1 | SON | Kuzey Yıldızı | 03.10.2026 | Güney Spor | İÇ | 2-1 | İY 1-0 | LİG | [Sofascore](https://www.sofascore.com/x)
#1 | SON | Kuzey Yıldızı | 27.09.2026 | Doğu Gençlik | DIŞ | 1-1 | 0-0 | LİG | Sofascore
#1 | SON | Kuzey Yıldızı | 20.09.2026 | Batı Akademi | İÇ | 3-0 | ? | LİG | Sofascore
#1 | SON | Kuzey Yıldızı | 16.09.2026 | Liman İdman | İÇ | 5-4 | İY 2-2 | KUPA | Sofascore
#1 | SON | Kuzey Yıldızı | 13.09.2026 | Ova Belediye | bilinmiyor | 0-2 | İY 0-1 | LİG | Sofascore
#1 | TOPLAM | Kuzey Yıldızı | oynanan 4 | 2-1-1 | 6-4 | 7 puan | lig sırası 3 | Sofascore
#1 | SON | Al Okhdoud | 02.10.2026 | Vadi Demir | DIŞ | 0-0 | İY 0-0 | LİG | Flashscore
#1 | SON | Al Okhdoud | 26.09.2026 | Al Tai | DIŞ | 2-3 | İY 1-1 | LİG | Flashscore
#1 | SON | Al Okhdoud | 19.09.2026 | Yayla Genç | İÇ | 1-0 | İY 0-0 | LİG | Flashscore
#1 | TOPLAM | Al Okhdoud | oynanan 3 | 1-1-1 | 3-3 | 5 puan | lig sırası 9 | Flashscore | UYUŞMUYOR
#1 | H2H | 11.04.2026 | Kuzey Yıldızı - Al Okhdoud | 2-0 | İY 1-0 | LİG | Sofascore
#1 | H2H | 02.11.2025 | Al Okhdoud - Kuzey Yıldızı | 1-1 | ? | LİG | Sofascore
#1 | SKOR | Tahmin 2-1
#1 | HABER | Kuzey Yıldızı'nda iki eksik var | Sofascore
#1 | BİLİNMEYEN | bir şey
#2 | H2H | bilinmiyor

=== KAYNAKLAR ===
Sofascore | [https://www.sofascore.com/x](https://www.sofascore.com/x) | maç listesi
Flashscore | https://www.flashscore.com/y | [puan durumu]
`

const B = [
  '- #1 | SON | Kuzey Yıldızı FC |  3.10.2026 | Guney Spor | İÇ |  2 - 1 | 1-0 | LİG | Soccerway',
  '- #1 | SON | Kuzey Yıldızı FC | 27.09.2026 | Doğu Gençlik | DIŞ | 2-1 | 1-0 | LİG | Soccerway',
  '- #1 | SON | Kuzey Yıldızı FC | 20.09.2026 | Batı Akademi | İÇ | 3-0 | İY 2-0 | LİG | Soccerway',
  '- #1 | SON | Kuzey Yıldızı FC | 13.09.2026 | Ova Belediye | DIŞ | 0-2 | İY 0-2 | LİG | Soccerway',
  '- #1 | TOPLAM | Kuzey Yıldızı FC | oynanan 4 | 2-1-1 | 6-4 | 7 puan | lig sırası 4 | Soccerway',
  '- #1 | SON | Al Akhdoud | 02.10.2026 | Vadi Demir | DIŞ | 0-0 | İY 0-0 | LİG | Soccerway',
  '- #1 | SON | Al Akhdoud | 26.09.2026 | Al Taee | DIŞ | 2-3 | İY 1-1 | LİG | Soccerway',
  '- #1 | SON | Al Akhdoud | 19.09.2026 | Yayla Genç | İÇ | 1-0 | İY 0-0 | LİG | Soccerway',
  '- #1 | TOPLAM | Al Akhdoud | oynanan 3 | 1-1-1 | 3-3 | 4 puan | lig sırası 9 | Soccerway',
  '- #1 | H2H | 11.04.2026 | Kuzey Yıldızı - Al Akhdoud | 2-0 | İY 1-0 | LİG | Soccerway',
  '- #1 | H2H | bilinmiyor',
].join('\r\n')

const rate = (r: Rate) => `${r.hit}/${r.n}`
const four = (r: { over25: Rate; btts: Rate; over25btts: Rate; ht05: Rate }) => [r.over25, r.btts, r.over25btts, r.ht05].map(rate)
const labels = { A: 'AI A', B: 'AI B' }

describe('ayrıştırıcı', () => {
  const a = parseAnswer(A)
  const b = parseAnswer(B)

  it('alan yardımcıları: tarih, skor, markdown bağlantısı', () => {
    expect(parseDate('03.10.2026')).toBe('2026-10-03')
    expect(parseDate(' 3/1/2026 ')).toBe('2026-01-03')
    expect(parseDate('bilinmiyor')).toBeNull()
    expect(parseDate('32.13.2026')).toBeNull()
    expect(parseScore('2-1')).toEqual({ own: 2, opp: 1 })
    expect(parseScore('İY 1 – 0')).toEqual({ own: 1, opp: 0 })
    expect(parseScore('(IY 0:0)')).toEqual({ own: 0, opp: 0 })
    for (const unknown of ['?', '', 'bilinmiyor', 'ertelendi']) expect(parseScore(unknown)).toBeNull()
    expect(cleanText('[Sofascore](https://www.sofascore.com/x)')).toBe('Sofascore')
    expect(cleanText('[https://a.b/c](https://a.b/c)')).toBe('https://a.b/c')
    expect(cleanText('  [puan   durumu] ')).toBe('puan durumu')
    expect(extractUrl('[x](https://a.b/c).')).toBe('https://a.b/c')
  })

  it('SON satırı: takım, tarih, rakip, iç / dış, skorlar, yarışma ve kaynak', () => {
    expect(a.last).toHaveLength(8)
    expect(a.last[0]).toMatchObject({ no: 1, team: 'Kuzey Yıldızı', date: '2026-10-03', opponent: 'Güney Spor', venue: 'home', ft: { own: 2, opp: 1 }, ht: { own: 1, opp: 0 }, competition: 'league', source: 'Sofascore' })
    expect(a.last[2]).toMatchObject({ ht: null, ft: { own: 3, opp: 0 } })
    expect(a.last[3]).toMatchObject({ competition: 'cup', competitionText: 'KUPA' })
    expect(a.last[4]).toMatchObject({ venue: null })
    // Liste imi, fazla boşluk, "İY " öneksiz devre skoru, \r\n satır sonu
    expect(b.last[0]).toMatchObject({ team: 'Kuzey Yıldızı FC', date: '2026-10-03', ft: { own: 2, opp: 1 }, ht: { own: 1, opp: 0 }, venue: 'home' })
    expect(b.last).toHaveLength(7)
  })

  it('TOPLAM satırı ve sonundaki not', () => {
    expect(a.totals[0]).toMatchObject({ team: 'Kuzey Yıldızı', played: 4, won: 2, drawn: 1, lost: 1, goalsFor: 6, goalsAgainst: 4, points: 7, rank: 3, source: 'Sofascore', flag: null })
    expect(a.totals[1]).toMatchObject({ team: 'Al Okhdoud', points: 5, flag: 'UYUŞMUYOR' })
    expect(parseAnswer('#1 | TOPLAM | X | oynanan bilinmiyor | bilinmiyor | ? | bilinmiyor | lig sırası bilinmiyor | k').totals[0]).toMatchObject({ played: null, won: null, goalsFor: null, points: null, rank: null })
  })

  it('H2H satırı ve "bilinmiyor"', () => {
    expect(a.h2h).toHaveLength(3)
    expect(a.h2h[0]).toMatchObject({ unknown: false, date: '2026-04-11', home: 'Kuzey Yıldızı', away: 'Al Okhdoud', ft: { own: 2, opp: 0 }, ht: { own: 1, opp: 0 }, competitionText: 'LİG' })
    expect(a.h2h[1]).toMatchObject({ ht: null })
    expect(a.h2h[2]).toMatchObject({ no: 2, unknown: true })
  })

  it('SKOR ve HABER olduğu gibi; KAYNAKLAR bloğu temizlenmiş', () => {
    expect(a.notes).toEqual([
      { no: 1, kind: 'SKOR', text: 'Tahmin 2-1' },
      { no: 1, kind: 'HABER', text: "Kuzey Yıldızı'nda iki eksik var | Sofascore" },
    ])
    expect(a.sources).toEqual([
      { site: 'Sofascore', url: 'https://www.sofascore.com/x', note: 'maç listesi' },
      { site: 'Flashscore', url: 'https://www.flashscore.com/y', note: 'puan durumu' },
    ])
  })

  it('anlaşılmayan satır atılmaz, nedeniyle listelenir', () => {
    expect(a.unparsed.map((u) => [u.line, u.text])).toEqual([
      [2, 'Bazı açıklama cümlesi.'],
      [17, '#1 | BİLİNMEYEN | bir şey'],
    ])
    expect(parseAnswer('#3 | SON | X | 01.01.2026 | Y').unparsed[0].reason).toContain('5 alan')
    expect(b.unparsed).toEqual([])
  })
})

describe('takım adı eşleştirme', () => {
  it('küçük yazım farkları eşleşir', () => {
    for (const [x, y] of [
      ['Al Akhdoud', 'Al Okhdoud'],
      ['Al Tai', 'Al Taee'],
      ['Al Shahania', 'Al Shahaniya'],
      ['Kuzey Yıldızı', 'Kuzey Yildizi FC'],
    ])
      expect(sameTeam(x, y), `${x} / ${y}`).toBe(true)
    expect(teamDistance('Al Wakrah', 'al-wakrah sc')).toBe(0)
  })

  it('farklı takımlar eşleşmez', () => {
    for (const [x, y] of [
      ['Al Ahli', 'Al Hilal'],
      ['Al Ittihad', 'Al Ittifaq'],
      ['Al Duhail', 'Al Gharafa'],
      ['Al Shamal', 'Al Shahania'],
      ['Al Tai', 'Al Taawoun'],
      ['Kuzey Yıldızı', 'Kuzey Yıldızı U21'],
    ])
      expect(sameTeam(x, y), `${x} / ${y}`).toBe(false)
  })
})

describe('rakip adı karşılaştırması', () => {
  it('adlardan biri ötekinin başıysa aynı sayılır; farklı adlar sayılmaz', () => {
    expect(sameOpponent('Lusail City', 'Lusail')).toBe(true)
    expect(sameOpponent('Lusail SC', 'Lusail City')).toBe(true)
    expect(sameOpponent('Al-Sadd', 'Al Sadd')).toBe(true)
    expect(sameOpponent('Al Sadd', 'Al Sailiya')).toBe(false)
    expect(sameOpponent('Lusail City', 'Doha City')).toBe(false)
  })
})

describe('oran hesabı', () => {
  const rows = parseAnswer(A).last.filter((row) => row.team === 'Kuzey Yıldızı')

  it('yalnızca LİG satırları; devre skoru bilinmeyen satır İY paydasına girmez', () => {
    const rates = computeRates(leagueRows(rows))
    // Lig: 2-1, 1-1, 3-0, 0-2 (kupadaki 5-4 sayılmaz)
    expect(four(rates)).toEqual(['2/4', '2/4', '1/4', '2/3'])
    expect(rates).toMatchObject({ matches: 4, htKnown: 3, noScore: 0 })
  })

  it('iç / dış: yalnızca o taraftaki lig maçları; bilinmeyenler dışarıda ve sayılı', () => {
    const home = venueRates(rows, 'home')
    expect(four(home.rates)).toEqual(['2/2', '1/2', '1/2', '1/1'])
    expect(home.unknownVenue).toBe(1)
    expect(four(venueRates(rows, 'away').rates)).toEqual(['0/1', '1/1', '0/1', '0/1'])
  })

  it('TOPLAM denetimi: tutan, tutmayan, 8 maçtan çok, bilinmeyen', () => {
    const answer = parseAnswer(A)
    expect(checkTotal(answer.totals[0], rows)).toMatchObject({ status: 'ok', computed: { played: 4, won: 2, drawn: 1, lost: 1, goalsFor: 6, goalsAgainst: 4, points: 7 }, differences: [] })
    const okhdoud = answer.last.filter((row) => row.team === 'Al Okhdoud')
    expect(checkTotal(answer.totals[1], okhdoud)).toMatchObject({ status: 'mismatch', differences: ['puan: TOPLAM 5, satırlardan 4'] })
    expect(checkTotal({ ...answer.totals[0], played: 9 }, rows).status).toBe('too-many')
    expect(checkTotal({ ...answer.totals[0], played: null }, rows).status).toBe('unknown')
    expect(checkTotal({ ...answer.totals[0], played: 5 }, rows).differences).toEqual(['oynanan: TOPLAM 5, satırlardan 4'])
  })
})

describe('iki cevabın karşılaştırması', () => {
  const run = (fixtures = [{ id: 'm1', home: 'Kuzey Yıldızı', away: 'Al-Okhdoud' }]) => compareAnswers({ a: parseAnswer(A), b: parseAnswer(B), labels, fixtures })
  const [match, second] = run()
  const texts = (level: string) => match.warnings.filter((w) => w.level === level).map((w) => w.text)
  const team = (m: MatchComparison, name: string): TeamComparison => m.teams.find((t) => sameTeam(t.name, name))!

  it('maçlar ve takımlar ad farkına rağmen eşlenir; ev / deplasman CSV maçından', () => {
    expect(matchTitle(match)).toBe('#1 Kuzey Yıldızı – Al Okhdoud')
    expect(match).toMatchObject({ noA: 1, noB: 1, sideSource: 'csv', fixtureId: 'm1' })
    expect(match.teams.map((t) => [t.side, t.a?.name, t.b?.name])).toEqual([
      ['home', 'Kuzey Yıldızı', 'Kuzey Yıldızı FC'],
      ['away', 'Al Okhdoud', 'Al Akhdoud'],
    ])
    expect(matchTitle(second)).toBe('#2 takım okunamadı')
  })

  it('CSV maçı yoksa yazılış sırası varsayılır ve belirtilir; ters CSV maçı tarafları çevirir', () => {
    const [byOrder] = run([])
    expect(byOrder).toMatchObject({ sideSource: 'order', fixtureId: null })
    expect(byOrder.warnings.some((w) => w.level === 'info' && w.text.includes('yazılış sırasından varsayıldı'))).toBe(true)
    expect(run([{ id: 'm2', home: 'Al Okhdoud', away: 'Kuzey Yıldızı' }])[0].teams.map((t) => t.side)).toEqual(['away', 'home'])
  })

  it('kırmızı: maç sonu skoru farklı; TOPLAM satırlarla tutmuyor', () => {
    expect([...texts('red')].sort()).toEqual([
      'AI A · Al Okhdoud: TOPLAM, LİG satırlarıyla tutmuyor (puan: TOPLAM 5, satırlardan 4)',
      // B'de 27.09 skoru 2-1 yazılmış: satırlardan 3 galibiyet, 7-4 ve 9 puan çıkar.
      'AI B · Kuzey Yıldızı FC: TOPLAM, LİG satırlarıyla tutmuyor (galibiyet: TOPLAM 2, satırlardan 3; beraberlik: TOPLAM 1, satırlardan 0; atılan: TOPLAM 6, satırlardan 7; puan: TOPLAM 7, satırlardan 9)',
      'Kuzey Yıldızı 27.09.2026 (Doğu Gençlik): maç sonu skoru farklı; AI A 1-1, AI B 2-1',
    ])
  })

  it('sarı: devre skoru, iç / dış, TOPLAM alanı farkı ve yapay zekânın kendi notu', () => {
    expect(texts('yellow')).toEqual(
      expect.arrayContaining([
        'Kuzey Yıldızı 13.09.2026 (Ova Belediye): devre skoru farklı; AI A 0-1, AI B 0-2',
        'Kuzey Yıldızı 13.09.2026 (Ova Belediye): İÇ / DIŞ farklı; AI A bilinmiyor, AI B DIŞ',
        'Kuzey Yıldızı TOPLAM: lig sırası farklı; AI A 3, AI B 4',
        'Al Okhdoud TOPLAM: puan farklı; AI A 5, AI B 4',
        'AI A · Al Okhdoud: TOPLAM satırındaki not: UYUŞMUYOR',
      ]),
    )
    // Bir cevapta "?" olan devre skoru fark sayılmaz; rakip adındaki yazım farkı da.
    expect(texts('yellow').some((t) => t.includes('20.09.2026') || t.includes('rakip adı'))).toBe(false)
  })

  it('mavi: yalnızca bir cevapta olan satırlar (SON ve H2H)', () => {
    expect(texts('blue')).toEqual(
      expect.arrayContaining([
        'Kuzey Yıldızı 16.09.2026 (Liman İdman, KUPA, 5-4): yalnızca AI A cevabında var',
        'H2H 02.11.2025 (Al Okhdoud – Kuzey Yıldızı, 1-1): yalnızca AI A cevabında var',
      ]),
    )
    expect(second.warnings.map((w) => w.text)).toEqual(expect.arrayContaining(['H2H: AI A cevabında "bilinmiyor"', 'Bu maç yalnızca AI A cevabında var']))
  })

  it('doğrulanmış oranlar: yalnızca maç sonu skoru iki cevapta aynı olan satırlar', () => {
    const kuzey = team(match, 'Kuzey Yıldızı')
    expect(four(kuzey.a!.overall)).toEqual(['2/4', '2/4', '1/4', '2/3'])
    expect(four(kuzey.b!.overall)).toEqual(['3/4', '2/4', '2/4', '4/4'])
    // 27.09 (skor farklı) dışarıda: 2-1, 3-0, 0-2. Devre: 03.10 ortak; 20.09 A'da "?"; 13.09 farklı.
    expect(kuzey.verified!.rows).toBe(3)
    expect(four(kuzey.verified!.overall)).toEqual(['2/3', '1/3', '1/3', '1/1'])
    // İç: 03.10 ve 20.09 (13.09'un tarafı iki cevapta aynı değil)
    expect(four(kuzey.verified!.venue!.rates)).toEqual(['2/2', '1/2', '1/2', '1/1'])
    expect(kuzey.verified!.venue!.unknownVenue).toBe(1)

    const okhdoud = team(match, 'Al Akhdoud')
    for (const view of [okhdoud.a!.overall, okhdoud.b!.overall, okhdoud.verified!.overall]) expect(four(view)).toEqual(['1/3', '1/3', '1/3', '1/3'])
    expect(four(okhdoud.verified!.venue!.rates)).toEqual(['1/2', '1/2', '1/2', '1/2'])
  })

  it('SKOR / HABER hangi cevaptan geldiğiyle; kaynaklar adresleriyle', () => {
    expect(match.notes).toEqual([
      { ai: 'A', kind: 'SKOR', text: 'Tahmin 2-1' },
      { ai: 'A', kind: 'HABER', text: "Kuzey Yıldızı'nda iki eksik var | Sofascore" },
    ])
    expect(match.sources).toEqual([
      { ai: 'A', site: 'Sofascore', url: 'https://www.sofascore.com/x' },
      { ai: 'A', site: 'Flashscore', url: 'https://www.flashscore.com/y' },
      { ai: 'B', site: 'Soccerway', url: null },
    ])
  })

  it('"tüm uyarıları kopyala" metni: maç başlığı ve renk etiketli satırlar; bilgi satırları yok', () => {
    const text = warningsText([match, second])
    expect(text.startsWith('#1 Kuzey Yıldızı – Al Okhdoud\n[KIRMIZI] ')).toBe(true)
    expect(text).toContain('[SARI] Kuzey Yıldızı TOPLAM: lig sırası farklı; AI A 3, AI B 4')
    expect(text).toContain('\n\n#2 takım okunamadı\n[MAVİ] ')
    expect(text).not.toContain('BİLGİ')
  })

  it('tek cevap yapıştırıldıysa cevaplar arası uyarı ve doğrulanmış oran üretilmez', () => {
    const [alone] = compareAnswers({ a: parseAnswer(A), b: null, labels, fixtures: [] })
    expect(alone.teams.every((t) => t.b === null && t.verified === null)).toBe(true)
    expect(alone.warnings.some((w) => w.text.includes('yalnızca'))).toBe(false)
    expect(alone.warnings.filter((w) => w.level === 'red')).toHaveLength(1)
    expect(compareAnswers({ a: null, b: null, labels, fixtures: [] })).toEqual([])
  })
})

// Gerçek örnek cevaplar (elle doğrulanmış beklenen değerlerle); dosyalar yoksa atlanır.
const REAL = { a: 'samples/ham-veri/chatgpt-v3.txt', b: 'samples/ham-veri/claude-v3.txt' }
describe.runIf(existsSync(REAL.a) && existsSync(REAL.b))('gerçek örnek cevaplar (samples/ham-veri)', () => {
  const load = () => compareAnswers({ a: parseAnswer(readFileSync(REAL.a, 'utf8')), b: parseAnswer(readFileSync(REAL.b, 'utf8')), labels: { A: 'ChatGPT', B: 'Claude' }, fixtures: [] })
  const find = (name: string): TeamComparison => load().flatMap((m) => m.teams).find((t) => sameTeam(t.name, name))!

  // Sırayla 2.5 ÜST, KG VAR, birlikte, İY golü. İY paydasına yalnızca devre skoru bilinen satırlar girer:
  // Claude cevabında Al Duhail 12.09 ve Al Gharafa 21.08 satırlarının devre skoru "?" olduğu için o
  // sütunda ve doğrulanmış sütunda payda 3'tür; elle doğrulanmış 1/4 ve 2/4, devre skorlarının
  // tamamını veren ChatGPT cevabının değeridir.
  it.each([
    ['Al Shamal', ['3/4', '4/4', '3/4'], { a: '2/4', b: '2/4', verified: '2/4' }],
    ['Al Duhail', ['0/4', '3/4', '0/4'], { a: '1/4', b: '1/3', verified: '1/3' }],
    ['Al Wakrah', ['3/4', '3/4', '2/4'], { a: '4/4', b: '4/4', verified: '4/4' }],
    ['Al Gharafa', ['3/4', '3/4', '3/4'], { a: '2/4', b: '1/3', verified: '1/3' }],
  ])('%s: genel lig oranları', (name, expected, half) => {
    const team = find(name)
    for (const view of [team.a!.overall, team.b!.overall, team.verified!.overall]) expect(four(view).slice(0, 3)).toEqual(expected)
    expect({ a: rate(team.a!.overall.ht05), b: rate(team.b!.overall.ht05), verified: rate(team.verified!.overall.ht05) }).toEqual(half)
  })

  it.each([
    ['Al Okhdoud', ['2/5', '3/5', '2/5']],
    ['Al Ula', ['2/5', '1/5', '1/5']],
  ])('%s: genel lig oranları ve TOPLAM denetimi', (name, expected) => {
    const team = find(name)
    for (const view of [team.a!.overall, team.b!.overall, team.verified!.overall]) expect(four(view).slice(0, 3)).toEqual(expected)
    expect(team.a!.totalCheck!.status).toBe('ok')
    expect(team.b!.totalCheck!.status).toBe('ok')
  })

  it('tüm lig maç sonu skorları iki cevapta aynı; H2H eksikleri ve Duhail lig sırası farkı uyarı', () => {
    const warnings = load().flatMap((m) => m.warnings)
    expect(warnings.filter((w) => w.level === 'red' && w.text.includes('maç sonu skoru farklı') && !w.text.startsWith('H2H'))).toEqual([])
    expect(warnings.some((w) => w.level === 'blue' && w.text.startsWith('H2H'))).toBe(true)
    expect(warnings.filter((w) => w.text.includes('rakip adı farklı'))).toEqual([])
    expect(warnings.some((w) => w.level === 'yellow' && sameTeam(w.text.split(' TOPLAM')[0], 'Al Duhail') && w.text.includes('lig sırası farklı'))).toBe(true)
  })
})
