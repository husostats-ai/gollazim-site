import { describe, expect, it } from 'vitest'
import { defaultThresholds } from '../../config/categories'
import type { BackupFile, LeagueTable, LeagueTableRow, LeagueTableSnapshot, Match, TeamAlias } from '../../types'
import { collectAiMatches } from '../ai/collect'
import { buildPrompts } from '../ai/prompt'
import { analyzeDay } from '../analysis/engine'
import { makeMatch } from '../analysis/testUtils'
import { assembleBackup, isBackupFile } from '../data/backupFormat'
import { ageGroup, aliasId, findStanding, matchTeams, normalizeAliases, normalizeLeagueTables, normalizeTeam, NOT_IN_TABLE } from './matching'
import { fitsAverage, checkRow, parseLeagueTable } from './parser'
import { detailText, matchStandings, playedHint, ppgDiffers, standingInfo, tableAgeText } from './standing'
import { nextSnapshot, normalizeSnapshots, sameRows, seedSnapshots, snapshotAt, snapshotId } from './history'
import { buildMemberPayload } from '../member/payload'
import { memberInput } from '../member/__fixtures__/rawData'

// FootyStats lig tablosu kopyasının küçültülmüş, uydurma takımlı örneği: başlıkta adı
// olmayan sütunlar, her takım için üç satır (takım satırı, "Last 5", PPG ile başlayan değerler).
const line = (rank: number, team: string, mp: number, w: number, d: number, l: number, gf: number, ga: number, gd: string, pts: number) =>
  [rank, `${team} Stats`, team, mp, w, d, l, gf, ga, gd, pts, ''].join('\t')
