import { getCategory, type CategoryId } from '../../config/categories'
import type { Match, Pick } from '../../types'
import { matchesByDate, rankIn, rankList, rankListKey, type RankList } from './rankStats'

// Sıra tablosunun (rankStats) sayfayı bekletmeden hesaplanması. Sıra, her günün tüm maçları
// yeniden analiz edilerek bulunur; Taraf & Gol modeli maç başına birkaç milisaniye sürdüğü için
// çok günlü veride iş saniyeler alır. Burada iş gün gün, kısa dilimlerle yapılır; dilimler
// arasında tarayıcıya söz verilir, iş iptal edilebilir ve hesaplanan günler oturum boyunca
// önbellekte kalır. Sonuç pickRanks ile birebir aynıdır; yalnızca okur.

export type Ranks = ReadonlyMap<string, number | null>

/** Bir günün önbelleği: maç kayıtlarının özeti ve o kayıtlarla hesaplanmış listeler */
interface DayEntry {
  fingerprint: string
  lists: Map<string, RankList>
}
export type RankCache = Map<string, DayEntry>

/** Oturum önbelleği (sayfa yenilenince boşalır); anahtar gündür */
const sessionCache: RankCache = new Map()

/** cyrb53: metnin 53 bitlik özeti */
function hash(text: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * Günün maç kayıtlarının özeti: kayıtların TAMAMI (her alan) kimlik sırasıyla özetlenir. Bir maç
 * eklenir, silinir ya da herhangi bir alanı değişirse özet değişir ve günün önbelleği geçersiz olur.
 */
export function dayFingerprint(dayMatches: Match[]): string {
  const text = [...dayMatches]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((match) => JSON.stringify(match))
    .join('\n')
  return `${dayMatches.length}:${text.length}:${hash(text)}`
}

export interface RankJobOptions {
  /** Tarayıcıya söz verir (dilimler arasında beklenir); varsayılan: bir sonraki görev */
  pause?: () => Promise<void>
  /** Bir dilimin en çok süresi (ms); aşılınca söz verilir */
  sliceMs?: number
  now?: () => number
  /** Liste hesabı; testte sayaç koymak için değiştirilebilir */
  buildList?: typeof rankList
  /** Varsayılan: oturum önbelleği */
  cache?: RankCache
}

export interface RankJob {
  /** İşi durdurur: sonraki dilim çalışmaz, done null ile sonuçlanır */
  cancel(): void
  /** Her önerinin sırası; iş iptal edildiyse null (iptal edilen işin sonucu hiçbir zaman verilmez) */
  done: Promise<Ranks | null>
}

/** Bir sonraki görevde devam eder; setTimeout'un iç içe çağrılardaki 4 ms'lik beklemesi olmadan */
const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') return void setTimeout(resolve, 0)
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })

const isSideGoals = (categoryId: CategoryId): boolean => getCategory(categoryId).group === 'sidegoals'

/**
 * Önerilerin sırasını arka planda hesaplar. İlk dilimden önce de söz verilir: iş, sayfa
 * çizildikten sonra başlar. Yalnızca önerisi olan gün + kategori + eşik listeleri hesaplanır.
 */
export function startRankJob(picks: Pick[], dayMatches: Match[], options: RankJobOptions = {}): RankJob {
  const { pause = nextTask, sliceMs = 10, now = () => performance.now(), buildList = rankList, cache = sessionCache } = options
  let cancelled = false

  const run = async (): Promise<Ranks | null> => {
    await pause()
    if (cancelled) return null
    let sliceStart = now()
    /** Dilim dolduysa söz verir; iş iptal edildiyse false döner */
    const breathe = async (): Promise<boolean> => {
      if (now() - sliceStart < sliceMs) return true
      await pause()
      sliceStart = now()
      return !cancelled
    }

    const byDate = matchesByDate(dayMatches)
    const picksByDate = new Map<string, Pick[]>()
    for (const pick of picks) picksByDate.set(pick.date, [...(picksByDate.get(pick.date) ?? []), pick])
    const ranks = new Map<string, number | null>()

    // Yeni günler önce: kısa kapsamlar ve son günler erken biter.
    for (const date of [...picksByDate.keys()].sort().reverse()) {
      const dayPicks = picksByDate.get(date)!
      const day = byDate.get(date) ?? []
      const fingerprint = dayFingerprint(day)
      let entry = cache.get(date)
      if (!entry || entry.fingerprint !== fingerprint) {
        entry = { fingerprint, lists: new Map() }
        cache.set(date, entry)
      }
      const missing = new Map<string, Pick>()
      for (const pick of dayPicks) if (!entry.lists.has(rankListKey(pick))) missing.set(rankListKey(pick), pick)

      // Taraf & Gol modeli maç başına pahalıdır ve analiz onu maç nesnesine göre saklar. Günün
      // listesi tek seferde hesaplanırsa sayfa o süre boyunca donar; bu yüzden model önce maç maç,
      // aralarda söz verilerek hazırlanır. Sonuç bu adımdan alınmaz: liste aşağıda günün TAMAMIYLA
      // hesaplanır, bu adım yalnızca o hesabı hızlandırır.
      const side = [...missing.values()].find((pick) => isSideGoals(pick.categoryId))
      if (side) {
        for (const match of day) {
          buildList([match], side.categoryId, side.threshold)
          if (!(await breathe())) return null
        }
      }
      for (const [key, pick] of missing) {
        // Liste, hesabı bitince önbelleğe girer: iptal edilen iş yarım kayıt bırakmaz.
        entry.lists.set(key, buildList(day, pick.categoryId, pick.threshold))
        if (!(await breathe())) return null
      }
      for (const pick of dayPicks) ranks.set(pick.id, rankIn(entry.lists.get(rankListKey(pick))!, pick))
      if (!(await breathe())) return null
    }
    return cancelled ? null : ranks
  }

  return {
    cancel: () => {
      cancelled = true
    },
    done: run(),
  }
}
