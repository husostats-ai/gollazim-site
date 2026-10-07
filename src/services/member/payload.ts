import { CATEGORIES, getCategory, MAX_MATCHES_PER_CATEGORY, type CategoryId } from '../../config/categories'
import type { MemberTexts } from '../../config/memberTexts'
import type { LeagueTable, Match, MatchResult, MatchStatus, Pick, PickOutcome, SharedPick, TeamAlias, Thresholds } from '../../types'
import { formatScore } from '../../utils/score'
import { analyzeDay } from '../analysis/engine'
import type { Prediction, ReliabilityLevel } from '../analysis/types'
import { matchStandings, type StandingInfo } from '../league/standing'
import { resultDetail } from '../stats/categoryResult'
import { buildMainStats } from '../stats/mainStats'
import { buildStarStats } from '../stats/starStats'
import { buildStats, type Bucket, type Tally } from '../stats/statsEngine'
import { sharedPicksOnly } from '../story/shared'
import { assertMemberPayload } from './schema'

// Üye sayfasına giden yayın paketi. İZİNLİ ALAN LİSTESİDİR: paket, kayıt nesnelerinden
// (Match, Prediction, Pick…) kopyalanmaz; her alan aşağıda adıyla, tek tek yazılarak
// SIFIRDAN kurulur. Bu dosyada nesne yayma (`...match`, `...prediction`) kullanılmaz.
//
// Pakete GİRMEZ: ham CSV (Match.stats), FootyStats kolonları ve bağlantıları, oranlar,
// piyasa yüzdesi ve piyasa çelişkisi, xG, gol/korner/kart ortalamaları, "Kaynak" satırı,
// rozet ipucu metinleri, "xG zayıf" ve "model piyasadan sapıyor" rozetleri, örneklem sayısı, eşikler ve diğer ayarlar, yapay zekâ kararları,
// skor olasılıkları, paylaşım kayıtları, kalibrasyon tabloları.
//
// Yeni bir alan eklemek: buradaki tipe ve kurucuya, schema.ts'teki denetime ve
// sızıntı testindeki izinli anahtar listesine birlikte eklenir; biri eksikse test kırılır.

/**
 * Paket sürümü. 2: her önerinin yanında aynı maçın diğer listelerdeki önerileri (others) var.
 * 3: istatistiklerde ana kategorilerin toplu başarısı (main) var.
 * Sürüm 1 (others alanı olmayan) ve sürüm 2 (main alanı olmayan) paketler üye sayfasında hâlâ açılır.
 */
export const MEMBER_PAYLOAD_VERSION = 3

/** Günlük dökümde pakete giren en fazla gün sayısı (en yeniler) */
export const MEMBER_DAILY_LIMIT = 90

export interface MemberTally {
  won: number
  lost: number
  void: number
  pending: number
  decided: number
  total: number
  /** Yüzde, bir ondalık; sonuçlanmış öneri yoksa null */
  rate: number | null
  lowSample: boolean
}

export interface MemberBucket {
  key: string
  tally: MemberTally
}

export interface MemberMainStats {
  /** Kapsanan kategoriler, sabit listedeki sırayla */
  categories: CategoryId[]
  overall: MemberTally
  matches: { total: number; decided: number }
}

/** İstatistik sayfasının önceden hesaplanmış değerleri (bir kapsam için) */
export interface MemberStats {
  /**
   * Ana kategorilerin (admin tarafındaki sabit liste) toplu başarısı; en üstteki kart bunu gösterir.
   * Sürüm 1 ve 2 paketlerde bu alan yoktur.
   */
  main?: MemberMainStats
  /** Tüm kategoriler */
  overall: MemberTally
  matches: { total: number; decided: number }
  byCategory: MemberBucket[]
  byReliability: MemberBucket[]
  /** Eskiden yeniye, en fazla MEMBER_DAILY_LIMIT gün */
  daily: MemberBucket[]
  weekly: MemberBucket[]
  monthly: MemberBucket[]
  stars: {
    /** 5 yıldızdan 1 yıldıza */
    byStars: MemberBucket[]
    byCategory: { key: string; byStars: MemberTally[] }[]
    recomputed: number
    missing: number
  }
}

/** Yapıştırılan lig tablosundan: "N. sıra · M maç" */
export interface MemberStanding {
  rank: number
  played: number
  /** Tablo yayın anında 7 günden eski: "güncel değil" */
  stale: boolean
}

/**
 * Çelişki türü. model: hazır yüzde ile gol modeli çelişiyor (ana gol kategorileri).
 * hesap: iki ayrı hesap birbiriyle çelişiyor (Taraf & Gol).
 */
