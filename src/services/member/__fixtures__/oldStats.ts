import type { MemberPayload } from '../payload'
import { MEMBER_HT_SCORELESS } from '../schema'

/**
 * Testlerde paketi eski sürüme çevirirken istatistik alanı: sürüm 10-13'te eski htScoreless ({ n, over }; az maçta over
 * null) bulunur, ht05Note bulunmaz; sürüm 1-9'da ikisi de yoktur. Sayılar bu testlerin konusu değildir, biçim uyar.
 * Birden çok kez çağrılabilir (ör. önce sürüm 12'ye, sonra 9'a).
 */
export function withOldStats(p: MemberPayload, version: number): void {
  for (const scope of ['all', 'shared'] as const) {
    const s = p.statistics[scope]
    const source = s.ht05Note ?? (s.htScoreless && { n: s.htScoreless.n, over: s.htScoreless.over ?? 0 })
    delete s.ht05Note
    delete s.htScoreless
    if (version >= 10 && version <= 13 && source) s.htScoreless = { n: source.n, over: source.n < MEMBER_HT_SCORELESS.min ? null : source.over }
  }
}