const SAMPLE = [
  ['', 'Team', 'MP', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts', 'Last 5', 'PPG', 'CS', 'BTTS', 'xGF', '', '', '1.5+', '2.5+', 'AVG'].join('\t'),
  line(1, 'Kuzey Yıldızı FC', 5, 5, 0, 0, 13, 5, '+8', 15),
  'WWWWW',
  ['3.00', '40%', '60%', '1.62', '3.00', '10.40', '60%', '60%', '3.60'].join('\t'),
  line(2, 'Güney Spor AFC', 5, 3, 1, 1, 9, 9, '0', 10),
  'WLDWW',
  ['2.00', '60%', '40%', '2.04', '4.60', '10.00', '100%', '80%', '3.60'].join('\t'),
  line(3, 'Doğu & Batı Birliği FC', 6, 1, 2, 3, 4, 9, '-5', 5),
  'LDDWL',
  ['0.83', '20%', '40%', '1.61', '4.40', '8.00', '40%', '40%', '2.17'].join('\t'),
].join('\n')

describe('parseLeagueTable', () => {
  it('tablonun tüm sütunları okunur: sıra, takım, MP, W, D, L, GF, GA, GD, Pts, Last 5, PPG, CS, BTTS, xGF, kart, korner, 1.5+, 2.5+, AVG', () => {
    const { rows, errors, warnings } = parseLeagueTable(SAMPLE)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(rows).toEqual([
      { rank: 1, team: 'Kuzey Yıldızı FC', played: 5, won: 5, drawn: 0, lost: 0, goalsFor: 13, goalsAgainst: 5, goalDiff: 8, points: 15, ppg: 3, last5: 'WWWWW', cs: 40, btts: 60, xgf: 1.62, cards: 3, corners: 10.4, over15: 60, over25: 60, avgGoals: 3.6 },
      { rank: 2, team: 'Güney Spor AFC', played: 5, won: 3, drawn: 1, lost: 1, goalsFor: 9, goalsAgainst: 9, goalDiff: 0, points: 10, ppg: 2, last5: 'WLDWW', cs: 60, btts: 40, xgf: 2.04, cards: 4.6, corners: 10, over15: 100, over25: 80, avgGoals: 3.6 },
      { rank: 3, team: 'Doğu & Batı Birliği FC', played: 6, won: 1, drawn: 2, lost: 3, goalsFor: 4, goalsAgainst: 9, goalDiff: -5, points: 5, ppg: 0.83, last5: 'LDDWL', cs: 20, btts: 40, xgf: 1.61, cards: 4.4, corners: 8, over15: 40, over25: 40, avgGoals: 2.17 },
    ])
  })

  const EXTRA_KEYS = ['cs', 'btts', 'xgf', 'cards', 'corners', 'over15', 'over25', 'avgGoals'] as const
  const withValues = (values: string[], last5 = 'WWWWW') => parseLeagueTable([line(1, 'A FC', 5, 5, 0, 0, 13, 5, '+8', 15), last5, values.join('\t')].join('\n'))

  it('değer satırı tam 9 alan değilse ek alanlar boş kalır; satır, PPG ve Last 5 yine kaydedilir', () => {
    for (const values of [
      ['3.00', '40%', '60%', '1.62', '3.00', '10.40', '60%', '60%'],
      ['3.00', '40%', '60%', '1.62', '3.00', '10.40', '60%', '60%', '3.60', '1'],
      ['3.00', '40%', '60%', '1.62', '3.00', '10.40', '60', '60%', '3.60'],
      ['3.00', '40%', '160%', '1.62', '3.00', '10.40', '60%', '60%', '3.60'],
    ]) {
      const { rows, errors, warnings } = withValues(values)
      expect(errors).toEqual([])
      expect(rows[0]).toMatchObject({ team: 'A FC', ppg: 3, last5: 'WWWWW', goalDiff: 8 })
      for (const key of EXTRA_KEYS) expect(rows[0], key).not.toHaveProperty(key)
      expect(warnings.map((w) => [w.line, w.message])).toEqual([[3, 'A FC: Değer satırı beklenen 9 sütun (PPG, CS, BTTS, xGF, kart, korner, 1.5+, 2.5+, AVG) biçiminde değil; ek alanlar boş bırakıldı.']])
    }
  })

  it('AVG, (GF+GA)/MP ile tutmuyorsa satır kaydedilir, ek alanlar boş kalır ve uyarı verilir', () => {
    const { rows, errors, warnings } = withValues(['3.00', '40%', '60%', '1.62', '3.00', '10.40', '60%', '60%', '4.20'])
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ team: 'A FC', ppg: 3, last5: 'WWWWW' })
    for (const key of EXTRA_KEYS) expect(rows[0]).not.toHaveProperty(key)
    expect(warnings.map((w) => w.message)).toEqual(['A FC: AVG (4.2) (GF+GA)/MP ile tutmuyor; ek alanlar boş bırakıldı.'])
    // Yuvarlama payı: 13/6 = 2,1667 tabloda 2.17 yazar
    expect(fitsAverage(2.17, { played: 6, goalsFor: 4, goalsAgainst: 9 })).toBe(true)
    expect(fitsAverage(2.18, { played: 6, goalsFor: 4, goalsAgainst: 9 })).toBe(false)
  })

  it('Last 5 beşten kısa olabilir; hiç maç oynanmamışsa AVG sağlaması aranmaz', () => {
    expect(withValues(['3.00', '40%', '60%', '1.62', '3.00', '10.40', '60%', '60%', '3.60'], 'wd').rows[0]).toMatchObject({ last5: 'WD', avgGoals: 3.6 })
    const text = [line(1, 'A FC', 0, 0, 0, 0, 0, 0, '0', 0), ['0.00', '0%', '0%', '0.00', '0.00', '0.00', '0%', '0%', '0.00'].join('\t')].join('\n')
    const { rows, warnings } = parseLeagueTable(text)
    expect(warnings).toEqual([])
    expect(rows[0]).toMatchObject({ played: 0, cs: 0, avgGoals: 0 })
    expect(rows[0]).not.toHaveProperty('last5')
  })

  it('değer satırı olmayan düz kopyada uyarı çıkmaz', () => {
    expect(parseLeagueTable([line(1, 'A FC', 2, 2, 0, 0, 4, 0, '+4', 6), 'WW', '3.00'].join('\n')).warnings).toEqual([])
  })

  it('takım adı "Stats" ile bitmeyen sütundan alınır; başlık, "Last 5" ve değer satırları yok sayılır', () => {
    const { rows } = parseLeagueTable(SAMPLE)
    expect(rows.every((r) => !r.team.endsWith('Stats'))).toBe(true)
    expect(rows).toHaveLength(3)
  })

  it('Windows satır sonu, tipografik eksi ve virgüllü PPG okunur', () => {
    const text = [line(1, 'A FC', 2, 0, 1, 1, 1, 3, '−2', 1), 'DL', '0,50\t0%'].join('\r\n')
    expect(parseLeagueTable(text).rows[0]).toMatchObject({ team: 'A FC', points: 1, ppg: 0.5 })
  })

  it('PPG satırı yoksa PPG boş kalır; sonraki takımın değeri alınmaz, hesaplanıp yerine de konmaz', () => {
    const text = [line(1, 'A FC', 2, 2, 0, 0, 4, 0, '+4', 6), line(2, 'B FC', 2, 0, 0, 2, 0, 4, '-4', 0), 'LL', '0.00'].join('\n')
    const { rows } = parseLeagueTable(text)
    expect(rows.map((r) => r.ppg)).toEqual([null, 0])
  })

  it('"Stats" sütunu olmayan düz kopya da okunur', () => {
    const text = ['1', 'A FC', '3', '1', '1', '1', '4', '4', '0', '4'].join('\t')
    expect(parseLeagueTable(text).rows[0]).toMatchObject({ rank: 1, team: 'A FC', played: 3, points: 4, ppg: null })
  })
})

