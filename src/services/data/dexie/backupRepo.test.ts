import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { AI_PROVIDERS } from '../../../config/ai'
import { defaultThresholds } from '../../../config/categories'
import { DEFAULT_STORY_TEXTS } from '../../../config/storyTexts'
import type { BackupFile, LeagueTableRow } from '../../../types'
import { highlightId } from '../../highlights/highlights'
import { aliasId } from '../../league/matching'
import { selectionId } from '../../story/selection'
import { sharedId } from '../../story/shared'
import { streakStepId } from '../../streak/streak'
import { assembleBackup } from '../backupFormat'
import { backupRepo } from './backupRepo'
import { db } from './db'
import { LAST_BACKUP_KEY } from './settingsRepo'

// Yedeğin dışa → içe → dışa aktarımı GERÇEK Dexie şemasıyla (bellekteki IndexedDB: fake-indexeddb).
// Her tablo en az bir kayıtla doldurulur; içe aktarılan yedeğin yeniden dışa aktarımı birebir aynı olmalı.

const DAY = '2026-10-15'
const MATCH = `${DAY}|aston-villa|viking`
const LEAGUE = 'Europe · UEFA Champions League'
const row = (team: string, rank: number): LeagueTableRow => ({ team, rank, played: 2, points: 6 - rank, ppg: (6 - rank) / 2, won: 2, drawn: 0, lost: 0, goalsFor: 5, goalsAgainst: 1, goalDiff: 4, last5: 'WW', cs: 50 })

function fullBackup(): BackupFile {
  const thresholds = { ...defaultThresholds(), over25: 81 }
  return assembleBackup(
    {
      uploads: [{ id: 'u1', fileName: 'gun.csv', uploadedAt: '2026-10-15T05:00:00.000Z', matchCount: 1 }],
      matches: [{ id: MATCH, uploadId: 'u1', date: DAY, time: '22:00', league: LEAGUE, home: 'Aston Villa', away: 'Viking', stats: { over25Pct: 100, homeXg: 2.26, awayXg: 1.14, link: 'x' } }],
      results: [{ matchId: MATCH, status: 'completed', htHome: 1, htAway: 0, ftHome: 3, ftAway: 1, cornersHome: 7, cornersAway: 2, cardsHome: 1, cardsAway: 3, updatedAt: '2026-10-15T21:00:00.000Z' }],
      picks: [{ id: `${MATCH}|over25`, matchId: MATCH, categoryId: 'over25', date: DAY, percent: 100, threshold: 75, outcome: 'won', frozenAt: '2026-10-15T21:00:00.000Z', reliability: 'low', conflict: true, secondPercent: 66, modelSource: 'xg', marketPercent: 'none', marketConflict: 'none', stars: 3, modelDrift: 'none', sampleAtFreeze: 5, rankAtFreeze: 2, appCommit: 'abc1234', statsUploadedAt: '2026-10-15T05:00:00.000Z' }],
      thresholds,
      aiVerdicts: [{ id: `${MATCH}|chatgpt`, matchId: MATCH, date: DAY, provider: 'chatgpt', byCategory: { over25: 'strong' }, asked: ['over25'], reason: 'gerekçe', risk: 'risk', savedAt: '2026-10-15T08:00:00.000Z' }],
      aiPrompts: [{ id: `${DAY}|chatgpt|1`, date: DAY, provider: 'chatgpt', createdAt: '2026-10-15T07:00:00.000Z', matchIds: [MATCH], categories: [['over25']] }],
      storyTexts: { ...DEFAULT_STORY_TEXTS },
      marketConflictLimit: 20,
      storySelections: [{ id: selectionId(DAY, 'over25'), date: DAY, categoryId: 'over25', matchIds: [MATCH] }],
      sharedPicks: [{ id: sharedId(DAY, 'over25', MATCH, '2026-10-15T09:00:00.000Z'), date: DAY, categoryId: 'over25', matchId: MATCH, sharedAt: '2026-10-15T09:00:00.000Z', afterKickoff: false }],
      leagueTables: [{ id: LEAGUE, league: LEAGUE, pastedAt: '2026-10-14T04:25:00.000Z', rows: [row('Aston Villa', 1), row('Viking', 2)] }],
      teamAliases: [{ id: aliasId(LEAGUE, 'Viking'), league: LEAGUE, csvTeam: 'Viking', tableTeam: 'Viking FK' }],
      leagueTableSnapshots: [{ id: `${LEAGUE}|2026-10-14T04:25:00.000Z`, league: LEAGUE, pastedAt: '2026-10-14T04:25:00.000Z', lastSeenAt: '2026-10-15T04:00:00.000Z', rows: [row('Aston Villa', 1), row('Viking', 2)] }],
      highlights: [{ id: highlightId(DAY, MATCH, 'over25'), date: DAY, matchId: MATCH, categoryId: 'over25', addedAt: '2026-10-15T09:30:00.000Z', home: 'Aston Villa', away: 'Viking', time: '22:00', league: LEAGUE, percent: 100, reliability: 'low', publishedAt: '2026-10-15T10:00:00.000Z' }],
      aiShares: [{ id: MATCH, matchId: MATCH, date: DAY, firstN: 1, firstAt: '2026-10-15T10:00:00.000Z', lastN: 2, lastAt: '2026-10-15T12:00:00.000Z', votes: AI_PROVIDERS.map((p) => ({ provider: p.id, decision: 'strong' as const })), count: AI_PROVIDERS.length, decision: 'strong' }],
      streakSteps: [{ id: streakStepId(MATCH, 'over25'), matchId: MATCH, categoryId: 'over25', seq: 1, addedAt: '2026-10-15T09:45:00.000Z', date: DAY, home: 'Aston Villa', away: 'Viking', time: '22:00', league: LEAGUE, publishedAt: '2026-10-15T10:00:00.000Z', lastOutcome: 'won' }],
    },
    new Date('2026-10-16T06:00:00.000Z'),
  )
}

