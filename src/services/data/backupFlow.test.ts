import { describe, expect, it } from 'vitest'
import { defaultThresholds } from '../../config/categories'
import type { BackupFile } from '../../types'
import { assembleBackup } from './backupFormat'
import { backupRecency, isOlderBackup, PERSISTENCE_LABELS, requestPersistence, restoreBackupFlow, saveBackupFile, type SaveTarget, type WritableLike } from './backupFlow'

const backup = (over: Partial<BackupFile> = {}, exportedAt = '2026-10-20T08:00:00.000Z'): BackupFile => ({
  ...assembleBackup({ uploads: [], matches: [], results: [], picks: [], thresholds: defaultThresholds() }, new Date(exportedAt)),
  ...over,
})
const upload = (uploadedAt: string) => ({ id: uploadedAt, fileName: 'x.csv', uploadedAt, rowCount: 1, matchCount: 1 }) as unknown as BackupFile['uploads'][number]
const match = (date: string) => ({ id: `${date}|a|b`, uploadId: 'u', date, home: 'A', away: 'B', stats: {} }) as unknown as BackupFile['matches'][number]
const result = (updatedAt: string) => ({ matchId: updatedAt, status: 'finished', updatedAt }) as unknown as BackupFile['results'][number]

/** Kaydetme yollarının sahtesi; ne olduğunu kaydeder */
function fakeTarget(mode: { picker?: 'write' | 'abort' | 'fail'; confirm?: boolean }) {
  const log: string[] = []
  const writable: WritableLike = {
    write: async (blob) => void log.push(`write:${blob.size > 0}`),
    close: async () => void log.push('close'),
  }
  const target: SaveTarget = {
    pickFile:
      mode.picker === undefined
        ? undefined
        : async (name) => {
            log.push(`pick:${name}`)
            if (mode.picker === 'abort') throw Object.assign(new Error('iptal'), { name: 'AbortError' })
            if (mode.picker === 'fail') throw new Error('disk dolu')
            return writable
          },
    download: (name) => void log.push(`download:${name}`),
    confirmSaved: (name) => {
      log.push(`confirm:${name}`)
      return mode.confirm ?? false
    },
  }
  return { target, log }
}

describe('yedek kaydetme: son yedek zamanı yalnızca yazma kesinleşince', () => {
  it('dosya penceresiyle yazılınca kaydedilir; zaman yedeğin anıdır', async () => {
    const { target, log } = fakeTarget({ picker: 'write' })
    const marked: string[] = []
    expect(await saveBackupFile(backup(), 'y.json', target, async (at) => void marked.push(at))).toBe('saved')
    expect(log).toEqual(['pick:y.json', 'write:true', 'close'])
    expect(marked).toEqual(['2026-10-20T08:00:00.000Z'])
  })

  it('pencere iptal edilirse zaman değişmez ve indirme yapılmaz', async () => {
    const { target, log } = fakeTarget({ picker: 'abort' })
    const marked: string[] = []
    expect(await saveBackupFile(backup(), 'y.json', target, async (at) => void marked.push(at))).toBe('cancelled')
    expect(log).toEqual(['pick:y.json'])
    expect(marked).toEqual([])
  })

  it('yazma hatası fırlatılır; zaman değişmez', async () => {
    const { target } = fakeTarget({ picker: 'fail' })
    const marked: string[] = []
    await expect(saveBackupFile(backup(), 'y.json', target, async (at) => void marked.push(at))).rejects.toThrow('disk dolu')
    expect(marked).toEqual([])
  })

  it('pencere yoksa indirir ve sorar: onayda zaman yazılır, iptalde yazılmaz', async () => {
    const yes = fakeTarget({ confirm: true })
    const marked: string[] = []
    expect(await saveBackupFile(backup(), 'y.json', yes.target, async (at) => void marked.push(at))).toBe('confirmed')
    expect(yes.log).toEqual(['download:y.json', 'confirm:y.json'])
    expect(marked).toEqual(['2026-10-20T08:00:00.000Z'])

    const no = fakeTarget({ confirm: false })
    expect(await saveBackupFile(backup(), 'y.json', no.target, async (at) => void marked.push(at))).toBe('cancelled')
    expect(no.log).toEqual(['download:y.json', 'confirm:y.json'])
    expect(marked).toHaveLength(1)
  })
})