describe('sağlama kuralları', () => {
  const ok = { rank: 1, team: 'A', played: 5, won: 3, drawn: 1, lost: 1, goalsFor: 9, goalsAgainst: 7, points: 10, ppg: 2 }

  it('W+D+L=MP, 3W+D=Pts, GF−GA=GD', () => {
    expect(checkRow(ok, 2)).toEqual([])
    expect(checkRow({ ...ok, played: 6 }, 2)).toEqual(["W+D+L (3+1+1) MP'ye (6) eşit değil"])
    expect(checkRow({ ...ok, points: 11 }, 2)).toEqual(["3W+D (10) Pts'ye (11) eşit değil"])
    expect(checkRow(ok, 3)).toEqual(["GF−GA (2) GD'ye (3) eşit değil"])
    expect(checkRow({ ...ok, played: 6, points: 9 }, 1)).toHaveLength(3)
  })

  it('tutmayan satır kaydedilmez; satır numarası ve nedeni bildirilir', () => {
    const text = [
      line(1, 'İyi FC', 5, 5, 0, 0, 13, 5, '+8', 15),
      'WWWWW',
      '3.00',
      line(2, 'Yanlış Puan FC', 5, 3, 1, 1, 9, 9, '0', 12),
      'WLDWW',
      '2.00',
      line(3, 'Yanlış Maç FC', 7, 1, 2, 3, 4, 9, '-5', 5),
      line(4, 'Yanlış Averaj FC', 5, 1, 1, 3, 6, 10, '-5', 4),
      line(5, 'Eksik FC', 5, 1, 1, 3, 6, 10, '-4', '' as unknown as number),
    ].join('\n')
    const { rows, errors } = parseLeagueTable(text)
    expect(rows.map((r) => r.team)).toEqual(['İyi FC'])
    expect(errors.map((e) => [e.line, e.message])).toEqual([
      [4, "Sağlama tutmadı: 3W+D (10) Pts'ye (12) eşit değil."],
      [7, "Sağlama tutmadı: W+D+L (1+2+3) MP'ye (7) eşit değil."],
      [8, 'Sağlama tutmadı: GF−GA (-4) GD\'ye (-5) eşit değil.'],
      [9, 'MP, W, D, L, GF, GA, GD, Pts sütunlarından biri okunamadı.'],
    ])
    expect(errors[0].text).toContain('Yanlış Puan FC')
  })

  it('aynı takım iki kez gelirse ikincisi alınmaz', () => {
    const text = [line(1, 'A FC', 1, 1, 0, 0, 1, 0, '+1', 3), line(2, 'A FC', 1, 0, 0, 1, 0, 1, '-1', 0)].join('\n')
    const { rows, errors } = parseLeagueTable(text)
    expect(rows).toHaveLength(1)
    expect(errors[0].message).toBe('“A FC” tabloda birden fazla kez geçiyor.')
  })

  it('tablo olmayan metin: satır da hata da çıkmaz', () => {
    expect(parseLeagueTable('Merhaba\n\nbu bir tablo değil')).toEqual({ rows: [], errors: [], warnings: [] })
    expect(parseLeagueTable('')).toEqual({ rows: [], errors: [], warnings: [] })
  })
})

const LEAGUE = 'Testland · Deneme Ligi'
const rows = parseLeagueTable(SAMPLE).rows.map(({ team, rank, played, points, ppg }) => ({ team, rank, played, points, ppg }))
const table = (pastedAt = '2026-10-05T09:00:00.000Z'): LeagueTable => ({ id: LEAGUE, league: LEAGUE, pastedAt, rows })
const alias = (csvTeam: string, tableTeam: string): TeamAlias => ({ id: aliasId(LEAGUE, csvTeam), league: LEAGUE, csvTeam, tableTeam })

