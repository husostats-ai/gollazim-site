import { useCallback, useEffect, useState } from 'react'
import { aiRepo, aiSharesRepo, highlightsRepo, leagueRepo, matchesRepo, memberAdminRepo, picksRepo, resultsRepo, settingsRepo, sharedRepo, streakRepo } from '../../services/data'
import type { PublishSources } from '../../services/memberAdmin/publish'
import { aiShareId, recordAiShares } from '../../services/ai/memberShare'
import { MEMBER_SITE_VERSION_URL } from '../../config/member'
import { MEMBER_PAYLOAD_VERSION } from '../../services/member/payload'
import { fetchSiteVersion, siteVersionStatus, type SiteVersionStatus } from '../../services/memberAdmin/siteVersion'
import type { MemberMeta, MemberRecord, PublicationRecord } from '../../services/memberAdmin/types'

export interface MemberAdminData {
  members: MemberRecord[]
  meta: MemberMeta
  publications: PublicationRecord[]
}

// Üye kayıtları değişince (ekleme, çıkarma, yayın, yedek) bu veriyi okuyan tüm paneller yenilenir.
const listeners = new Set<() => void>()
export const notifyMemberAdminChanged = (): void => listeners.forEach((listener) => listener())

/** Üye kayıtlarını okur; kayıtlar değişince kendiliğinden yenilenir. Yüklenene dek null. */
export function useMemberAdminData(): MemberAdminData | null {
  const [data, setData] = useState<MemberAdminData | null>(null)
  const load = useCallback(async () => {
    const [members, meta, publications] = await Promise.all([memberAdminRepo.listMembers(), memberAdminRepo.getMeta(), memberAdminRepo.listPublications()])
    setData({ members, meta, publications })
  }, [])
  useEffect(() => {
    void load()
    const listener = () => void load()
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }, [load])
  return data
}

/**
 * Ayrı üye sitesinin sürümü ile bu sürümün karşılaştırması; okunana dek null.
 * Üye sitesi ayrı yayınlanır ve eski kalabilir: sürümü aynı alan adındaki adresinden okunur.
 */
export function useSiteVersionStatus(): SiteVersionStatus | null {
  const [status, setStatus] = useState<SiteVersionStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetchSiteVersion(MEMBER_SITE_VERSION_URL, (url, init) => fetch(url, init), Date.now()).then((site) => {
      if (!cancelled) setStatus(siteVersionStatus(site, { commit: __APP_COMMIT__, payloadVersion: MEMBER_PAYLOAD_VERSION }))
    })
    return () => {
      cancelled = true
    }
  }, [])
  return status
}

/** Yayın paketinin kurulduğu veriler: uygulamanın kendi veri deposu */
export const publishSources: PublishSources = {
  listMatchesByDate: (date) => matchesRepo.listByDate(date),
  listResultsByMatchIds: (ids) => resultsRepo.listByMatchIds(ids),
  listPicks: () => picksRepo.listAll(),
  listShared: () => sharedRepo.listAll(),
  listHighlightsByDate: (date) => highlightsRepo.listByDate(date),
  markHighlightsPublished: (ids, publishedAt) => highlightsRepo.markPublished(ids, publishedAt),
  listAiVerdictsByDate: (date) => aiRepo.listVerdictsByDate(date),
  recordAiShares: async (sent, n, publishedAt) => aiSharesRepo.putMany(recordAiShares(await aiSharesRepo.getMany(sent.map((s) => aiShareId(s.matchId, s.categoryId))), sent, n, publishedAt)),
  listStreakSteps: () => streakRepo.listAll(),
  listMatchesByIds: (ids) => matchesRepo.getMany(ids),
  markStreakPublished: (ids, publishedAt) => streakRepo.markPublished(ids, publishedAt),
  listLeagueTables: () => leagueRepo.listTables(),
  listLeagueSnapshots: () => leagueRepo.listSnapshots(),
  listAliases: () => leagueRepo.listAliases(),
  getThresholds: () => settingsRepo.getThresholds(),
  getMarketConflictLimit: () => settingsRepo.getMarketConflictLimit(),
}

/** Metni dosya olarak indirir */
export function downloadText(fileName: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
