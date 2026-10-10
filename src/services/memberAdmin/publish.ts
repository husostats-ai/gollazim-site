import type { MemberTexts } from '../../config/memberTexts'
import type { AiVerdict, Highlight, LeagueTable, Match, MatchResult, Pick, SharedPick, StreakStep, TeamAlias, Thresholds } from '../../types'
import { shiftDate } from '../../utils/format'
import { fromBase64, sealPayload, type MemberEnvelope } from '../member/crypto'
import { AI_CATEGORY_IDS } from '../../config/ai'
import type { CategoryId } from '../../config/categories'
import { aiShareId, memberShareRow, type MemberShareRow } from '../ai/memberShare'
import { buildMemberPublication, type MemberAiInput, type MemberHighlightInput, type MemberPayload, type MemberPayloadInput, type MemberStreakInput } from '../member/payload'
import { buildStreak, type StreakView } from '../streak/streak'
import { factsFrom } from '../streak/streakFacts'
import { scanForLeaks } from './leakScan'
import { activeKeys } from './registry'
import type { MemberMeta, MemberRecord, PublicationRecord } from './types'

// "Yayınla": seçilen gün ve önceki 6 gün (son 7 gün) için paketi SIFIRDAN kurar (payload.ts), ham veriye
// karşı sızıntı denetiminden geçirir ve aktif üyeler için şifreler (crypto.ts).

/** Paketin kurulması için okunan veriler (veri deposunun gereken kısmı) */
export interface PublishSources {
  listMatchesByDate(date: string): Promise<Match[]>
  listResultsByMatchIds(matchIds: string[]): Promise<MatchResult[]>
  listPicks(): Promise<Pick[]>
  listShared(): Promise<SharedPick[]>
  /** O günün "öne çıkan" seçimleri */
  listHighlightsByDate(date: string): Promise<Highlight[]>
  /** Pakete giren seçimleri yayınlandı olarak işaretler (yayınlanan seçim kaldırılamaz) */
  markHighlightsPublished(ids: string[], publishedAt: string): Promise<void>
  /** O günün yapay zekâ kararları ("AI öneri güveni" satırı için) */
  listAiVerdictsByDate(date: string): Promise<AiVerdict[]>
  /** Satırı bu yayınla üyeye giden maçları kaydeder (yalnızca kayıt) */
  recordAiShares(sent: SentAiShare[], n: number, publishedAt: string): Promise<void>
  /** "Seri takibi" adımlarının tamamı (güne bağlı değildir) */
  listStreakSteps(): Promise<StreakStep[]>
  /** Verilen kimliklerden kayıtlı olan maçlar (seri adımlarının maçları, günü pakette olmasa da) */
  listMatchesByIds(ids: string[]): Promise<Match[]>
  /** Pakete giren adımları yayınlandı olarak işaretler (yayınlanan adım silinemez) */
  markStreakPublished(ids: string[], publishedAt: string): Promise<void>
  listLeagueTables(): Promise<LeagueTable[]>
  listAliases(): Promise<TeamAlias[]>
  getThresholds(): Promise<Thresholds>
  getMarketConflictLimit(): Promise<number>
}

/** no-members: aktif üye yok. leak: sızıntı denetimi başarısız (ayrıntı problems içinde). */
export class PublishError extends Error {
  constructor(
    public readonly kind: 'no-members' | 'leak' | 'no-salt',
    public readonly problems: string[] = [],
  ) {
    super(kind === 'no-members' ? 'Aktif üye yok: önce üye ekleyin. Boş paket üretilmez.' : kind === 'no-salt' ? 'Üye kaydı eksik: site tuzu bulunamadı.' : `Sızıntı denetimi başarısız; paket indirilmedi. ${problems.join('; ')}`)
  }
}

/** "AI öneri güveni" satırı pakete giren öneri: maç + kategori (kayıt için; pakette kimlik yoktur) */
export interface SentAiShare {
  matchId: string
  categoryId: CategoryId
  date: string
  row: MemberShareRow
}

export interface PublishDraft {
  payload: MemberPayload
  /** Paketteki günlerin ham maç kayıtları (sızıntı denetimi için; pakete girmez) */
  rawMatches: Match[]
  /** Pakete giren öne çıkan seçimlerin kayıt kimlikleri (yayından sonra işaretlemek için; pakete girmez) */
  highlightIds: string[]
  /** "AI öneri güveni" satırı pakete giren maçlar (yayından sonra kaydetmek için; pakete girmez) */
  aiShares: SentAiShare[]
  /** Pakete giren seri adımlarının kayıt kimlikleri (yayından sonra işaretlemek için; pakete girmez) */
  streakIds: string[]
}

/**
 * Günün maçlarının, karar istenen kategorilerde satırı üyeye gidebilecek olanları. Kararın
 * yalnızca sağlayıcısı ve seviyesi kurucuya verilir: gerekçe, risk, skor tahmini ve kayıt zamanı
 * burada kalır. Eski maç geneli kararlar hiç hesaba girmez.
 */