/** Karşılaştırma: yedeğin zamanı ve tablo içi sıra dışında her şey */
const content = (backup: BackupFile) => {
  const { exportedAt: _exportedAt, ...rest } = backup
  return Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, Array.isArray(value) ? [...value].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : value]))
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})
afterAll(() => db.close())

describe('yedek gidiş-dönüş (gerçek Dexie şeması, bellekte IndexedDB)', () => {
  it('her tablosu dolu bir yedek içe aktarılıp yeniden dışa aktarılınca birebir aynıdır', async () => {
    const original = fullBackup()
    // Fikstür gerçekten her alanı dolduruyor: boş bir tablo gidiş-dönüşü sınamaz.
    for (const [key, value] of Object.entries(original)) if (Array.isArray(value)) expect(value.length, key).toBeGreaterThan(0)
    expect(Object.keys(original).sort()).toEqual(['aiPrompts', 'aiShares', 'aiVerdicts', 'app', 'exportedAt', 'highlights', 'leagueTableSnapshots', 'leagueTables', 'marketConflictLimit', 'matches', 'picks', 'results', 'sharedPicks', 'storySelections', 'storyTexts', 'streakSteps', 'teamAliases', 'thresholds', 'uploads', 'version'])

    await backupRepo.importAll(original)
    const first = await backupRepo.exportAll()
    expect(content(first)).toEqual(content(original))

    // İkinci tur: dışa aktarılan yedek yeniden içe aktarılınca da değişmez.
    await backupRepo.importAll(first)
    expect(content(await backupRepo.exportAll())).toEqual(content(original))
  })

  it('içe aktarma önceki veriyi tamamen değiştirir; son yedek zamanı ve üye tabloları korunur', async () => {
    await db.settings.put({ key: LAST_BACKUP_KEY, value: '2026-10-20T08:00:00.000Z' })
    await db.members.put({ username: 'ali', kek: 'k', idKey: 'i', active: true, createdAt: '2026-10-01T00:00:00.000Z' })
    await db.matches.put({ id: 'eski|a|b', uploadId: 'eski', date: '2026-10-01', home: 'A', away: 'B', stats: {} })
    await db.settings.put({ key: 'bilinmeyen', value: 1 })

    await backupRepo.importAll(fullBackup())
    expect((await db.matches.toArray()).map((m) => m.id)).toEqual([MATCH])
    expect(await db.settings.get(LAST_BACKUP_KEY)).toEqual({ key: LAST_BACKUP_KEY, value: '2026-10-20T08:00:00.000Z' })
    expect(await db.settings.get('bilinmeyen')).toBeUndefined()
    expect((await db.members.toArray()).map((m) => m.username)).toEqual(['ali'])
  })

  it('isteğe bağlı alanları olmayan eski bir yedek de açılır; eksik tablolar boş gelir', async () => {
    const { aiVerdicts: _a, aiPrompts: _p, storySelections: _s, sharedPicks: _sh, leagueTables: _l, teamAliases: _t, leagueTableSnapshots: _ls, highlights: _h, aiShares: _as, streakSteps: _st, storyTexts: _tx, marketConflictLimit: _m, ...old } = fullBackup()
    // Ölçüm kayıt alanlarından önce dondurulmuş öneri
    const oldPicks = old.picks.map(({ sampleAtFreeze: _sa, rankAtFreeze: _r, appCommit: _c, statsUploadedAt: _u, ...pick }) => pick)
    await backupRepo.importAll({ ...old, picks: oldPicks } as BackupFile)
    const exported = await backupRepo.exportAll()
    expect(exported.matches).toHaveLength(1)
    expect(exported.picks).toEqual(oldPicks)
    for (const key of ['sampleAtFreeze', 'rankAtFreeze', 'appCommit', 'statsUploadedAt']) expect(key in exported.picks[0], key).toBe(false)
    for (const key of ['aiVerdicts', 'aiPrompts', 'storySelections', 'sharedPicks', 'leagueTables', 'teamAliases'] as const) expect(exported[key], key).toEqual([])
    for (const key of ['leagueTableSnapshots', 'highlights', 'aiShares', 'streakSteps'] as const) expect(exported[key], key).toBeUndefined()
  })
})