describe('takım adı eşleştirme', () => {
  it('normalize: küçük harf, aksan, "&", FC / AFC ve yaş grubu ekleri', () => {
    expect(normalizeTeam('Kuzey Yıldızı FC')).toBe('kuzey yildizi')
    expect(normalizeTeam('Kuzey Yıldızı U21')).toBe('kuzey yildizi')
    expect(normalizeTeam('AFC Güney Spor')).toBe('guney spor')
    expect(normalizeTeam('Doğu & Batı Birliği FC')).toBe('dogu and bati birligi')
    expect(normalizeTeam('Doğu and Batı Birliği Under 21')).toBe('dogu and bati birligi')
    expect(normalizeTeam('FC')).toBe('')
  })

  const match = (csvTeams: string[], aliases: TeamAlias[] = []) => matchTeams(LEAGUE, csvTeams, rows, aliases).map((m) => [m.csvTeam, m.kind, m.row?.team ?? null, m.reason ?? null])

  it('önce tam eşleşme, sonra normalize eşleşme', () => {
    expect(match(['güney spor afc', 'Kuzey Yıldızı', 'Doğu and Batı Birliği'])).toEqual([
      ['güney spor afc', 'exact', 'Güney Spor AFC', null],
      ['Kuzey Yıldızı', 'normalized', 'Kuzey Yıldızı FC', null],
      ['Doğu and Batı Birliği', 'normalized', 'Doğu & Batı Birliği FC', null],
    ])
  })

  it('yaş eki bir tarafta varsa kendiliğinden eşleşmez (her iki yönde)', () => {
    // CSV'de U21 var, tabloda yok
    for (const age of ['U17', 'U18', 'U19', 'U20', 'U21', 'U23', 'U-21', 'Under 21']) {
      expect(match([`Kuzey Yıldızı ${age}`]), age).toEqual([[`Kuzey Yıldızı ${age}`, 'none', null, 'age-mismatch']])
    }
    // Tabloda U21 var, CSV'de yok
    const youthTable = [{ team: 'Kuzey Yıldızı U21', rank: 1, played: 5, points: 15, ppg: 3 }]
    expect(matchTeams(LEAGUE, ['Kuzey Yıldızı FC'], youthTable, [])[0]).toMatchObject({ row: null, kind: 'none', reason: 'age-mismatch' })
    // Ekler farklı
    expect(matchTeams(LEAGUE, ['Kuzey Yıldızı U19'], youthTable, [])[0]).toMatchObject({ row: null, reason: 'age-mismatch' })
  })

  it('aynı yaş eki iki tarafta da varsa eşleşir; yazım farkı sorun olmaz', () => {
    const youthTable = [
      { team: 'Kuzey Yıldızı FC U21', rank: 1, played: 5, points: 15, ppg: 3 },
      { team: 'Güney Spor Under 21', rank: 2, played: 5, points: 10, ppg: 2 },
      { team: 'Kuzey Yıldızı FC', rank: 3, played: 5, points: 9, ppg: 1.8 },
    ]
    const result = matchTeams(LEAGUE, ['Kuzey Yıldızı U21', 'AFC Güney Spor U-21', 'Kuzey Yıldızı'], youthTable, [])
    expect(result.map((m) => [m.kind, m.row?.team])).toEqual([
      ['normalized', 'Kuzey Yıldızı FC U21'],
      ['normalized', 'Güney Spor Under 21'],
      ['normalized', 'Kuzey Yıldızı FC'],
    ])
    expect(ageGroup('Güney Spor Under 21')).toBe('u21')
    expect(ageGroup('Kuzey Yıldızı U-21')).toBe('u21')
    expect(ageGroup('Kuzey Yıldızı FC')).toBeNull()
    expect(ageGroup('Union 1921')).toBeNull()
  })

  it('yaş eki farklı olsa da kullanıcı elle seçebilir ve tam ad eşleşmesi çalışır', () => {
    expect(match(['Kuzey Yıldızı U21'], [alias('Kuzey Yıldızı U21', 'Kuzey Yıldızı FC')])).toEqual([['Kuzey Yıldızı U21', 'alias', 'Kuzey Yıldızı FC', null]])
    const youthTable = [{ team: 'Kuzey Yıldızı U21', rank: 1, played: 5, points: 15, ppg: 3 }]
    expect(matchTeams(LEAGUE, ['kuzey yıldızı u21'], youthTable, [])[0]).toMatchObject({ kind: 'exact' })
  })

  it('benzer ad yoksa eşleştirilmez (kısaltma tahmin edilmez)', () => {
    expect(match(['KY U21', 'Bambaşka Takım'])).toEqual([
      ['KY U21', 'none', null, 'no-candidate'],
      ['Bambaşka Takım', 'none', null, 'no-candidate'],
    ])
  })

  it('belirsizse sessizce eşleştirilmez: iki CSV takımı aynı ada düşüyorsa ikisi de sorulur', () => {
    expect(match(['Kuzey Yıldızı', 'Kuzey Yıldızı SC'])).toEqual([
      ['Kuzey Yıldızı', 'none', null, 'ambiguous'],
      ['Kuzey Yıldızı SC', 'none', null, 'ambiguous'],
    ])
    // Tabloda aynı ada düşen iki takım varsa da
    const twins = [...rows, { team: 'Kuzey Yıldızı AFC', rank: 4, played: 5, points: 3, ppg: 0.6 }]
    expect(matchTeams(LEAGUE, ['Kuzey Yıldızı'], twins, [])[0]).toMatchObject({ kind: 'none', reason: 'ambiguous' })
    // A takım ile U21 aynı listede olunca birbirini engellemez: A takım eşleşir, U21 sorulur
    expect(match(['Kuzey Yıldızı', 'Kuzey Yıldızı U21'])).toEqual([
      ['Kuzey Yıldızı', 'normalized', 'Kuzey Yıldızı FC', null],
      ['Kuzey Yıldızı U21', 'none', null, 'age-mismatch'],
    ])
  })

  it('kullanıcının seçimi hatırlanır ve her şeyin önüne geçer', () => {
    expect(match(['KY U21', 'Kuzey Yıldızı U21'], [alias('KY U21', 'Kuzey Yıldızı FC'), alias('Kuzey Yıldızı U21', 'Güney Spor AFC')])).toEqual([
      ['KY U21', 'alias', 'Kuzey Yıldızı FC', null],
      ['Kuzey Yıldızı U21', 'alias', 'Güney Spor AFC', null],
    ])
  })

  it('"tabloda yok" seçimi normalize eşleşmeyi de kapatır; başka ligin seçimi karışmaz', () => {
    expect(match(['Kuzey Yıldızı'], [alias('Kuzey Yıldızı', NOT_IN_TABLE)])).toEqual([['Kuzey Yıldızı', 'none', null, 'declared-absent']])
    const other: TeamAlias = { id: aliasId('Başka Lig', 'KY U21'), league: 'Başka Lig', csvTeam: 'KY U21', tableTeam: 'Kuzey Yıldızı FC' }
    expect(match(['KY U21'], [other])).toEqual([['KY U21', 'none', null, 'no-candidate']])
  })

  it('seçilen takım yeni tabloda yoksa başka takıma düşülmez', () => {
    expect(match(['Kuzey Yıldızı U21'], [alias('Kuzey Yıldızı U21', 'Artık Olmayan FC')])).toEqual([['Kuzey Yıldızı U21', 'none', null, 'alias-missing']])
  })

  it('findStanding: tablo, lig ya da güvenli eşleşme yoksa null', () => {
    expect(findStanding(LEAGUE, 'Kuzey Yıldızı', [], [table()], [])?.row).toMatchObject({ rank: 1, played: 5 })
    // Yaş eki farklı: kendiliğinden eşleşmez, kayıtlı seçim varsa eşleşir
    expect(findStanding(LEAGUE, 'Kuzey Yıldızı U21', [], [table()], [])).toBeNull()
    expect(findStanding(LEAGUE, 'Kuzey Yıldızı U21', [], [table()], [alias('Kuzey Yıldızı U21', 'Kuzey Yıldızı FC')])?.row.rank).toBe(1)
    expect(findStanding(LEAGUE, 'KY U21', [], [table()], [])).toBeNull()
    expect(findStanding(LEAGUE, 'KY U21', [], [table()], [alias('KY U21', 'Kuzey Yıldızı FC')])?.row.rank).toBe(1)
    expect(findStanding('Başka Lig', 'Kuzey Yıldızı', [], [table()], [])).toBeNull()
    expect(findStanding(undefined, 'Kuzey Yıldızı', [], [table()], [])).toBeNull()
    expect(findStanding(LEAGUE, 'Kuzey Yıldızı', [], [], [])).toBeNull()
    // Aynı ligde aynı ada düşen başka bir CSV takımı biliniyorsa eşleştirilmez
    expect(findStanding(LEAGUE, 'Kuzey Yıldızı', ['Kuzey Yıldızı SC'], [table()], [])).toBeNull()
  })
})