export function aiInputsOf(matches: readonly Match[], verdicts: readonly AiVerdict[]): { inputs: MemberAiInput[]; rows: Map<string, MemberShareRow> } {
  const rows = new Map<string, MemberShareRow>()
  const inputs: MemberAiInput[] = []
  for (const match of matches) {
    const own = verdicts.filter((v) => v.matchId === match.id)
    if (own.length === 0) continue
    for (const categoryId of AI_CATEGORY_IDS) {
      const row = memberShareRow(match, own, categoryId)
      if (!row) continue
      rows.set(aiShareId(match.id, categoryId), row)
      inputs.push({ matchId: match.id, categoryId, ai: { votes: row.votes.map((vote) => ({ who: vote.provider, level: vote.decision })), count: row.count, level: row.decision } })
    }
  }
  return { inputs, rows }
}

/**
 * Öne çıkan kaydını paket kurucusunun girdisine indirger. Alanlar tek tek yazılır: yüzde,
 * güvenilirlik, eklenme ve yayın zamanı kurucuya hiç verilmez.
 */
export const highlightInputOf = (record: Highlight): MemberHighlightInput => ({
  matchId: record.matchId,
  categoryId: record.categoryId,
  home: record.home,
  away: record.away,
  time: record.time,
  league: record.league ?? null,
})

/**
 * Seri görünümünü paket kurucusunun girdisine indirger. Alanlar tek tek yazılır: kayıt kimlikleri,
 * sıra numarası, eklenme, yayın ve düzeltme zamanları kurucuya hiç verilmez. Maç kaydı duruyorsa
 * takım ve lig adı ondan, silinmişse adımın kaydından okunur.
 */
export function streakInputOf(view: StreakView, matches: readonly Match[]): MemberStreakInput {
  const matchById = new Map(matches.map((m) => [m.id, m]))
  const names = (record: StreakStep) => {
    const match = matchById.get(record.matchId)
    return { home: match ? match.home : record.home, away: match ? match.away : record.away, league: (match ? match.league : record.league) ?? null }
  }
  const steps = view.current?.steps ?? []
  return {
    status: steps.some((s) => s.step !== null) ? 'active' : 'idle',
    steps: steps.map(({ record, state, step }) => {
      const { home, away, league } = names(record)
      return { date: record.date, home, away, league, time: record.time, categoryId: record.categoryId, state, step }
    }),
    past: [...view.past].reverse().map((run) => {
      const { record } = run.steps[run.steps.length - 1]
      const { home, away, league } = names(record)
      return { length: run.length, ended: record.date, last: { home, away, league, categoryId: record.categoryId } }
    }),
    totals: { longest: view.totals.longest, current: view.totals.current, count: view.totals.count, mean: view.totals.mean, won: view.totals.won, lost: view.totals.lost, lowSample: view.totals.lowSample },
  }
}

/** Pakete giren en fazla gün sayısı: seçilen gün ve ondan önceki günler (şemadaki sınırı aşmaz) */
export const PUBLISH_DAY_COUNT = 7

/**
 * Seçilen gün + önceki 6 günün verisini okuyup paketi kurar. Önceki günlerden hiç önerisi ve
 * hiç öne çıkan seçimi olmayanlar pakete girmez (üye sayfasında boş gün düğmesi çıkmasın);
 * seçilen gün boş olsa da girer. Her günün öne çıkan seçimleri o günle birlikte pakete girer.
 */
