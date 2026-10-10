import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { isCategoryId } from '../../config/categories'
import { DEFAULT_MEMBER_TEXTS } from '../../config/memberTexts'
import type { Highlight, StreakStep } from '../../types'
import { normalizeStreakSteps, streakStepId } from '../streak/streak'
import { toAppDateTime } from '../../utils/date'
import { isBackupFile } from '../data/backupFormat'
import { highlightId, normalizeHighlights } from '../highlights/highlights'
import { deriveMemberKeys, fromBase64, generatePassword, newSiteSalt, openEnvelope, randomBytes, sealPayload, toBase64, type MemberKeys } from './crypto'
import { draftPublication } from '../memberAdmin/publish'
import type { MemberPayload } from './payload'
import { assertMemberPayload } from './schema'

// Geliştirme aracı, normal test çalıştırmasında atlanır. Üye sayfasını yerelde denemek
// için JSON yedekten ŞİFRELİ bir örnek yayın paketi ve sentetik bir test kullanıcısı üretir:
//
//   UYE_ORNEK=samples/uye UYE_BACKUP=samples/gollazim-yedek-….json npm run uye:ornek
//
// Çıktı (samples/ repoya girmez): paket.json ve giris.json (test kullanıcısının adı,
// şifresi ve site tuzu; sonraki çalıştırmalarda aynı kullanıcı kullanılır).
// İsteğe bağlı: UYE_ONE_CIKAN (gün başına sentetik öne çıkan sayısı), UYE_SERI (sentetik seri adımı sayısı), UYE_SURUM=7 (eski biçimde paket), UYE_N (yayın no), UYE_AT (yayın anı, ISO), UYE_DOSYA (paket dosya adı),
// UYE_CIKAR=1 (test kullanıcısı pakete eklenmez: erişimi kaldırılmış üye denemesi).

it.runIf(process.env.UYE_ORNEK && process.env.UYE_BACKUP)(
  'örnek şifreli paket',
  async () => {
    const outDir = process.env.UYE_ORNEK!
    const backup: unknown = JSON.parse(readFileSync(process.env.UYE_BACKUP!, 'utf8'))
    if (!isBackupFile(backup)) throw new Error('UYE_BACKUP bir GOLLAZIM yedeği değil.')
    mkdirSync(outDir, { recursive: true })

    const loginFile = join(outDir, 'giris.json')
    const login = existsSync(loginFile)
      ? (JSON.parse(readFileSync(loginFile, 'utf8')) as { username: string; password: string; siteSalt: string })
      : { username: 'deneme', password: generatePassword(), siteSalt: toBase64(newSiteSalt()) }
    writeFileSync(loginFile, JSON.stringify(login, null, 1) + '\n')
    const siteSalt = fromBase64(login.siteSalt, 'siteSalt', 16)

    const day = toAppDateTime(new Date(backup.exportedAt)).date
    // Yedekteki öne çıkan seçimler; UYE_ONE_CIKAN=N verilirse ayrıca her günün dondurulmuş
    // önerilerinden ilk N tanesi sentetik seçim olarak eklenir (yedekte seçim yokken denemek için).
    const extra = Number(process.env.UYE_ONE_CIKAN ?? 0)
    const synthetic: Highlight[] = [...new Set(backup.picks.map((p) => p.date))].flatMap((date) =>
      backup.picks
        .filter((p) => p.date === date)
        .slice(0, extra)
        .flatMap((p): Highlight[] => {
          const match = backup.matches.find((m) => m.id === p.matchId)
          return match?.time ? [{ id: highlightId(date, p.matchId, p.categoryId), date, matchId: p.matchId, categoryId: p.categoryId, addedAt: `${date}T03:00:00.000Z`, home: match.home, away: match.away, time: match.time, ...(match.league !== undefined && { league: match.league }), percent: p.percent }] : []
        }),
    )
    const highlights = [...normalizeHighlights(backup.highlights, isCategoryId), ...synthetic]
    // Yedekteki seri adımları; UYE_SERI=N verilirse ayrıca dondurulmuş önerilerden N sentetik adım eklenir.
    const streakExtra = Number(process.env.UYE_SERI ?? 0)
    const streakSteps: StreakStep[] = [
      ...normalizeStreakSteps(backup.streakSteps, isCategoryId),
      ...backup.picks
        .filter((p) => p.outcome === 'won' || p.outcome === 'lost')
        .flatMap((p): StreakStep[] => {
          const match = backup.matches.find((m) => m.id === p.matchId)
          return match?.time ? [{ id: streakStepId(p.matchId, p.categoryId), matchId: p.matchId, categoryId: p.categoryId, seq: 0, addedAt: `${p.date}T03:00:00.000Z`, date: p.date, home: match.home, away: match.away, time: match.time, ...(match.league !== undefined && { league: match.league }) }] : []
        })
        .slice(0, streakExtra)
        .map((step, i) => ({ ...step, seq: 1000 + i })),
    ]
    // Admin'deki "Yayınla" ile aynı kurucu: seçilen gün + önerisi ya da öne çıkanı olan önceki 6 gün.
    const { payload } = await draftPublication(
      {
        listMatchesByDate: async (date) => backup.matches.filter((m) => m.date === date),
        listResultsByMatchIds: async (ids) => backup.results.filter((r) => ids.includes(r.matchId)),
        listPicks: async () => backup.picks,
        listShared: async () => backup.sharedPicks ?? [],
        listHighlightsByDate: async (date) => highlights.filter((h) => h.date === date),
        markHighlightsPublished: async () => undefined,
        listAiVerdictsByDate: async (date) => (backup.aiVerdicts ?? []).filter((v) => v.date === date),
        recordAiShares: async () => undefined,
        listStreakSteps: async () => streakSteps,
        listMatchesByIds: async (ids) => backup.matches.filter((m) => ids.includes(m.id)),
        markStreakPublished: async () => undefined,
        listLeagueTables: async () => backup.leagueTables ?? [],
        listAliases: async () => backup.teamAliases ?? [],
        getThresholds: async () => backup.thresholds,
        getMarketConflictLimit: async () => backup.marketConflictLimit ?? 25,
      },
      { day, n: Number(process.env.UYE_N ?? 1), publishedAt: process.env.UYE_AT ?? new Date().toISOString(), texts: DEFAULT_MEMBER_TEXTS },
    )

    // UYE_SURUM=7: seri takibi alanı olmayan eski biçimde paket (üye sitesinin eski paketi açtığını denemek için).
    const sealed: MemberPayload = process.env.UYE_SURUM === '7' ? (({ streak: _streak, ...rest }) => ({ ...rest, v: 7 }))(payload) : payload
    assertMemberPayload(sealed)

    const keys = await deriveMemberKeys({ username: login.username, password: login.password, siteSalt })
    const others: MemberKeys[] = Array.from({ length: 49 }, () => ({ kek: randomBytes(32), idKey: randomBytes(32) }))
    const envelope = await sealPayload({ payload: sealed, members: process.env.UYE_CIKAR ? others : [...others, keys], siteSalt })
    writeFileSync(join(outDir, process.env.UYE_DOSYA ?? 'paket.json'), JSON.stringify(envelope))

    if (!process.env.UYE_CIKAR) expect((await openEnvelope(envelope, login.username, login.password)).payload).toEqual(sealed)
  },
  120_000,
)
