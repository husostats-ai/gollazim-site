import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isCategoryId } from '../../config/categories'
import { DEFAULT_MEMBER_TEXTS } from '../../config/memberTexts'
import type { Highlight, Match, Pick, StreakStep } from '../../types'
import { normalizeStreakSteps, streakStepId } from '../streak/streak'
import { toAppDateTime } from '../../utils/date'
import { isBackupFile } from '../data/backupFormat'
import { highlightId, normalizeHighlights } from '../highlights/highlights'
import { deriveMemberKeys, fromBase64, generatePassword, newSiteSalt, openEnvelope, randomBytes, sealPayload, toBase64, type MemberKeys } from './crypto'
import { draftPublication } from '../memberAdmin/publish'
import type { MemberPayload } from './payload'
import { assertMemberPayload } from './schema'
import { withOldStats } from './__fixtures__/oldStats'

// Geliştirme aracı, normal test çalıştırmasında atlanır. Üye sayfasını yerelde denemek
// için JSON yedekten ŞİFRELİ bir örnek yayın paketi ve sentetik bir test kullanıcısı üretir:
//
//   UYE_ORNEK=samples/uye UYE_BACKUP=samples/gollazim-yedek-….json npm run uye:ornek
//
// Çıktı (samples/ repoya girmez): paket.json ve giris.json (test kullanıcısının adı,
// şifresi ve site tuzu; sonraki çalıştırmalarda aynı kullanıcı kullanılır).
// İsteğe bağlı: UYE_ONE_CIKAN (gün başına sentetik öne çıkan sayısı), UYE_SERI (sentetik seri adımı sayısı; verilince yedekteki seri adımları yok sayılır), UYE_SURUM=7 (eski biçimde paket), UYE_N (yayın no), UYE_AT (yayın anı, ISO), UYE_DOSYA (paket dosya adı),
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
    const streakSteps = sampleStreakSteps(backup, process.env.UYE_SERI === undefined ? null : Number(process.env.UYE_SERI))
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
        listLeagueSnapshots: async () => backup.leagueTableSnapshots ?? [],
        listAliases: async () => backup.teamAliases ?? [],
        getThresholds: async () => backup.thresholds,
        getMarketConflictLimit: async () => backup.marketConflictLimit ?? 25,
        listMatchNotes: async (ids) => (backup.matchNotes ?? []).filter((n) => ids.includes(n.matchId)),
      },
      { day, n: Number(process.env.UYE_N ?? 1), publishedAt: process.env.UYE_AT ?? new Date().toISOString(), texts: DEFAULT_MEMBER_TEXTS },
    )

    // UYE_SURUM=7: eski biçimde paket (üye sitesinin eski paketi açtığını denemek için). Sürüm 8-14'te gelen
    // alanlar çıkarılır: seri takibi (8), form satırları (9), İY 0.5 ÜST 2. yarı sayımı (10 ve 14), piyasa yüzdesi (11),
    // maç notu (13). Sürüm 12 yalnızca seri adımı durumu ekler; seri takibi zaten çıkarılır.
    const toV7 = (source: MemberPayload): MemberPayload => {
      const old = JSON.parse(JSON.stringify(source)) as MemberPayload
      old.v = 7
      delete old.streak
      for (const d of old.days) {
        for (const m of d.matches) {
          delete m.homeForm
          delete m.awayForm
          delete m.note
        }
        for (const l of d.lists) for (const i of l.items) delete i.mkt
      }
      withOldStats(old, 7)
      return old
    }
    const sealed: MemberPayload = process.env.UYE_SURUM === '7' ? toV7(payload) : payload
    assertMemberPayload(sealed)

    const keys = await deriveMemberKeys({ username: login.username, password: login.password, siteSalt })
    const others: MemberKeys[] = Array.from({ length: 49 }, () => ({ kek: randomBytes(32), idKey: randomBytes(32) }))
    const envelope = await sealPayload({ payload: sealed, members: process.env.UYE_CIKAR ? others : [...others, keys], siteSalt })
    writeFileSync(join(outDir, process.env.UYE_DOSYA ?? 'paket.json'), JSON.stringify(envelope))

    if (!process.env.UYE_CIKAR) expect((await openEnvelope(envelope, login.username, login.password)).payload).toEqual(sealed)
  },
  120_000,
)

/**
 * Örnek paketin seri adımları. extra = null (UYE_SERI verilmedi): yedekteki gerçek adımlar aynen.
 * extra = N (UYE_SERI=N): yedekteki adımlar YOK SAYILIR, yalnızca sonuçlanmış önerilerden N sentetik
 * adım kullanılır; böylece denemedeki toplam, yedekte seri olsa da olmasa da tam N olur.
 */
function sampleStreakSteps(backup: { picks: Pick[]; matches: Match[]; streakSteps?: unknown }, extra: number | null): StreakStep[] {
  if (extra === null) return normalizeStreakSteps(backup.streakSteps, isCategoryId)
  return backup.picks
    .filter((p) => p.outcome === 'won' || p.outcome === 'lost')
    .flatMap((p): StreakStep[] => {
      const match = backup.matches.find((m) => m.id === p.matchId)
      return match?.time ? [{ id: streakStepId(p.matchId, p.categoryId), matchId: p.matchId, categoryId: p.categoryId, seq: 0, addedAt: `${p.date}T03:00:00.000Z`, date: p.date, home: match.home, away: match.away, time: match.time, ...(match.league !== undefined && { league: match.league }) }] : []
    })
    .slice(0, extra)
    .map((step, i) => ({ ...step, seq: 1000 + i }))
}

describe('örnek paketin seri adımları', () => {
  // 10 sonuçlanmış öneri (5 tuttu, 5 tutmadı) ve aynı maçlardan 6 gerçek seri adımı olan küçük bir yedek
  const matches = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, date: '2026-10-16', time: `1${i}:00`, home: `Ev ${i}`, away: `Dep ${i}`, league: 'Testland · Lig' }) as Match)
  const picks = matches.map((m, i) => ({ id: `${m.id}|over25`, matchId: m.id, categoryId: 'over25', date: m.date, percent: 80, threshold: 75, outcome: i % 2 ? 'lost' : 'won', frozenAt: '2026-10-16T20:00:00.000Z' }) as Pick)
  const real: StreakStep[] = matches.slice(0, 6).map((m, i) => ({ id: streakStepId(m.id, 'over25'), matchId: m.id, categoryId: 'over25', seq: i + 1, addedAt: '2026-10-16T08:00:00.000Z', date: m.date, home: m.home, away: m.away, time: m.time! }))
  const backup = { picks, matches, streakSteps: real }

  it('UYE_SERI verilince yedekteki gerçek adımlar yok sayılır; toplam tam N (8) olur', () => {
    const steps = sampleStreakSteps(backup, 8)
    expect(steps).toHaveLength(8)
    expect(steps.every((s) => s.seq >= 1000)).toBe(true)
    expect(steps.map((s) => s.seq)).toEqual([1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007])
  })

  it('UYE_SERI verilmeyince yedekteki gerçek adımlar aynen korunur, sentetik adım eklenmez', () => {
    const steps = sampleStreakSteps(backup, null)
    expect(steps).toHaveLength(6)
    expect(steps.map((s) => s.seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
  })
})
