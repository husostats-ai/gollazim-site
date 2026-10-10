import { CATEGORIES, getCategory, MAX_MATCHES_PER_CATEGORY, type CategoryId } from '../../config/categories'
import type { MemberTexts } from '../../config/memberTexts'
import type { LeagueTable, Match, MatchResult, MatchStatus, Pick, PickOutcome, SharedPick, TeamAlias, Thresholds } from '../../types'
import { formatScore } from '../../utils/score'
import { analyzeDay } from '../analysis/engine'
import { highlightOutcome } from '../highlights/highlights'
import type { Prediction, ReliabilityLevel } from '../analysis/types'
import { matchStandings, type StandingInfo } from '../league/standing'
import { resultDetail } from '../stats/categoryResult'
import { buildMainStats } from '../stats/mainStats'
import { buildStarStats } from '../stats/starStats'
import { buildStats, type Bucket, type Tally } from '../stats/statsEngine'
import { sharedPicksOnly } from '../story/shared'
import { assertMemberPayload, MEMBER_STREAK_LIMITS } from './schema'

// Üye sayfasına giden yayın paketi. İZİNLİ ALAN LİSTESİDİR: paket, kayıt nesnelerinden
// (Match, Prediction, Pick…) kopyalanmaz; her alan aşağıda adıyla, tek tek yazılarak
// SIFIRDAN kurulur. Bu dosyada nesne yayma (`...match`, `...prediction`) kullanılmaz.
//
// Pakete GİRMEZ: ham CSV (Match.stats), FootyStats kolonları ve bağlantıları, oranlar,
// piyasa yüzdesi ve piyasa çelişkisi, xG, gol/korner/kart ortalamaları, "Kaynak" satırı,
// rozet ipucu metinleri, "xG zayıf" ve "model piyasadan sapıyor" rozetleri, eşikler ve diğer ayarlar,
// yapay zekâ kararlarının gerekçesi, riski, skor tahmini ve kayıt zamanı (yalnızca koşulu sağlayan maçın
// karar seviyeleri girer), skor olasılıkları, paylaşım kayıtları, kalibrasyon tabloları.
//
// Yeni bir alan eklemek: buradaki tipe ve kurucuya, schema.ts'teki denetime ve
// sızıntı testindeki izinli anahtar listesine birlikte eklenir; biri eksikse test kırılır.

/**
 * Paket sürümü. 2: her önerinin yanında aynı maçın diğer listelerdeki önerileri (others) var.
 * 3: istatistiklerde ana kategorilerin toplu başarısı (main) var.
 * 4: her günde "günün öne çıkanları" seçimleri (highlights) var.
 * 5: önerilerde tahmini maç sayısı (sample) bulunabilir.
 * 6: maçlarda "AI öneri güveni" satırı (ai) bulunabilir (maç geneli; artık üretilmez).
 * 7: "AI öneri güveni" satırı önerinin kendisindedir (kategori bazlı); maçta bulunmaz.
 * 8: "seri takibi" (streak) var: aktif serinin adımları, geçmiş seriler ve sayılar.
 * Sürüm 1 (others alanı olmayan), sürüm 2 (main alanı olmayan), sürüm 3 (highlights alanı olmayan),
 * sürüm 4 (sample alanı olmayan), sürüm 5 (ai alanı olmayan), sürüm 6 (ai alanı maçta olan) ve
 * sürüm 7 (streak alanı olmayan) paketler üye sayfasında hâlâ açılır; sürüm 6'daki maç geneli satır gösterilmez.
 */
export const MEMBER_PAYLOAD_VERSION = 8

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
  /**
   * YALNIZCA SÜRÜM 6 paketlerde: maçın tüm önerilerini birlikte kapsayan eski "AI öneri güveni"
   * satırı. Artık üretilmez ve üye sayfasında gösterilmez; kategori bazlı satır önerinin
   * kendisindedir (MemberItem.ai).
   */
  ai?: MemberAi
}

export type MemberAiProvider = 'chatgpt' | 'gemini' | 'claude'

/** Bir yapay zekânın kararı: yalnızca kim ve hangi seviye. Gerekçe, risk ve skor tahmini pakete GİRMEZ. */
export interface MemberAiVote {
  who: MemberAiProvider
  level: 'strong' | 'medium' | 'weak'
}