describe('kartta gösterim ve bayatlık', () => {
  const now = new Date('2026-10-07T09:00:00.000Z')
  const game = (home: string, away: string, league: string | undefined = LEAGUE): Match => makeMatch({ over25Pct: 90 }, { home, away, league })

  it('"Ligde N. sıra · M maç · tablo X gün önce"', () => {
    const standing = findStanding(LEAGUE, 'Kuzey Yıldızı', [], [table()], [])!
    expect(standingInfo(standing, now)).toEqual({ text: 'Ligde 1. sıra · 5 maç · tablo 2 gün önce', rank: 1, played: 5, ageDays: 2, stale: false })
    expect(tableAgeText(0)).toBe('tablo bugün')
    expect(standingInfo(findStanding(LEAGUE, 'Kuzey Yıldızı', [], [table(now.toISOString())], [])!, now).text).toBe('Ligde 1. sıra · 5 maç · tablo bugün')
  })

  it('7 günden eski tablo "güncel değil" sayılır; tam 7 gün sayılmaz', () => {
    const at = (days: number) => standingInfo(findStanding(LEAGUE, 'Kuzey Yıldızı', [], [table(new Date(now.getTime() - days * 86_400_000).toISOString())], [])!, now)
    expect(at(7)).toMatchObject({ ageDays: 7, stale: false })
    expect(at(8)).toMatchObject({ ageDays: 8, stale: true, text: 'Ligde 1. sıra · 5 maç · tablo 8 gün önce' })
  })

  it('ev ve deplasman ayrı ayrı; eşleşmeyen taraf boş kalır', () => {
    const match = game('Kuzey Yıldızı', 'Bilinmeyen U21')
    const standings = matchStandings(match, [match], [table()], [], now)
    expect(standings.home?.text).toBe('Ligde 1. sıra · 5 maç · tablo 2 gün önce')
    expect(standings.away).toBeNull()
    expect(playedHint(standings)).toBe('Lig tablosuna göre oynanan maç: ev sahibi 5 (tablo 2 gün önce).')
    const both = game('Kuzey Yıldızı', 'Doğu and Batı Birliği')
    expect(playedHint(matchStandings(both, [both], [table()], [], now))).toBe('Lig tablosuna göre oynanan maç: ev sahibi 5, deplasman 6 (tablo 2 gün önce).')
  })

  it('tablo yoksa hiçbir şey gösterilmez', () => {
    const match = game('Kuzey Yıldızı', 'Güney Spor')
    expect(matchStandings(match, [match], [], [], now)).toEqual({ home: null, away: null })
    expect(playedHint({ home: null, away: null })).toBeNull()
    const noLeague = game('Kuzey Yıldızı', 'Güney Spor', undefined)
    expect(matchStandings({ ...noLeague, league: undefined }, [noLeague], [table()], [], now)).toEqual({ home: null, away: null })
  })
})

describe('yalnızca gösterim: analiz ve prompt tabloya bakmaz', () => {
  it('analiz fonksiyonu tablo almaz; prompt metninde tablo bilgisi geçmez', () => {
    const match = makeMatch({ over25Pct: 90, bttsPct: 85 }, { home: 'Kuzey Yıldızı U21', away: 'Güney Spor U21', league: LEAGUE })
    const analysis = analyzeDay([match], defaultThresholds())
    expect(analyzeDay.length).toBeLessThanOrEqual(4)
    const [chunk] = buildPrompts(collectAiMatches(analysis), 'chatgpt', '6 Ekim 2026 Salı')
    expect(chunk.text).not.toMatch(/Ligde \d+\. sıra|lig tablosuna göre/i)
  })
})

