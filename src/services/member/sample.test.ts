import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { DEFAULT_MEMBER_TEXTS } from '../../config/memberTexts'
import { toAppDateTime } from '../../utils/date'
import { shiftDate } from '../../utils/format'
import { isBackupFile } from '../data/backupFormat'
import { deriveMemberKeys, fromBase64, generatePassword, newSiteSalt, openEnvelope, randomBytes, sealPayload, toBase64, type MemberKeys } from './crypto'
import { buildMemberPayload } from './payload'

// Geliştirme aracı, normal test çalıştırmasında atlanır. Üye sayfasını yerelde denemek
// için JSON yedekten ŞİFRELİ bir örnek yayın paketi ve sentetik bir test kullanıcısı üretir:
//
//   UYE_ORNEK=samples/uye UYE_BACKUP=samples/gollazim-yedek-….json npm run uye:ornek
//
// Çıktı (samples/ repoya girmez): paket.json ve giris.json (test kullanıcısının adı,
// şifresi ve site tuzu; sonraki çalıştırmalarda aynı kullanıcı kullanılır).
// İsteğe bağlı: UYE_N (yayın no), UYE_AT (yayın anı, ISO), UYE_DOSYA (paket dosya adı),
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
    const payload = buildMemberPayload({
      n: Number(process.env.UYE_N ?? 1),
      publishedAt: process.env.UYE_AT ?? new Date().toISOString(),
      texts: DEFAULT_MEMBER_TEXTS,
      thresholds: backup.thresholds,
      marketConflictLimit: backup.marketConflictLimit ?? 25,
      days: [day, shiftDate(day, -1)].map((date) => {
        const matches = backup.matches.filter((m) => m.date === date)
        return { date, matches, results: backup.results.filter((r) => matches.some((m) => m.id === r.matchId)) }
      }),
      leagueTables: backup.leagueTables ?? [],
      teamAliases: backup.teamAliases ?? [],
      picks: backup.picks,
      shared: backup.sharedPicks ?? [],
    })

    const keys = await deriveMemberKeys({ username: login.username, password: login.password, siteSalt })
    const others: MemberKeys[] = Array.from({ length: 49 }, () => ({ kek: randomBytes(32), idKey: randomBytes(32) }))
    const envelope = await sealPayload({ payload, members: process.env.UYE_CIKAR ? others : [...others, keys], siteSalt })
    writeFileSync(join(outDir, process.env.UYE_DOSYA ?? 'paket.json'), JSON.stringify(envelope))

    if (!process.env.UYE_CIKAR) expect((await openEnvelope(envelope, login.username, login.password)).payload).toEqual(payload)
  },
  120_000,
)