describe('kalıcı depo durumu', () => {
  it('zaten verilmişse yeniden istenmez; istenir ve sonuca göre verildi / verilmedi', async () => {
    let asked = 0
    expect(await requestPersistence({ persisted: async () => true, persist: async () => (asked++, true) })).toBe('granted')
    expect(asked).toBe(0)
    expect(await requestPersistence({ persisted: async () => false, persist: async () => (asked++, true) })).toBe('granted')
    expect(await requestPersistence({ persisted: async () => false, persist: async () => (asked++, false) })).toBe('denied')
    expect(asked).toBe(2)
  })

  it('API yoksa ya da hata verirse desteklenmiyor', async () => {
    expect(await requestPersistence(undefined)).toBe('unsupported')
    expect(await requestPersistence({ persisted: async () => false })).toBe('unsupported')
    expect(await requestPersistence({ persisted: async () => Promise.reject(new Error('x')), persist: async () => true })).toBe('unsupported')
    expect(PERSISTENCE_LABELS).toEqual({ granted: 'verildi', denied: 'verilmedi', unsupported: 'desteklenmiyor' })
  })
})

describe('yedeğin yeniliği', () => {
  it('en son kayıt anı yükleme, skor, dondurma ve AI kararından; maç günü ayrıca', () => {
    const b = backup({ uploads: [upload('2026-10-10T05:00:00.000Z')], results: [result('2026-10-12T21:00:00.000Z')], matches: [match('2026-10-12'), match('2026-10-13')] })
    expect(backupRecency(b)).toEqual({ latestAt: '2026-10-12T21:00:00.000Z', latestMatchDay: '2026-10-13' })
    expect(backupRecency(backup())).toEqual({ latestAt: null, latestMatchDay: null })
  })

  it('daha eski yedek: son kayıt anı daha erken; eşitse maç günü karar verir; tarayıcı boşsa eski sayılmaz', () => {
    const at = (latestAt: string | null, latestMatchDay: string | null = null) => ({ latestAt, latestMatchDay })
    expect(isOlderBackup(at('2026-10-10T00:00:00Z'), at('2026-10-12T00:00:00Z'))).toBe(true)
    expect(isOlderBackup(at('2026-10-12T00:00:00Z'), at('2026-10-10T00:00:00Z'))).toBe(false)
    expect(isOlderBackup(at('2026-10-12T00:00:00Z', '2026-10-11'), at('2026-10-12T00:00:00Z', '2026-10-12'))).toBe(true)
    expect(isOlderBackup(at(null), at('2026-10-12T00:00:00Z'))).toBe(true)
    expect(isOlderBackup(at('2026-10-12T00:00:00Z'), at(null))).toBe(false)
  })
})