describe('yedek ve geri yükleme', () => {
  const content = { uploads: [], matches: [], results: [], picks: [], thresholds: defaultThresholds() }

  it('tablolar ve takım eşleştirmeleri yedekten aynen geri gelir', () => {
    const saved = { leagueTables: [table()], teamAliases: [alias('KY U21', 'Kuzey Yıldızı FC'), alias('Yok U21', NOT_IN_TABLE)] }
    const file = JSON.parse(JSON.stringify(assembleBackup({ ...content, ...saved }, new Date('2026-10-06T00:00:00Z')))) as BackupFile
    expect(isBackupFile(file)).toBe(true)
    expect(normalizeLeagueTables(file.leagueTables)).toEqual(saved.leagueTables)
    expect(normalizeAliases(file.teamAliases)).toEqual(saved.teamAliases)
  })

  it('tablosu olmayan eski yedek geçerlidir; bozuk kayıtlar atılır', () => {
    const old = JSON.parse(JSON.stringify(assembleBackup(content, new Date('2026-10-06T00:00:00Z')))) as BackupFile
    expect(isBackupFile(old)).toBe(true)
    expect(normalizeLeagueTables(old.leagueTables)).toEqual([])
    expect(normalizeAliases(old.teamAliases)).toEqual([])
    expect(isBackupFile({ ...old, leagueTables: 'x' })).toBe(false)
    const dirty = [{ league: LEAGUE, pastedAt: '2026-10-05T09:00:00.000Z', rows: [rows[0], { team: 'Bozuk', rank: 'iki' }, null] }, { league: 5, rows: [] }, null]
    expect(normalizeLeagueTables(dirty)).toEqual([{ id: LEAGUE, league: LEAGUE, pastedAt: '2026-10-05T09:00:00.000Z', rows: [rows[0]] }])
    expect(normalizeAliases([{ league: LEAGUE, csvTeam: 'A', tableTeam: 7 }, alias('B', 'C')])).toEqual([alias('B', 'C')])
  })
})

const FULL_ROWS: LeagueTableRow[] = parseLeagueTable(SAMPLE).rows

describe('ek sütunların saklanması ve yedek', () => {
  const content = { uploads: [], matches: [], results: [], picks: [], thresholds: defaultThresholds() }
  const full: LeagueTable = { id: LEAGUE, league: LEAGUE, pastedAt: '2026-10-05T09:00:00.000Z', rows: FULL_ROWS }

  it('tüm sütunlar yedekten aynen geri gelir', () => {
    const snapshots = [nextSnapshot([], full)]
    const file = JSON.parse(JSON.stringify(assembleBackup({ ...content, leagueTables: [full], leagueTableSnapshots: snapshots }, new Date('2026-10-06T00:00:00Z')))) as BackupFile
    expect(isBackupFile(file)).toBe(true)
    expect(normalizeLeagueTables(file.leagueTables)).toEqual([full])
    expect(normalizeLeagueTables(file.leagueTables)[0].rows[0]).toMatchObject({ won: 5, goalsFor: 13, goalDiff: 8, last5: 'WWWWW', cs: 40, btts: 60, xgf: 1.62, cards: 3, corners: 10.4, over15: 60, over25: 60, avgGoals: 3.6 })
    expect(normalizeSnapshots(file.leagueTableSnapshots)).toEqual(snapshots)
  })

  it('bozuk ek alan yalnızca kendisi atılır; satır ve diğer alanlar kalır', () => {
    const dirty = { ...FULL_ROWS[0], cs: 140, last5: 'WWXWW', goalsFor: -1, corners: '10', bilinmeyen: 1 }
    const [row] = normalizeLeagueTables([{ ...full, rows: [dirty] }])[0].rows
    expect(row).toMatchObject({ team: 'Kuzey Yıldızı FC', rank: 1, btts: 60, avgGoals: 3.6, won: 5 })
    for (const key of ['cs', 'last5', 'goalsFor', 'corners', 'bilinmeyen']) expect(row).not.toHaveProperty(key)
  })

  it('geçmişi olmayan eski yedek geçerlidir; hiç tablo yokken alan yedeğe yazılmaz', () => {
    const old = JSON.parse(JSON.stringify(assembleBackup({ ...content, leagueTables: [table()] }, new Date('2026-10-06T00:00:00Z')))) as BackupFile
    expect(isBackupFile(old)).toBe(true)
    expect(old).not.toHaveProperty('leagueTableSnapshots')
    expect(normalizeSnapshots(old.leagueTableSnapshots)).toEqual([])
    // Geri yüklemede kayıtlı tablo geçmişin ilk görüntüsü olur.
    expect(seedSnapshots(normalizeLeagueTables(old.leagueTables), [])).toEqual([{ id: snapshotId(LEAGUE, table().pastedAt), league: LEAGUE, pastedAt: table().pastedAt, rows }])
    expect(isBackupFile({ ...old, leagueTableSnapshots: 'x' })).toBe(false)
    expect(normalizeSnapshots([{ league: LEAGUE, pastedAt: 'tarih değil', rows: [] }, { league: 5, pastedAt: table().pastedAt, rows: [] }, null])).toEqual([])
  })
})

