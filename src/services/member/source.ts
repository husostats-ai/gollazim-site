import { MemberEnvelopeError, parseEnvelope, type MemberEnvelope } from './crypto'

// Şifreli yayın paketini adresinden getirir.

/**
 * network: sunucuya ulaşılamadı. missing: adreste paket yok (henüz yayın yapılmamış).
 * invalid: gelen dosya bir yayın paketi değil ya da bozuk. outdated: paket bu sayfanın
 * tanımadığı bir sürümde (sayfa yenilenmeli).
 */
export type SourceErrorKind = 'network' | 'missing' | 'invalid' | 'outdated'

export class MemberSourceError extends Error {
  constructor(public readonly kind: SourceErrorKind) {
    super(`Yayın paketi alınamadı: ${kind}`)
  }
}

export type FetchLike = (url: string, init: { cache: 'no-store'; credentials: 'omit' }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

/** Önbelleği atlamak için adrese zaman damgası ekler */
export const withTimestamp = (url: string, now: number): string => `${url}${url.includes('?') ? '&' : '?'}t=${now}`

export async function fetchEnvelope(url: string, fetchImpl: FetchLike, now: number): Promise<MemberEnvelope> {
  let response: Awaited<ReturnType<FetchLike>>
  let text: string
  try {
    response = await fetchImpl(withTimestamp(url, now), { cache: 'no-store', credentials: 'omit' })
    if (response.status === 404) throw new MemberSourceError('missing')
    if (!response.ok) throw new MemberSourceError('network')
    text = await response.text()
  } catch (error) {
    throw error instanceof MemberSourceError ? error : new MemberSourceError('network')
  }
  // Dosya yokken bazı sunucular 200 ile bir HTML sayfası döndürür.
  if (text.trimStart().startsWith('<')) throw new MemberSourceError('missing')
  try {
    return parseEnvelope(text)
  } catch (error) {
    throw new MemberSourceError(error instanceof MemberEnvelopeError && error.detail.includes('sürüm') ? 'outdated' : 'invalid')
  }
}