export interface MemberAi {
  /** Üç yapay zekâ, sabit sırayla */
  votes: MemberAiVote[]
  /** Çoğunluk kararını veren yapay zekâ sayısı (2 ya da 3) */
  count: number
  /** Çoğunluk kararının seviyesi */
  level: 'strong' | 'medium'
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
  /**
   * Yüzdenin dayandığı tahmini maç sayısı (alt sınır: ev sahibinin iç saha + deplasmanın dış saha
   * maçları). Yalnızca sayı çıkarılabildiyse vardır (seviye Az / Orta / Çok iken); çıkarılamadıysa
   * alan hiç yazılmaz. Sürüm 1-4 paketlerde bu alan yoktur.
   */
  sample?: number
  /**
   * "AI öneri güveni" satırı: yapay zekâların BU ÖNERİYE (maçın bu kategorisine) verdiği kararlar.
   * Yalnızca karar istenen dört listede ve yalnızca üç yapay zekânın da o kategori için maç
   * başlamadan karar verdiği, hiçbirinin "Eleme" demediği ve çoğunluğun Orta ya da Güçlü olduğu
   * öneride vardır; diğerlerinde alan hiç yazılmaz. Sürüm 1-6 paketlerde bu alan yoktur.
   */
  ai?: MemberAi
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

/**
 * "Günün öne çıkanları" seçimi. Yalnızca maçın kimliği, kategori ve sonuç: yüzde, güvenilirlik,
 * eklenme zamanı ve kayıt kimlikleri pakete GİRMEZ.
 */
export interface MemberHighlight {
  home: string
  away: string
  league: string | null
  /** HH:mm, Türkiye saati */
  time: string
  categoryId: CategoryId
  /** Skor girilmediyse null */
  status: MatchStatus | null
  /** "İY 1-0 · MS 3-1"; skor girilmediyse null */
  score: string | null
  /** Skor girilmediyse 'pending' */
  outcome: PickOutcome
}

export interface MemberDay {
  /** YYYY-MM-DD */
  date: string
  matches: MemberMatch[]
  /** Kategori kayıt defterindeki sırayla, her kategori için bir liste (boş olabilir) */
  lists: MemberList[]
  /** O günün öne çıkan seçimleri, saat sırasıyla (boş olabilir). Sürüm 1-3 paketlerde bu alan yoktur. */
  highlights?: MemberHighlight[]
}

/**
 * Seri takibindeki adımın durumu. unplayed: maç oynanmadı; void: değerlendirilemedi (ikisi de
 * seriden kaldırılmış adımdır: seriyi ne ilerletir ne bozar).
 */
export type MemberStreakState = 'won' | 'lost' | 'pending' | 'unplayed' | 'void'

/**
 * "Seri takibi" adımı. Yalnızca maçın adı, ligi, günü ve saati, kategori, durum ve adım numarası:
 * yüzde, geçmiş veri seviyesi, skor, yapay zekâ kararı, kayıt kimlikleri ve eklenme zamanı pakete GİRMEZ.
 */
export interface MemberStreakStep {
  /** YYYY-MM-DD */
  date: string
  home: string
  away: string
  league: string | null
  /** HH:mm, Türkiye saati */
  time: string
  categoryId: CategoryId
  /** Aktif seride 'lost' bulunmaz: tutmayan adım seriyi bitirir ve geçmiş serilere geçer */
  state: MemberStreakState
  /** Serideki adım numarası; seriden kaldırılan adımda null */
  step: number | null
}

/** Biten seri: uzunluğu (tutan adım sayısı), bittiği gün ve seriyi bitiren maç */
export interface MemberStreakRun {
  length: number
  /** YYYY-MM-DD */
  ended: string
  last: { home: string; away: string; league: string | null; categoryId: CategoryId }
}

export interface MemberStreakTotals {
  longest: number
  current: number
  /** Biten seri sayısı */
  count: number
  /** Biten serilerde seri başına tutan adım (bir ondalık); biten seri yoksa null */
  mean: number | null
  won: number
  lost: number
  lowSample: boolean
}

/** "Seri takibi". Güne bağlı değildir: paketin en üstündedir, günlük dökümün gün sınırı burada geçerli değildir. */
export interface MemberStreak {
  /** active: aktif seride en az bir sayılan adım var */
  status: 'active' | 'idle'
  /** Aktif serinin adımları, sırayla (boş olabilir) */
  steps: MemberStreakStep[]
  /** Biten seriler, yeniden eskiye (en yeniler) */
  past: MemberStreakRun[]
  totals: MemberStreakTotals
}

export interface MemberPayload {
  v: 1 | 2 | 3 | 4 | 5 | 6 | 7 | typeof MEMBER_PAYLOAD_VERSION
  /** Yayın numarası */
  n: number
  /** Yayın anı (ISO) */
  publishedAt: string
  texts: { disclaimer: string; account: string }
  /** Seçilen gün ilk sırada */
  days: MemberDay[]
  /** İstatistik sayfasının değerleri: tüm öneriler ve yalnızca paylaşılanlar */
  statistics: { all: MemberStats; shared: MemberStats }
  /** Seri takibi. Sürüm 1-7 paketlerde bu alan yoktur. */
  streak?: MemberStreak
}

/**
 * Seri takibinin paket kurucusuna verilen hâli. Çağıran taraf adım kayıtlarını buna indirger:
 * kayıt kimlikleri, eklenme ve yayın zamanları kurucuya hiç ulaşmaz.
 */
export type MemberStreakInput = MemberStreak

/**
 * Öne çıkan seçimin paket kurucusuna verilen hâli. Kayıttaki yüzde, güvenilirlik ve eklenme
 * zamanı bu tipte YOKTUR: çağıran taraf kaydı buna indirger, o alanlar kurucuya hiç ulaşmaz.
 */
export interface MemberHighlightInput {
  matchId: string
  categoryId: CategoryId
  // Eklenme anındaki görünüm; maç verisi silinmişse bunlar kullanılır.
  home: string
  away: string
  time: string
  league: string | null
}

/**
 * "AI öneri güveni" satırının paket kurucusuna verilen hâli: maç, kategori ve satırın kendisi. Hangi
 * önerinin satırının gideceğine çağıran taraf karar verir (services/ai/memberShare); kararların gerekçesi,
 * riski, skor tahmini ve kayıt zamanı bu tipte YOKTUR, kurucuya hiç ulaşmaz.
 */
export interface MemberAiInput {
  matchId: string
  categoryId: CategoryId
  ai: MemberAi
}

export interface SentAiKey {
  matchId: string
  categoryId: CategoryId
}

export interface MemberDayInput {
  date: string
  /** Günün tüm maçları */
  matches: Match[]
  /** Bu maçların (ve öne çıkan seçimlerin maçlarının) girilmiş skorları */
  results: MatchResult[]
  /** O günün öne çıkan seçimleri; verilmezse yok sayılır */
  highlights?: MemberHighlightInput[]
  /** Üyeye gidecek "AI öneri güveni" satırları; verilmezse yok sayılır. Pakette karşılığı (o listede o maç) olmayan girmez. */
  ai?: MemberAiInput[]
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
  /** Seri takibi; verilmezse boş seri yazılır */
  streak?: MemberStreakInput
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

function dayOf(input: MemberPayloadInput, day: MemberDayInput, now: Date, sentAi: SentAiKey[]): MemberDay {
  // Admin ekranındaki listelerle aynı çağrı; sıra her zaman yüzdeye göredir.
  const analysis = analyzeDay(day.matches, input.thresholds, 'percent', input.marketConflictLimit)
  const resultById = new Map(day.results.map((r) => [r.matchId, r]))
  const pickByKey = new Map(input.picks.filter((p) => p.date === day.date).map((p) => [`${p.matchId}|${p.categoryId}`, p]))

  const aiByKey = new Map((day.ai ?? []).map((row) => [`${row.matchId}|${row.categoryId}`, row.ai]))
  // Yalnızca listelerde geçen maçlar pakete girer; kimlik yerine dizideki sıra kullanılır.
  const indexById = new Map<string, number>()
  const matches: MemberMatch[] = []
  const indexOf = (match: Match): number => {
    const known = indexById.get(match.id)
    if (known !== undefined) return known
    const result = resultById.get(match.id)
    const standings = matchStandings(match, day.matches, input.leagueTables, input.teamAliases, now)
    indexById.set(match.id, matches.length)
    const entry: MemberMatch = {
      home: match.home,
      away: match.away,
      league: match.league ?? null,
      time: match.time ?? null,
      status: result ? result.status : null,
      score: formatScore(result),
      homeStanding: standingOf(standings.home),
      awayStanding: standingOf(standings.away),
    }
    matches.push(entry)
    return matches.length - 1
  }

  const itemOf = (prediction: Prediction): MemberItem => {
    const pick = pickByKey.get(`${prediction.match.id}|${prediction.categoryId}`)
    const detail = resultDetail(prediction.categoryId, resultById.get(prediction.match.id))
    const item: MemberItem = {
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
    // Tahmini maç sayısı yalnızca çıkarılabildiyse yazılır; yoksa alan hiç bulunmaz.
    if (prediction.reliability.sampleSize !== null) item.sample = prediction.reliability.sampleSize
    // "AI öneri güveni" satırı yalnızca çağıranın seçtiği öneride yazılır; alanlar tek tek kopyalanır.
    const row = aiByKey.get(`${prediction.match.id}|${prediction.categoryId}`)
    if (row) {
      item.ai = { votes: row.votes.map((vote) => ({ who: vote.who, level: vote.level })), count: row.count, level: row.level }
      sentAi.push({ matchId: prediction.match.id, categoryId: prediction.categoryId })
    }
    return item
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
  // Öne çıkanlar: listelerden bağımsızdır (maç artık listede olmayabilir, verisi silinmiş olabilir).
  const matchById = new Map(day.matches.map((m) => [m.id, m]))
  const highlights: MemberHighlight[] = (day.highlights ?? [])
    .map((selection): MemberHighlight => {
      const match = matchById.get(selection.matchId)
      const result = resultById.get(selection.matchId)
      return {
        home: match ? match.home : selection.home,
        away: match ? match.away : selection.away,
        league: (match ? match.league : selection.league) ?? null,
        time: match?.time ?? selection.time,
        categoryId: selection.categoryId,
        status: result ? result.status : null,
        score: formatScore(result),
        outcome: highlightOutcome(selection, pickByKey.get(`${selection.matchId}|${selection.categoryId}`), result),
      }
    })
    .sort((a, b) => a.time.localeCompare(b.time) || a.home.localeCompare(b.home, 'tr') || CATEGORIES.findIndex((c) => c.id === a.categoryId) - CATEGORIES.findIndex((c) => c.id === b.categoryId))
  return { date: day.date, matches, lists, highlights }
}

const EMPTY_STREAK: MemberStreakInput = { status: 'idle', steps: [], past: [], totals: { longest: 0, current: 0, count: 0, mean: null, won: 0, lost: 0, lowSample: true } }

/** Seri takibi: alanlar tek tek yazılır; en fazla son MEMBER_STREAK_LIMITS kadar adım ve seri girer. */
function streakOf(input: MemberStreakInput): MemberStreak {
  return {
    status: input.status,
    steps: input.steps.slice(-MEMBER_STREAK_LIMITS.steps).map((s) => ({ date: s.date, home: s.home, away: s.away, league: s.league, time: s.time, categoryId: s.categoryId, state: s.state, step: s.step })),
    past: input.past.slice(0, MEMBER_STREAK_LIMITS.past).map((r) => ({ length: r.length, ended: r.ended, last: { home: r.last.home, away: r.last.away, league: r.last.league, categoryId: r.last.categoryId } })),
    totals: { longest: input.totals.longest, current: input.totals.current, count: input.totals.count, mean: input.totals.mean, won: input.totals.won, lost: input.totals.lost, lowSample: input.totals.lowSample },
  }
}

/**
 * Yayın paketini kurar. Saf fonksiyondur: aynı girdi her zaman aynı paketi verir.
 * Dönmeden önce paket şemaya karşı denetlenir; izinli olmayan tek bir alan hata verir.
 */
export const buildMemberPayload = (input: MemberPayloadInput): MemberPayload => buildMemberPublication(input).payload

/**
 * buildMemberPayload ile aynı paket; ayrıca "AI öneri güveni" satırı pakete GERÇEKTEN giren
 * önerilerin (maç + kategori) kimlikleri (kayıt için; paketin içinde kimlik yoktur).
 */
export function buildMemberPublication(input: MemberPayloadInput): { payload: MemberPayload; aiSent: SentAiKey[] } {
  const now = new Date(input.publishedAt)
  const aiSent: SentAiKey[] = []
  const payload: MemberPayload = {
    v: MEMBER_PAYLOAD_VERSION,
    n: input.n,
    publishedAt: input.publishedAt,
    texts: { disclaimer: input.texts.disclaimer, account: input.texts.account },
    days: input.days.map((day) => dayOf(input, day, now, aiSent)),
    statistics: {
      all: statsOf(input.picks),
      shared: statsOf(sharedPicksOnly(input.picks, input.shared)),
    },
    streak: streakOf(input.streak ?? EMPTY_STREAK),
  }
  assertMemberPayload(payload)
  return { payload, aiSent }
}