describe('yapıştırma geçmişi', () => {
  const at = (pastedAt: string, tableRows: LeagueTableRow[] = FULL_ROWS): LeagueTable => ({ id: LEAGUE, league: LEAGUE, pastedAt, rows: tableRows })
  const changed = FULL_ROWS.map((r, i) => (i === 0 ? { ...r, played: 6, won: 6, points: 18, last5: 'WWWWW' } : r))

  it('her yapıştırma ayrı görüntüdür; içerik aynıysa yeni kayıt açılmaz', () => {
    const first = nextSnapshot([], at('2026-10-05T09:00:00.000Z'))
    expect(first).toEqual({ id: `${LEAGUE}|2026-10-05T09:00:00.000Z`, league: LEAGUE, pastedAt: '2026-10-05T09:00:00.000Z', rows: FULL_ROWS })
    // Aynı içerik: kimlik ve ilk yapıştırma anı korunur, yalnızca son görülme güncellenir.
    const again = nextSnapshot([first], at('2026-10-06T09:00:00.000Z', JSON.parse(JSON.stringify(FULL_ROWS))))
    expect(again).toEqual({ ...first, lastSeenAt: '2026-10-06T09:00:00.000Z' })
    const second = nextSnapshot([again], at('2026-10-08T09:00:00.000Z', changed))
    expect(second.id).toBe(`${LEAGUE}|2026-10-08T09:00:00.000Z`)
    expect(second.id).not.toBe(first.id)
    // Başka ligin geçmişi karışmaz.
    expect(nextSnapshot([{ ...first, id: 'Başka|x', league: 'Başka' }], at('2026-10-06T09:00:00.000Z')).id).toBe(`${LEAGUE}|2026-10-06T09:00:00.000Z`)
    expect(sameRows(FULL_ROWS, changed)).toBe(false)
    expect(sameRows(rows, FULL_ROWS)).toBe(false)
  })

  it('snapshotAt: maçtan önceki son görüntü; maçtan sonra yapıştırılan hiç dönmez', () => {
    const history: LeagueTableSnapshot[] = [nextSnapshot([], at('2026-10-08T09:00:00.000Z', changed)), nextSnapshot([], at('2026-10-05T09:00:00.000Z'))]
    expect(snapshotAt(history, LEAGUE, new Date('2026-10-07T17:00:00.000Z'))?.pastedAt).toBe('2026-10-05T09:00:00.000Z')
    expect(snapshotAt(history, LEAGUE, new Date('2026-10-09T17:00:00.000Z'))?.rows[0].played).toBe(6)
    expect(snapshotAt(history, LEAGUE, new Date('2026-10-05T09:00:00.000Z'))).toBeNull()
    expect(snapshotAt(history, LEAGUE, new Date('2026-10-04T17:00:00.000Z'))).toBeNull()
    expect(snapshotAt(history, 'Başka Lig', new Date('2026-10-09T17:00:00.000Z'))).toBeNull()
  })

  it('seedSnapshots: yalnızca geçmişi olmayan ligler için görüntü üretir', () => {
    const other: LeagueTable = { id: 'Başka', league: 'Başka', pastedAt: '2026-10-01T09:00:00.000Z', rows }
    const existing = nextSnapshot([], at('2026-10-05T09:00:00.000Z'))
    expect(seedSnapshots([at('2026-10-08T09:00:00.000Z'), other], [existing]).map((s) => s.id)).toEqual(['Başka|2026-10-01T09:00:00.000Z'])
  })
})

