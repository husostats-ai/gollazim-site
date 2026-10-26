import { describe, expect, it } from 'vitest'
import { AI_PROMPT_VERSION, AI_PROVIDERS, promptVersionOf } from '../../config/ai'
import { defaultThresholds } from '../../config/categories'
import type { AiVerdict, LeagueTableRow, LeagueTableSnapshot, Match, TeamAlias } from '../../types'
import { analyzeDay } from '../analysis/engine'
import { makeMatch } from '../analysis/testUtils'
import { aliasId, NOT_IN_TABLE } from '../league/matching'
import { verifiedTableRows } from '../league/standing'
import { collectAiMatches, withTableRows } from './collect'
import { buildPrompts, TABLE_BLOCKED, TABLE_MISSING } from './prompt'

// AI ANALİZİ prompt'undaki "Lig tablosu" satırı: kaynak maçtan önceki son görüntü ve dört engel kuralı
// (verifiedTableRows). Engelli, eski, doğrulanamayan ya da eşleşmeyen tablo için hiçbir sayı yazılmaz.

const LEAGUE = 'Testland · Deneme Ligi'
// Maç 7 Ekim 20:00 (TSİ). Tabloda ev PPG 2.00 (5 maç), deplasman 1.00 (6 maç).
const FULL: LeagueTableRow[] = [
  { team: 'Kuzey Yıldızı', rank: 2, played: 5, points: 10, ppg: 2, won: 3, drawn: 1, lost: 1, goalsFor: 9, goalsAgainst: 5, goalDiff: 4, last5: 'WWDLW', cs: 40 },
  { team: 'Güney Spor', rank: 11, played: 6, points: 6, ppg: 1, won: 1, drawn: 3, lost: 2, goalsFor: 6, goalsAgainst: 8, goalDiff: -2, last5: 'LDDWD', cs: 17 },
]
/** Gol sütunu (ve formu) olmayan lig: China League One, Veikkausliiga, Qatar Stars League gibi */
const BARE: LeagueTableRow[] = FULL.map(({ team, rank, played, points, ppg }) => ({ team, rank, played, points, ppg }))
const snap = (rows: LeagueTableRow[], pastedAt = '2026-10-05T09:00:00.000Z'): LeagueTableSnapshot => ({ id: `${LEAGUE}|${pastedAt}`, league: LEAGUE, pastedAt, rows })
const OK = { homeOverallPpg: 2, awayOverallPpg: 1 }
const game = (stats: Record<string, number> = OK, overrides: Partial<Match> = {}): Match =>
  makeMatch({ over25Pct: 90, ...stats }, { id: 'tablo-mac', home: 'Kuzey Yıldızı', away: 'Güney Spor', league: LEAGUE, date: '2026-10-07', time: '20:00', ...overrides })

function promptText(match: Match, snapshots: LeagueTableSnapshot[], aliases: TeamAlias[] = [], provider: (typeof AI_PROVIDERS)[number]['id'] = 'chatgpt'): string {
  const items = withTableRows(collectAiMatches(analyzeDay([match], defaultThresholds())), [match], snapshots, aliases)
  return buildPrompts(items, provider, '7 Ekim 2026 Çarşamba').map((c) => c.text).join('\n')
}
const tableLineOf = (text: string): string => text.split('\n').find((l) => l.startsWith('Lig tablosu: '))!

describe('prompt: doğrulanmış tablo satırı', () => {
  it('sıra, oynanan maç, puan ve G/B/M formu yazılır; başka tablo sütunu yazılmaz', () => {
    expect(tableLineOf(promptText(game(), [snap(FULL)]))).toBe(
      'Lig tablosu: ev 2. sıra, 5 maç, 10 puan, form (eskiden yeniye) G G B M G ; deplasman 11. sıra, 6 maç, 6 puan, form (eskiden yeniye) M B B G B',
    )
  })

  it('satır "Piyasa" satırından sonra, "Değerlendir" satırından hemen önce gelir', () => {
    const lines = promptText(game(), [snap(FULL)]).split('\n')
    const at = lines.findIndex((l) => l.startsWith('Lig tablosu: '))
    expect(lines[at + 1]).toMatch(/^Değerlendir: /)
  })

  it('form yoksa ya da tanınmayan harf varsa form kısmı yazılmaz; sıra/maç/puan yine yazılır', () => {
    const noForm = FULL.map(({ last5: _l, ...r }) => r)
    expect(tableLineOf(promptText(game(), [snap(noForm)]))).toBe('Lig tablosu: ev 2. sıra, 5 maç, 10 puan ; deplasman 11. sıra, 6 maç, 6 puan')
    const odd = FULL.map((r) => ({ ...r, last5: 'WW?L' }))
    expect(tableLineOf(promptText(game(), [snap(odd)]))).not.toMatch(/form/)
  })
})

