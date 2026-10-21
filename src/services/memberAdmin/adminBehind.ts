// Bu admin derlemesinin repodaki main dalının kaç commit gerisinde olduğu. Paketler o an açık olan admin
// derlemesiyle üretildiği için, push edilip yayınlanmamış bir düzeltme pakete yansımaz; bu not bunu gösterir.
// Kaynak: halka açık GitHub API'si, tek istek, kimlik bilgisi yok. Yalnızca admin tarafında çalışır.

/** Admin sitesinin reposu */
export const ADMIN_REPO = 'husostats-ai/gollazim-site'

/** Derlemenin commit'i ile main'in karşılaştırması (base = bu derleme, head = main) */
export const compareUrl = (commit: string): string => `https://api.github.com/repos/${ADMIN_REPO}/compare/${commit}...main?per_page=1`

/**
 * Denetim yalnızca yayındaki admin sitesinde (GitHub Pages) yapılır. Yerel geliştirme ve uçtan uca denemeler
 * dış istek atmaz: oradaki commit çoğunlukla GitHub'da yoktur (404, konsolda hata).
 */
export const isDeployedAdmin = (hostname: string): boolean => hostname.endsWith('.github.io')

/** Karşılaştırma yanıtından main'in kaç commit önde olduğu; biçim tutmuyorsa null */
export function behindMain(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null
  const { status, ahead_by: ahead } = value as { status?: unknown; ahead_by?: unknown }
  if (!['ahead', 'identical', 'behind', 'diverged'].includes(status as string)) return null
  return typeof ahead === 'number' && Number.isInteger(ahead) && ahead >= 0 ? ahead : null
}

type FetchLike = (url: string, init: { cache: 'no-store'; credentials: 'omit'; headers: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>

/** main'in bu derlemeden kaç commit önde olduğu; commit bilinmiyorsa, istek ya da yanıt başarısızsa null (sessizce) */
export async function fetchBehindMain(commit: string, fetchImpl: FetchLike): Promise<number | null> {
  if (!/^[0-9a-f]{7,40}$/.test(commit)) return null
  try {
    const response = await fetchImpl(compareUrl(commit), { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/vnd.github+json' } })
    return response.ok ? behindMain(await response.json()) : null
  } catch {
    return null
  }
}

export const behindMainText = (commit: string, behind: number): string =>
  `Bu admin sürümü (${commit}) main'in ${behind} commit gerisinde: üretilen paketlere bu commit'ler yansımaz. Güncellemek için admin'i yeniden yayınla (gh workflow run deploy.yml --ref main).`
