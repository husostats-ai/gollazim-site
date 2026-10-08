import type { MemberTexts } from '../../config/memberTexts'
import type { Highlight, LeagueTable, Match, MatchResult, Pick, SharedPick, TeamAlias, Thresholds } from '../../types'
import { shiftDate } from '../../utils/format'
import { fromBase64, sealPayload, type MemberEnvelope } from '../member/crypto'
import { buildMemberPayload, type MemberHighlightInput, type MemberPayload, type MemberPayloadInput } from '../member/payload'
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

export interface PublishDraft {
  payload: MemberPayload
  /** Paketteki günlerin ham maç kayıtları (sızıntı denetimi için; pakete girmez) */
  rawMatches: Match[]
  /** Pakete giren öne çıkan seçimlerin kayıt kimlikleri (yayından sonra işaretlemek için; pakete girmez) */
  highlightIds: string[]
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

/** Pakete giren en fazla gün sayısı: seçilen gün ve ondan önceki günler (şemadaki sınırı aşmaz) */
export const PUBLISH_DAY_COUNT = 7

/**
 * Seçilen gün + önceki 6 günün verisini okuyup paketi kurar. Önceki günlerden hiç önerisi ve
 * hiç öne çıkan seçimi olmayanlar pakete girmez (üye sayfasında boş gün düğmesi çıkmasın);
 * seçilen gün boş olsa da girer. Her günün öne çıkan seçimleri o günle birlikte pakete girer.
 */
export async function draftPublication(sources: PublishSources, options: { day: string; n: number; publishedAt: string; texts: MemberTexts }): Promise<PublishDraft> {
  const dates = Array.from({ length: PUBLISH_DAY_COUNT }, (_, back) => shiftDate(options.day, -back))
  const [dayData, picks, shared, leagueTables, teamAliases, thresholds, marketConflictLimit] = await Promise.all([
    Promise.all(
      dates.map(async (date) => {
        const [matches, records] = await Promise.all([sources.listMatchesByDate(date), sources.listHighlightsByDate(date)])
        // Seçimin maçı silinmiş olabilir: skoru duruyorsa yine okunur.
        const resultIds = [...new Set([...matches.map((m) => m.id), ...records.map((r) => r.matchId)])]
        return { date, matches, results: await sources.listResultsByMatchIds(resultIds), highlights: records.map(highlightInputOf), highlightIds: records.map((r) => r.id) }
      }),
    ),
    sources.listPicks(),
    sources.listShared(),
    sources.listLeagueTables(),
    sources.listAliases(),
    sources.getThresholds(),
    sources.getMarketConflictLimit(),
  ])
  const input: MemberPayloadInput = { n: options.n, publishedAt: options.publishedAt, texts: options.texts, thresholds, marketConflictLimit, days: dayData.map((d) => ({ date: d.date, matches: d.matches, results: d.results, highlights: d.highlights })), leagueTables, teamAliases, picks, shared }
  const full = buildMemberPayload(input)
  // Listeler paket kurulurken hesaplandığı için boş günler ancak şimdi bilinir.
  const keep = dayData.map((d, i) => i === 0 || full.days[i].lists.some((list) => list.items.length > 0) || d.highlights.length > 0)
  const kept = dayData.filter((_, i) => keep[i])
  const payload = kept.length === dayData.length ? full : buildMemberPayload({ ...input, days: input.days.filter((_, i) => keep[i]) })
  return { payload, rawMatches: kept.flatMap((d) => d.matches), highlightIds: kept.flatMap((d) => d.highlightIds) }
}

export interface PublishSummary {
  days: { date: string; matches: number; items: number; lists: number; highlights: number }[]
  /** Paketin düz hâlinin boyutu (bayt) */
  plainBytes: number
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length

/** Onay ekranındaki paket özeti */
export const summarizePayload = (payload: MemberPayload): PublishSummary => ({
  days: payload.days.map((d) => ({ date: d.date, matches: d.matches.length, items: d.lists.reduce((sum, l) => sum + l.items.length, 0), lists: d.lists.filter((l) => l.items.length > 0).length, highlights: d.highlights?.length ?? 0 })),
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