export async function draftPublication(sources: PublishSources, options: { day: string; n: number; publishedAt: string; texts: MemberTexts }): Promise<PublishDraft> {
  const dates = Array.from({ length: PUBLISH_DAY_COUNT }, (_, back) => shiftDate(options.day, -back))
  const [dayData, picks, shared, leagueTables, teamAliases, thresholds, marketConflictLimit, streakSteps] = await Promise.all([
    Promise.all(
      dates.map(async (date) => {
        const [matches, records, verdicts] = await Promise.all([sources.listMatchesByDate(date), sources.listHighlightsByDate(date), sources.listAiVerdictsByDate(date)])
        const ai = aiInputsOf(matches, verdicts)
        // Seçimin maçı silinmiş olabilir: skoru duruyorsa yine okunur.
        const resultIds = [...new Set([...matches.map((m) => m.id), ...records.map((r) => r.matchId)])]
        return { date, matches, results: await sources.listResultsByMatchIds(resultIds), highlights: records.map(highlightInputOf), highlightIds: records.map((r) => r.id), ai }
      }),
    ),
    sources.listPicks(),
    sources.listShared(),
    sources.listLeagueTables(),
    sources.listAliases(),
    sources.getThresholds(),
    sources.getMarketConflictLimit(),
    sources.listStreakSteps(),
  ])
  // Seri güne bağlı değildir: adımların maçları ve skorları, günü pakette olmasa da okunur.
  const streakMatchIds = [...new Set(streakSteps.map((s) => s.matchId))]
  const [streakMatches, streakResults] = await Promise.all([sources.listMatchesByIds(streakMatchIds), sources.listResultsByMatchIds(streakMatchIds)])
  const streakWanted = new Set(streakSteps.map((s) => s.id))
  const streak = streakInputOf(buildStreak(streakSteps, factsFrom({ matches: streakMatches, results: streakResults, picks: picks.filter((p) => streakWanted.has(p.id)) })), streakMatches)
  const input: MemberPayloadInput = { n: options.n, publishedAt: options.publishedAt, texts: options.texts, thresholds, marketConflictLimit, days: dayData.map((d) => ({ date: d.date, matches: d.matches, results: d.results, highlights: d.highlights, ai: d.ai.inputs })), leagueTables, teamAliases, picks, shared, streak }
  const full = buildMemberPublication(input)
  // Listeler paket kurulurken hesaplandığı için boş günler ancak şimdi bilinir.
  const keep = dayData.map((d, i) => i === 0 || full.payload.days[i].lists.some((list) => list.items.length > 0) || d.highlights.length > 0)
  const kept = dayData.filter((_, i) => keep[i])
  const { payload, aiSent } = kept.length === dayData.length ? full : buildMemberPublication({ ...input, days: input.days.filter((_, i) => keep[i]) })
  // Satır yalnızca o listede yer alan öneride pakete girer; kayıt kurucunun bildirdiklerinden tutulur.
  const rowOf = new Map(kept.flatMap((d) => [...d.ai.rows].map(([key, row]): [string, { date: string; row: MemberShareRow }] => [key, { date: d.date, row }])))
  const aiShares = aiSent.flatMap(({ matchId, categoryId }): SentAiShare[] => {
    const found = rowOf.get(aiShareId(matchId, categoryId))
    return found ? [{ matchId, categoryId, date: found.date, row: found.row }] : []
  })
  // Sızıntı denetimi seri adımlarının ham maç kayıtlarını da kapsar.
  const rawMatches = [...new Map([...kept.flatMap((d) => d.matches), ...streakMatches].map((m) => [m.id, m])).values()]
  return { payload, rawMatches, highlightIds: kept.flatMap((d) => d.highlightIds), aiShares, streakIds: streakSteps.map((s) => s.id) }
}

export interface PublishSummary {
  days: { date: string; matches: number; items: number; lists: number; highlights: number; ai: number }[]
  /** Seri takibi: aktif serideki adım, bekleyen adım ve pakete giren geçmiş seri sayısı */
  streak: { steps: number; pending: number; past: number }
  /** Paketin düz hâlinin boyutu (bayt) */
  plainBytes: number
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length

/** Onay ekranındaki paket özeti */
export const summarizePayload = (payload: MemberPayload): PublishSummary => ({
  days: payload.days.map((d) => ({ date: d.date, matches: d.matches.length, items: d.lists.reduce((sum, l) => sum + l.items.length, 0), lists: d.lists.filter((l) => l.items.length > 0).length, highlights: d.highlights?.length ?? 0, ai: d.lists.reduce((sum, l) => sum + l.items.filter((item) => item.ai !== undefined).length, 0) })),
  streak: { steps: payload.streak?.steps.length ?? 0, pending: payload.streak?.steps.filter((s) => s.state === 'pending').length ?? 0, past: payload.streak?.past.length ?? 0 },
  plainBytes: byteLength(JSON.stringify(payload)),
})

export interface Publication {
  /** İndirilecek dosyanın içeriği (şifreli paket, JSON) */
  text: string
  envelope: MemberEnvelope
  summary: PublishSummary
  record: PublicationRecord
  /** Sızıntı denetiminde karşılaştırılan ham değer sayısı */
  leakChecked: number
}

/**
 * Taslağı sızıntı denetiminden geçirir ve aktif üyeler için şifreler. Aktif üye yoksa ya da
 * denetim tek bir bulgu verirse PublishError fırlatır; o durumda paket üretilmez.
 */
export async function sealPublication(draft: PublishDraft, members: readonly MemberRecord[], meta: { siteSalt: MemberMeta['siteSalt'] }, slotCount?: number): Promise<Publication> {
  const keys = activeKeys(members)
  if (keys.length === 0) throw new PublishError('no-members')
  if (!meta.siteSalt) throw new PublishError('no-salt')
  const scan = scanForLeaks(draft.payload, draft.rawMatches)
  if (scan.problems.length > 0) throw new PublishError('leak', scan.problems)

  const envelope = await sealPayload({ payload: draft.payload, members: keys, siteSalt: fromBase64(meta.siteSalt, 'siteSalt', 16), slotCount })
  const text = JSON.stringify(envelope)
  return {
    text,
    envelope,
    summary: summarizePayload(draft.payload),
    record: { n: draft.payload.n, publishedAt: draft.payload.publishedAt, day: draft.payload.days[0].date, memberCount: keys.length, bytes: byteLength(text) },
    leakChecked: scan.checked,
  }
}

/** İndirilen yayın dosyasının adı */
export const PUBLICATION_FILE_NAME = 'paket.json'