describe('prompt: engelli, eski ya da doğrulanamayan tabloda hiçbir sayı yazılmaz', () => {
  const blockedLine = `Lig tablosu: ev ${TABLE_BLOCKED} ; deplasman ${TABLE_BLOCKED}`
  const cases: [string, Match, LeagueTableSnapshot[], string][] = [
    ['ppg-differs', game({ homeOverallPpg: 1.5, awayOverallPpg: 1.5 }), [snap(FULL)], 'ppg-differs'],
    ['round-mismatch (tablo MP > tur − 1)', game({ homeOverallPpg: 1.5, awayOverallPpg: 1.5, gameWeek: 2 }), [snap(FULL)], 'round-mismatch'],
    ['unverifiable (CSV genel PPG yok)', game({}), [snap(FULL)], 'unverifiable'],
    ['unverifiable (tablo PPG yok)', game(), [snap(FULL.map((r) => ({ ...r, ppg: null })))], 'unverifiable'],
    ['old-snapshot (maçtan 7 günden eski)', game(), [snap(FULL, '2026-09-29T09:00:00.000Z')], 'old-snapshot'],
  ]
  it.each(cases)('%s', (_name, match, snapshots, reason) => {
    expect(verifiedTableRows(match, [match], snapshots, []).home?.blocked).toBe(reason)
    const line = tableLineOf(promptText(match, snapshots))
    expect(line).toBe(blockedLine)
    expect(line).not.toMatch(/\d/)
  })

  it('tek taraf engelliyse yalnızca o taraf sayısız kalır', () => {
    const line = tableLineOf(promptText(game({ homeOverallPpg: 2, awayOverallPpg: 1.6 }), [snap(FULL)]))
    expect(line).toBe(`Lig tablosu: ev 2. sıra, 5 maç, 10 puan, form (eskiden yeniye) G G B M G ; deplasman ${TABLE_BLOCKED}`)
  })

  it('tablo verisi yok: görüntü yok, yalnızca maçtan sonra yapıştırılmış görüntü, takım tabloda yok, saat yok', () => {
    const missing = `Lig tablosu: ev ${TABLE_MISSING} ; deplasman ${TABLE_MISSING}`
    expect(tableLineOf(promptText(game(), []))).toBe(missing)
    expect(tableLineOf(promptText(game(), [snap(FULL, '2026-10-07T17:00:00.000Z')]))).toBe(missing)
    expect(tableLineOf(promptText(game({ ...OK }, { time: undefined }), [snap(FULL)]))).toBe(missing)
    const absent = [{ id: aliasId(LEAGUE, 'Kuzey Yıldızı'), league: LEAGUE, csvTeam: 'Kuzey Yıldızı', tableTeam: NOT_IN_TABLE }]
    expect(tableLineOf(promptText(game(), [snap(FULL)], absent))).toMatch(new RegExp(`^Lig tablosu: ev ${TABLE_MISSING} ; deplasman 11\\. sıra`))
  })

  it('withTableRows verilmeden kurulan prompt da satırı taşır ama sayı yazmaz', () => {
    const [chunk] = buildPrompts(collectAiMatches(analyzeDay([game()], defaultThresholds())), 'chatgpt', '7 Ekim 2026 Çarşamba')
    expect(tableLineOf(chunk.text)).toBe(`Lig tablosu: ev ${TABLE_MISSING} ; deplasman ${TABLE_MISSING}`)
  })
})