export type MemberConflict = 'model' | 'hesap'

export interface MemberMatch {
  home: string
  away: string
  league: string | null
  /** HH:mm, Türkiye saati */
  time: string | null
  /** Skor girilmediyse null */
  status: MatchStatus | null
  /** "İY 1-0 · MS 3-1"; skor girilmediyse null */
  score: string | null
  homeStanding: MemberStanding | null
  awayStanding: MemberStanding | null
}

/** Aynı maçın, yayınlanan başka bir listedeki önerisi */
export interface MemberOther {
  categoryId: CategoryId
  /** O listedeki yüzdesi (0-100) */
  percent: number
  /** O listedeki güvenilirlik seviyesi */
  reliability: ReliabilityLevel
}

export interface MemberItem {
  /** Günün matches dizisindeki sıra numarası */
  match: number
  /** Hazır yüzde (0-100) */
  percent: number
  /** İkinci hesabın (model) yüzdesi; yoksa null */
  model: number | null
  /** Çelişki rozeti; çelişki yoksa null */
  conflict: MemberConflict | null
  /** 1-5 */
  stars: number
  reliability: ReliabilityLevel
  /** Dondurulmuş önerinin sonucu; skor girilmediyse null */
  outcome: PickOutcome | null
  /** Sonucun kategoriye özgü ayrıntısı ("İY 1-0", "Korner 11"); yoksa null */
  detail: string | null
  /**
   * Aynı maçın bu paketteki diğer listelerde yer alan önerileri, kategori kayıt defterindeki
   * sırayla; yoksa boş dizi. Yalnızca pakette zaten bulunan önerilerden türetilir.
   * Sürüm 1 paketlerde bu alan yoktur.
   */
  others?: MemberOther[]
}

export interface MemberList {
  categoryId: CategoryId
  /** Listedeki sırayla (yüzdeye göre), en fazla 15 */
  items: MemberItem[]
}

export interface MemberDay {
  /** YYYY-MM-DD */
  date: string
  matches: MemberMatch[]
  /** Kategori kayıt defterindeki sırayla, her kategori için bir liste (boş olabilir) */
  lists: MemberList[]
}

export interface MemberPayload {
  v: 1 | 2 | typeof MEMBER_PAYLOAD_VERSION
  /** Yayın numarası */
  n: number
  /** Yayın anı (ISO) */
  publishedAt: string
  texts: { disclaimer: string; account: string }
  /** Seçilen gün ilk sırada */
  days: MemberDay[]
  /** İstatistik sayfasının değerleri: tüm öneriler ve yalnızca paylaşılanlar */
  statistics: { all: MemberStats; shared: MemberStats }
}

export interface MemberDayInput {
  date: string
  /** Günün tüm maçları */
  matches: Match[]
  /** Bu maçların girilmiş skorları */
  results: MatchResult[]
}

export interface MemberPayloadInput {
  n: number
  publishedAt: string
  texts: MemberTexts
  thresholds: Thresholds
  marketConflictLimit: number
  /** Yayınlanacak günler; seçilen gün ilk sırada */
  days: MemberDayInput[]
  leagueTables: LeagueTable[]
  teamAliases: TeamAlias[]
  /** Tüm dondurulmuş öneriler (sonuçlar ve istatistik için) */
  picks: Pick[]
  shared: SharedPick[]
}

const tallyOf = (t: Tally): MemberTally => ({
  won: t.won,
  lost: t.lost,
  void: t.void,
  pending: t.pending,
  decided: t.decided,
  total: t.total,
  rate: t.rate,
  lowSample: t.lowSample,
})

const bucketsOf = (buckets: Bucket[]): MemberBucket[] => buckets.map((b) => ({ key: b.key, tally: tallyOf(b.tally) }))

/** Kapsamdaki önerilerden istatistik sayfasının değerleri; kalibrasyon dökümleri alınmaz. */
function statsOf(picks: Pick[]): MemberStats {
  const stats = buildStats(picks)
  const stars = buildStarStats(picks)
  const main = buildMainStats(picks)
  return {
    main: {
      categories: main.categories.map((id) => id),
      overall: tallyOf(main.overall),
      matches: { total: main.matches.total, decided: main.matches.decided },
    },
    overall: tallyOf(stats.overall),
    matches: { total: stats.matches.total, decided: stats.matches.decided },
    byCategory: bucketsOf(stats.byCategory),
    byReliability: bucketsOf(stats.byReliability),
    daily: bucketsOf(stats.daily.slice(-MEMBER_DAILY_LIMIT)),
    weekly: bucketsOf(stats.weekly),
    monthly: bucketsOf(stats.monthly),
    stars: {
      byStars: bucketsOf(stars.byStars),
      byCategory: stars.byCategory.map((c) => ({ key: c.key, byStars: c.byStars.map(tallyOf) })),
      recomputed: stars.recomputed,
      missing: stars.missing,
    },
  }
}