describe('admin kartı: açılır satır ve "tablo eski olabilir"', () => {
  const fullTable: LeagueTable = { id: LEAGUE, league: LEAGUE, pastedAt: '2026-10-05T09:00:00.000Z', rows: FULL_ROWS }
  // Maç 7 Ekim 20:00 (TSİ) = 17:00 UTC
  const before = new Date('2026-10-07T09:00:00.000Z')
  const after = new Date('2026-10-07T17:00:00.000Z')
  const game = (stats: Record<string, number>, time: string | null = '20:00'): Match =>
    makeMatch({ over25Pct: 90, ...stats }, { home: 'Kuzey Yıldızı', away: 'Güney Spor', league: LEAGUE, date: '2026-10-07', time: time ?? undefined })
  const flags = (match: Match, now: Date, tables = [fullTable]) => {
    const s = matchStandings(match, [match], tables, [], now)
    return [s.home?.detail?.maybeOld, s.away?.detail?.maybeOld]
  }

  it('açılır satır: Last 5 (ham), attığı–yediği gol, CS; sütunlar yoksa satır yok', () => {
    expect(detailText(FULL_ROWS[0])).toBe('WWWWW · 13–5 · CS %40')
    expect(detailText({ ...rows[0], last5: 'WD' })).toBe('WD')
    expect(detailText(rows[0])).toBeNull()
    const match = game({})
    expect(matchStandings(match, [match], [fullTable], [], before).away?.detail).toEqual({ text: 'WLDWW · 9–9 · CS %60', maybeOld: false, gameWeek: null })
    expect(matchStandings(match, [match], [table()], [], before).home?.detail?.text).toBeNull()
  })

  it('tablo PPG ile CSV genel PPG farklıysa işaretlenir; 0,01 tolerans', () => {
    expect(ppgDiffers(0.25, 0.4)).toBe(true)
    expect(ppgDiffers(1.6, 1.6)).toBe(false)
    expect(ppgDiffers(1.6, 1.61)).toBe(false)
    expect(ppgDiffers(1.6, 1.62)).toBe(true)
    expect(ppgDiffers(null, 1.6)).toBe(false)
    expect(ppgDiffers(1.6, null)).toBe(false)
    // Tabloda ev 3.00, deplasman 2.00
    expect(flags(game({ homeOverallPpg: 3, awayOverallPpg: 2 }), before)).toEqual([false, false])
    expect(flags(game({ homeOverallPpg: 2.5, awayOverallPpg: 2 }), before)).toEqual([true, false])
    expect(flags(game({ homeOverallPpg: 3, awayOverallPpg: 2.2 }), before)).toEqual([false, true])
    // CSV'de değer yoksa işaret yok
    expect(flags(game({ awayOverallPpg: 2.2 }), before)).toEqual([false, true])
    expect(flags(game({}), before)).toEqual([false, false])
  })

  it('eski yüklemede değer CSV başlığıyla saklıdır; yine okunur', () => {
    const match = game({ 'Home Team Overall Points Per Game (Pre-Match)': 2.5, 'Game Week': 6 })
    const standings = matchStandings(match, [match], [fullTable], [], before)
    expect(standings.home?.detail).toMatchObject({ maybeOld: true, gameWeek: 6 })
  })

  it('yalnızca henüz başlamamış maçta: başlamış maçta ve saati bilinmeyen maçta işaret çıkmaz', () => {
    const stale = { homeOverallPpg: 2.5, awayOverallPpg: 1 }
    expect(flags(game(stale), before)).toEqual([true, true])
    expect(flags(game(stale), after)).toEqual([false, false])
    expect(flags(game(stale, null), before)).toEqual([false, false])
  })

  it('lig turu yalnızca bilgidir: 0 ya da yoksa null, uyarı üretmez; 7 gün kuralı değişmez', () => {
    const info = (stats: Record<string, number>) => matchStandings(game(stats), [], [fullTable], [], before).home!
    expect(info({ gameWeek: 8 }).detail).toMatchObject({ gameWeek: 8, maybeOld: false })
    expect(info({ gameWeek: 0 }).detail?.gameWeek).toBeNull()
    expect(info({}).detail?.gameWeek).toBeNull()
    expect(info({ homeOverallPpg: 1 })).toMatchObject({ stale: false, ageDays: 2, text: 'Ligde 1. sıra · 5 maç · tablo 2 gün önce' })
  })
})

describe('koruma: ek sütunlar ve yeni CSV alanları analize, prompt\'a ve üye paketine girmez', () => {
  it('üye paketi tablo ek sütunlarıyla ve onlarsız birebir aynıdır', () => {
    const input = memberInput()
    expect(input.leagueTables.length).toBeGreaterThan(0)
    const extras = { won: 3, drawn: 1, lost: 1, goalsFor: 9, goalsAgainst: 7, goalDiff: 2, last5: 'WWDLW', cs: 40, btts: 60, xgf: 1.5, cards: 4, corners: 9, over15: 80, over25: 60, avgGoals: 3.2 }
    const enriched = input.leagueTables.map((t) => ({ ...t, rows: t.rows.map((r) => ({ ...r, ...extras })) }))
    const plain = JSON.stringify(buildMemberPayload(input))
    expect(JSON.stringify(buildMemberPayload({ ...input, leagueTables: enriched }))).toBe(plain)
    expect(plain).toMatch(/"homeStanding":\{/)
    expect(plain).not.toMatch(/last5|maybeOld|goalsFor|avgGoals|gameWeek|OverallPpg/)
  })

  it('analiz ve prompt, genel PPG ve lig turu alanlarıyla ve onlarsız aynıdır', () => {
    const base = { over25Pct: 90, bttsPct: 85, over15Pct: 95, homePpg: 2, awayPpg: 1 }
    const outcome = (stats: Record<string, number>) => {
      const match = makeMatch(stats, { id: 'koruma', home: 'Kuzey Yıldızı', away: 'Güney Spor', league: LEAGUE })
      const analysis = analyzeDay([match], defaultThresholds())
      const lists = Object.fromEntries(Object.entries(analysis).map(([id, list]) => [id, list.predictions.map(({ match: _match, ...rest }) => rest)]))
      return { lists: JSON.stringify(lists), prompt: buildPrompts(collectAiMatches(analysis), 'chatgpt', '6 Ekim 2026 Salı').map((c) => c.text) }
    }
    expect(outcome({ ...base, homeOverallPpg: 0.4, awayOverallPpg: 2.9, gameWeek: 8 })).toEqual(outcome(base))
  })
})