describe('prompt: gol sütunu olmayan ligler (form satırı yok, sıra/maç/puan var)', () => {
  it('doğrulanmış satır formsuz yazılır; kart ve üye paketindeki form satırı yine yoktur', () => {
    expect(tableLineOf(promptText(game(), [snap(BARE)]))).toBe('Lig tablosu: ev 2. sıra, 5 maç, 10 puan ; deplasman 11. sıra, 6 maç, 6 puan')
  })

  it('ppg-differs ve round-mismatch bu liglerde de çalışır', () => {
    const differs = game({ homeOverallPpg: 1.5, awayOverallPpg: 1 })
    expect(verifiedTableRows(differs, [differs], [snap(BARE)], []).home?.blocked).toBe('ppg-differs')
    expect(tableLineOf(promptText(differs, [snap(BARE)]))).toBe(`Lig tablosu: ev ${TABLE_BLOCKED} ; deplasman 11. sıra, 6 maç, 6 puan`)
    const mismatch = game({ homeOverallPpg: 1.5, awayOverallPpg: 1, gameWeek: 3 })
    expect(verifiedTableRows(mismatch, [mismatch], [snap(BARE)], []).home?.blocked).toBe('round-mismatch')
    expect(tableLineOf(promptText(mismatch, [snap(BARE)]))).toMatch(new RegExp(`^Lig tablosu: ev ${TABLE_BLOCKED} ;`))
    // PPG farkı tur tutarlılığıyla açıklanıyorsa (MP = tur − 1) satır doğrulanır.
    const consistent = game({ homeOverallPpg: 1.5, awayOverallPpg: 1, gameWeek: 6 })
    expect(verifiedTableRows(consistent, [consistent], [snap(BARE)], []).home?.blocked).toBeNull()
    // unverifiable ve old-snapshot da geçerlidir.
    expect(tableLineOf(promptText(game({}), [snap(BARE)]))).toBe(`Lig tablosu: ev ${TABLE_BLOCKED} ; deplasman ${TABLE_BLOCKED}`)
    expect(tableLineOf(promptText(game(), [snap(BARE, '2026-09-29T09:00:00.000Z')]))).toBe(`Lig tablosu: ev ${TABLE_BLOCKED} ; deplasman ${TABLE_BLOCKED}`)
  })
})

describe('prompt: kurallar ve sağlayıcılar', () => {
  it('KURALLAR\'a lig tablosu maddesi ve G/B/M açıklaması bir kez eklenir', () => {
    const text = promptText(game(), [snap(FULL)])
    const rules = text.slice(text.indexOf('KURALLAR'), text.indexOf('GÖREV'))
    expect(rules.match(/"Lig tablosu" satırı sitenin kendi doğrulanmış lig tablosundan/g)).toHaveLength(1)
    expect(text.match(/G galibiyet, B beraberlik, M mağlubiyet/g)).toHaveLength(1)
    expect(rules).toMatch(/çelişirse kaynağını gerekçede yaz/)
  })

  it('üç yapay zekâya giden prompt yalnızca sondaki arama yönergesinde farklıdır', () => {
    const texts = AI_PROVIDERS.map((p) => promptText(game(), [snap(FULL)], [], p.id))
    const strip = (t: string, i: number) => t.replace(AI_PROVIDERS[i].instruction, '<YÖNERGE>')
    expect(new Set(texts.map(strip)).size).toBe(1)
    texts.forEach((t, i) => expect(t.trimEnd().endsWith(AI_PROVIDERS[i].instruction)).toBe(true))
  })
})

describe('promptVersion', () => {
  const verdict: AiVerdict = { id: 'm|chatgpt', matchId: 'm', date: '2026-10-07', provider: 'chatgpt', byCategory: { over25: 'medium' }, reason: '', risk: '', savedAt: '2026-10-07T10:00:00.000Z', promptKind: 'csv' }
  it('alanı olmayan eski kayıt csv-v1 sayılır; yazılmış sürüm olduğu gibi okunur; güncel sürüm csv-v2', () => {
    expect(promptVersionOf(verdict)).toBe('csv-v1')
    expect(promptVersionOf({ ...verdict, promptVersion: 'csv-v2' })).toBe('csv-v2')
    expect(promptVersionOf({ promptVersion: 'csv-v1' })).toBe('csv-v1')
    expect(AI_PROMPT_VERSION).toBe('csv-v2')
  })
})