const standingOf = (info: StandingInfo | null): MemberStanding | null => (info ? { rank: info.rank, played: info.played, stale: info.stale } : null)

/** Taraf & Gol listelerinde çelişki iki hesabın, diğerlerinde hazır yüzde ile modelin çelişkisidir */
export const conflictKindOf = (categoryId: CategoryId): MemberConflict => (getCategory(categoryId).group === 'sidegoals' ? 'hesap' : 'model')

function dayOf(input: MemberPayloadInput, day: MemberDayInput, now: Date): MemberDay {
  // Admin ekranındaki listelerle aynı çağrı; sıra her zaman yüzdeye göredir.
  const analysis = analyzeDay(day.matches, input.thresholds, 'percent', input.marketConflictLimit)
  const resultById = new Map(day.results.map((r) => [r.matchId, r]))
  const pickByKey = new Map(input.picks.filter((p) => p.date === day.date).map((p) => [`${p.matchId}|${p.categoryId}`, p]))

  // Yalnızca listelerde geçen maçlar pakete girer; kimlik yerine dizideki sıra kullanılır.
  const indexById = new Map<string, number>()
  const matches: MemberMatch[] = []
  const indexOf = (match: Match): number => {
    const known = indexById.get(match.id)
    if (known !== undefined) return known
    const result = resultById.get(match.id)
    const standings = matchStandings(match, day.matches, input.leagueTables, input.teamAliases, now)
    indexById.set(match.id, matches.length)
    matches.push({
      home: match.home,
      away: match.away,
      league: match.league ?? null,
      time: match.time ?? null,
      status: result ? result.status : null,
      score: formatScore(result),
      homeStanding: standingOf(standings.home),
      awayStanding: standingOf(standings.away),
    })
    return matches.length - 1
  }

  const itemOf = (prediction: Prediction): MemberItem => {
    const pick = pickByKey.get(`${prediction.match.id}|${prediction.categoryId}`)
    const detail = resultDetail(prediction.categoryId, resultById.get(prediction.match.id))
    return {
      match: indexOf(prediction.match),
      percent: prediction.percent,
      model: prediction.secondPercent ?? null,
      conflict: prediction.notes.some((note) => note.kind === 'conflict') ? conflictKindOf(prediction.categoryId) : null,
      stars: prediction.stars,
      reliability: prediction.reliability.level,
      outcome: pick ? pick.outcome : null,
      detail: detail === '' ? null : detail,
      // Aşağıda, tüm listeler kurulduktan sonra doldurulur.
      others: [],
    }
  }

  const lists: MemberList[] = CATEGORIES.map((category) => ({
    categoryId: category.id,
    items: analysis[category.id].predictions.slice(0, MAX_MATCHES_PER_CATEGORY).map(itemOf),
  }))
  // Aynı maçın diğer listelerdeki önerileri: yalnızca yukarıda kurulan (pakete giren) öğelerden.
  for (const list of lists) {
    for (const item of list.items) {
      const others: MemberOther[] = []
      for (const other of lists) {
        if (other.categoryId === list.categoryId) continue
        const same = other.items.find((candidate) => candidate.match === item.match)
        if (same) others.push({ categoryId: other.categoryId, percent: same.percent, reliability: same.reliability })
      }
      item.others = others
    }
  }
  return { date: day.date, matches, lists }
}

/**
 * Yayın paketini kurar. Saf fonksiyondur: aynı girdi her zaman aynı paketi verir.
 * Dönmeden önce paket şemaya karşı denetlenir; izinli olmayan tek bir alan hata verir.
 */
export function buildMemberPayload(input: MemberPayloadInput): MemberPayload {
  const now = new Date(input.publishedAt)
  const payload: MemberPayload = {
    v: MEMBER_PAYLOAD_VERSION,
    n: input.n,
    publishedAt: input.publishedAt,
    texts: { disclaimer: input.texts.disclaimer, account: input.texts.account },
    days: input.days.map((day) => dayOf(input, day, now)),
    statistics: {
      all: statsOf(input.picks),
      shared: statsOf(sharedPicksOnly(input.picks, input.shared)),
    },
  }
  assertMemberPayload(payload)
  return payload
}
