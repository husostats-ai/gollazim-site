import { describe, expect, it } from 'vitest'
import { defaultThresholds } from '../../config/categories'
import type { BackupFile, LeagueTable, Match, TeamAlias } from '../../types'
import { collectAiMatches } from '../ai/collect'
import { buildPrompts } from '../ai/prompt'
import { analyzeDay } from '../analysis/engine'
import { makeMatch } from '../analysis/testUtils'
import { assembleBackup, isBackupFile } from '../data/backupFormat'
import { ageGroup, aliasId, findStanding, matchTeams, normalizeAliases, normalizeLeagueTables, normalizeTeam, NOT_IN_TABLE } from './matching'
import { checkRow, parseLeagueTable } from './parser'
import { matchStandings, playedHint, standingInfo, tableAgeText } from './standing'

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
  ['2.00', '60%', '40%', '2.04', '4.60', '10.00', '100%', '80%', '4.20'].join('\t'),
  line(3, 'Doğu & Batı Birliği FC', 6, 1, 2, 3, 4, 9, '-5', 5),
  'LDDWL',
  ['0.83', '20%', '40%', '1.61', '4.40', '8.00', '40%', '40%', '1.80'].join('\t'),
].join('\n')

describe('parseLeagueTable', () => {
  it('yalnızca sıra, takım adı, MP, W, D, L, GF, GA, Pts ve PPG okunur', () => {
    const { rows, errors } = parseLeagueTable(SAMPLE)
    expect(errors).toEqual([])
    expect(rows).toEqual([
      { rank: 1, team: 'Kuzey Yıldızı FC', played: 5, won: 5, drawn: 0, lost: 0, goalsFor: 13, goalsAgainst: 5, points: 15, ppg: 3 },
      { rank: 2, team: 'Güney Spor AFC', played: 5, won: 3, drawn: 1, lost: 1, goalsFor: 9, goalsAgainst: 9, points: 10, ppg: 2 },
      { rank: 3, team: 'Doğu & Batı Birliği FC', played: 6, won: 1, drawn: 2, lost: 3, goalsFor: 4, goalsAgainst: 9, points: 5, ppg: 0.83 },
    ])
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
    expect(parseLeagueTable('Merhaba\n\nbu bir tablo değil')).toEqual({ rows: [], errors: [] })
    expect(parseLeagueTable('')).toEqual({ rows: [], errors: [] })
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