describe('geri yükleme: eski yedek uyarısı ve güvenlik yedeği', () => {
  const current = backup({ uploads: [upload('2026-10-20T06:00:00.000Z')], matches: [match('2026-10-20')] }, '2026-10-21T07:00:00.000Z')
  const older = backup({ uploads: [upload('2026-10-15T06:00:00.000Z')], matches: [match('2026-10-15')] }, '2026-10-15T07:00:00.000Z')
  const newer = backup({ uploads: [upload('2026-10-21T06:00:00.000Z')], matches: [match('2026-10-21')] }, '2026-10-21T08:00:00.000Z')

  function deps(existing: BackupFile, answers: boolean[], save: { picker?: 'write' | 'abort'; confirm?: boolean }) {
    const asked: string[] = []
    const imported: BackupFile[] = []
    const marked: string[] = []
    const { target, log } = fakeTarget(save)
    return {
      asked,
      imported,
      marked,
      log,
      deps: {
        exportCurrent: async () => existing,
        importAll: async (b: BackupFile) => void imported.push(b),
        markSaved: async (at: string) => void marked.push(at),
        confirm: (text: string) => (asked.push(text), answers.shift() ?? false),
        target,
      },
    }
  }

  it('daha eski yedekte önce uyarı sorulur; reddedilirse hiçbir şey yapılmaz', async () => {
    const d = deps(current, [false], { picker: 'write' })
    expect(await restoreBackupFlow(older, d.deps)).toMatchObject({ kind: 'cancelled' })
    expect(d.asked).toHaveLength(1)
    expect(d.asked[0]).toMatch(/^Dikkat: yüklenen yedek tarayıcıdaki veriden ESKİ\. Yedekteki son kayıt 2026-10-15 .*tarayıcıdaki son kayıt 2026-10-20/)
    expect(d.imported).toEqual([])
    expect(d.log).toEqual([])
  })

  it('eski yedek onaylanırsa: değiştirme onayı, güvenlik yedeği, sonra içe aktarma', async () => {
    const d = deps(current, [true, true], { picker: 'write' })
    expect(await restoreBackupFlow(older, d.deps)).toMatchObject({ kind: 'restored', safety: 'saved' })
    expect(d.asked).toHaveLength(2)
    expect(d.log).toEqual(['pick:gollazim-yedek-2026-10-21-ice-aktarma-oncesi.json', 'write:true', 'close'])
    expect(d.marked).toEqual(['2026-10-21T07:00:00.000Z'])
    expect(d.imported).toEqual([older])
  })

  it('daha yeni yedekte eski uyarısı çıkmaz; yalnızca değiştirme onayı', async () => {
    const d = deps(current, [true], { confirm: true })
    expect(await restoreBackupFlow(newer, d.deps)).toMatchObject({ kind: 'restored', safety: 'confirmed' })
    expect(d.asked).toHaveLength(1)
    expect(d.asked[0]).toMatch(/^Tarayıcıdaki mevcut verinin tamamı/)
    expect(d.imported).toEqual([newer])
  })

  it('güvenlik yedeği kaydedilmezse içe aktarma yapılmaz ve zaman değişmez', async () => {
    const aborted = deps(current, [true], { picker: 'abort' })
    expect(await restoreBackupFlow(newer, aborted.deps)).toEqual({ kind: 'cancelled', reason: 'Güvenlik yedeği kaydedilmediği için içe aktarma yapılmadı; tarayıcıdaki veri değişmedi.' })
    expect(aborted.imported).toEqual([])
    expect(aborted.marked).toEqual([])

    const unconfirmed = deps(current, [true], { confirm: false })
    expect(await restoreBackupFlow(newer, unconfirmed.deps)).toMatchObject({ kind: 'cancelled' })
    expect(unconfirmed.log).toEqual(['download:gollazim-yedek-2026-10-21-ice-aktarma-oncesi.json', 'confirm:gollazim-yedek-2026-10-21-ice-aktarma-oncesi.json'])
    expect(unconfirmed.imported).toEqual([])
  })

  it('değiştirme onayı reddedilirse güvenlik yedeği de alınmaz', async () => {
    const d = deps(current, [false], { picker: 'write' })
    expect(await restoreBackupFlow(newer, d.deps)).toMatchObject({ kind: 'cancelled' })
    expect(d.log).toEqual([])
    expect(d.imported).toEqual([])
  })

  it('tarayıcı boşsa güvenlik yedeği atlanır ve eski uyarısı çıkmaz', async () => {
    const d = deps(backup(), [true], { picker: 'write' })
    expect(await restoreBackupFlow(older, d.deps)).toMatchObject({ kind: 'restored', safety: 'skipped' })
    expect(d.asked).toHaveLength(1)
    expect(d.log).toEqual([])
    expect(d.imported).toEqual([older])
  })
})
