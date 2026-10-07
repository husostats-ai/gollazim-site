// Ayrı üye sitesinin sürümü ile bu (admin) derlemenin karşılaştırması. Üye sitesi ayrı
// yayınlandığı için eski kalabilir; özellikle paket biçimi değişen bir sürümde üye sitesi
// güncellenmeden yayın yapılırsa üyeler paketi açamaz.

export interface SiteVersion {
  /** Derlemenin yapıldığı commit (kısa kimlik) ya da 'bilinmiyor' */
  commit: string
  /** Açabildiği en yüksek paket sürümü */
  payloadVersion: number
}

/**
 * ok: üye sitesi bu sürümle aynı commit'ten derlenmiş.
 * older: commit farklı; üye sitesi eski sürümde olabilir (paketi yine de açabilir).
 * incompatible: üye sitesi bu sürümün ürettiği paketi AÇAMAZ.
 * unknown: üye sitesinin sürümü okunamadı.
 */
export type SiteVersionLevel = 'ok' | 'older' | 'incompatible' | 'unknown'

export interface SiteVersionStatus {
  level: SiteVersionLevel
  text: string
}

export const MEMBER_SITE_UPDATE_HINT = 'Güncellemek için: npm run uye-yayinla'

/** Üye sitesinden okunan sürüm bilgisini doğrular; biçimi tutmuyorsa null */
export function parseSiteVersion(value: unknown): SiteVersion | null {
  if (typeof value !== 'object' || value === null) return null
  const { commit, payloadVersion } = value as Partial<SiteVersion>
  if (typeof commit !== 'string' || !/^([0-9a-f]{7}|bilinmiyor)$/.test(commit)) return null
  if (typeof payloadVersion !== 'number' || !Number.isInteger(payloadVersion) || payloadVersion < 1) return null
  return { commit, payloadVersion }
}

export function siteVersionStatus(site: SiteVersion | null, admin: SiteVersion): SiteVersionStatus {
  if (!site) return { level: 'unknown', text: 'Üye sitesinin sürümü okunamadı (site henüz yayınlanmamış ya da ulaşılamıyor olabilir).' }
  if (site.payloadVersion < admin.payloadVersion)
    return { level: 'incompatible', text: `Üye sitesi eski sürümde: bu sürümün ürettiği paketi (sürüm ${admin.payloadVersion}) AÇAMAZ; üye sitesi en çok sürüm ${site.payloadVersion} paketleri açabiliyor. Yayınlamadan önce üye sitesini güncelleyin.` }
  if (site.commit !== admin.commit) return { level: 'older', text: `Üye sitesi eski sürümde olabilir (üye sitesi: ${site.commit}, bu sürüm: ${admin.commit}).` }
  return { level: 'ok', text: `Üye sitesi güncel (${site.commit}).` }
}

/** Üye sitesinin sürümünü okur; ulaşılamazsa ya da biçimi tutmuyorsa null */
export async function fetchSiteVersion(url: string, fetchImpl: (url: string, init: { cache: 'no-store'; credentials: 'omit' }) => Promise<{ ok: boolean; json(): Promise<unknown> }>, now: number): Promise<SiteVersion | null> {
  try {
    const response = await fetchImpl(`${url}?t=${now}`, { cache: 'no-store', credentials: 'omit' })
    return response.ok ? parseSiteVersion(await response.json()) : null
  } catch {
    return null
  }
}
