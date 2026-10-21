import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import AdminBehindMain from '../components/AdminBehindMain'
import AdminPublishStatus from '../components/AdminPublishStatus'
import AdminTabBar, { adminPanelId, adminTabId } from '../components/AdminTabBar'
import BackupPanel from '../components/BackupPanel'
import BackupReminder from '../components/BackupReminder'
import HighlightsPanel from '../components/HighlightsPanel'
import StreakPanel from '../components/StreakPanel'
import LeagueTablePanel from '../components/LeagueTablePanel'
import MarketLimitPanel from '../components/MarketLimitPanel'
import MatchEditPanel from '../components/MatchEditPanel'
import MemberAdminSection from '../components/member/MemberAdminSection'
import MemberKeyReminder from '../components/member/MemberKeyReminder'
import MemberTextsPanel from '../components/member/MemberTextsPanel'
import { useMemberAdminData, useSiteVersionStatus } from '../components/member/useMemberAdmin'
import PageTitle from '../components/PageTitle'
import RawComparePanel from '../components/RawComparePanel'
import StoryPanel from '../components/StoryPanel'
import StoryTextsPanel from '../components/StoryTextsPanel'
import ThresholdPanel from '../components/ThresholdPanel'
import UploadPanel from '../components/UploadPanel'
import { ADMIN_TAB_PARAM, ADMIN_TABS, adminTabBadges, DEFAULT_ADMIN_TAB, parseAdminTab, sectionsOfTab, type AdminSectionId, type AdminTabId } from '../config/adminTabs'
import { keyBackupStatus } from '../services/memberAdmin/reminder'
import { useDailyStatus } from '../state/useDailyStatus'

/** Sekme açıldıktan sonra kaydırılacak kart; yapışkan üst menünün altında kalmasın diye pay bırakılır. */
function scrollToCard(testId: string): void {
  const card = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (!card) return
  const header = document.querySelector<HTMLElement>('header')
  window.scrollTo({ top: Math.max(0, card.getBoundingClientRect().top + window.scrollY - (header?.offsetHeight ?? 0) - 12) })
}

export default function AdminPage() {
  const daily = useDailyStatus()
  const memberData = useMemberAdminData()
  const siteStatus = useSiteVersionStatus()
  const [params, setParams] = useSearchParams()
  const active = parseAdminTab(params.get(ADMIN_TAB_PARAM))
  const [memberAttention, setMemberAttention] = useState(false)
  const [pendingScroll, setPendingScroll] = useState<{ tab: AdminTabId; testId: string } | null>(null)

  // Açık sekme adreste durur (#/admin?sekme=…): yenilemede aynı sekme açılır. Geçmişe yeni
  // kayıt eklenmez; geri tuşu sekmeler arasında değil, önceki sayfaya döner.
  const select = useCallback((tab: AdminTabId) => setParams(tab === DEFAULT_ADMIN_TAB ? {} : { [ADMIN_TAB_PARAM]: tab }, { replace: true }), [setParams])

  const openCard = (tab: AdminTabId, testId: string) => {
    select(tab)
    setPendingScroll({ tab, testId })
  }
  // Kart, sekmesi görünür olduktan sonra kaydırılır (gizli kartın yeri ölçülemez).
  useEffect(() => {
    if (!pendingScroll || pendingScroll.tab !== active) return
    scrollToCard(pendingScroll.testId)
    setPendingScroll(null)
  }, [pendingScroll, active])

  const badges = adminTabBadges({
    backupLevel: daily?.backup.level ?? null,
    keyBackupLevel: memberData ? keyBackupStatus(memberData.members, memberData.meta).level : null,
    siteLevel: siteStatus?.level ?? null,
    memberAttention,
  })

  // Her bölümün bileşeni. Üç üye kartını (yayınla, üyeler, anahtar yedeği) tek bileşen çizer.
  const views: Record<AdminSectionId, ReactNode> = {
    upload: <UploadPanel />,
    league: <LeagueTablePanel />,
    highlights: <HighlightsPanel />,
    streak: <StreakPanel />,
    story: <StoryPanel />,
    publish: <MemberAdminSection siteStatus={siteStatus} onAttention={setMemberAttention} />,
    members: null,
    keyBackup: null,
    memberTexts: <MemberTextsPanel />,
    rawCompare: <RawComparePanel />,
    backup: <BackupPanel />,
    matchEdit: <MatchEditPanel />,
    thresholds: <ThresholdPanel />,
    marketLimit: <MarketLimitPanel />,
    storyTexts: <StoryTextsPanel />,
  }

  return (
    <>
      <PageTitle title="ADMİN" />
      <AdminTabBar active={active} badges={badges} onSelect={select} />
      <BackupReminder status={daily} />
      <AdminBehindMain />
      <MemberKeyReminder onOpen={() => openCard('uyeler', 'member-admin-keybackup')} />
      {memberData && <AdminPublishStatus publications={memberData.publications} siteStatus={siteStatus} onOpen={() => openCard('uyeler', 'member-admin-publish')} />}
      {/* Dört sekmenin içeriği de açık kalır, aktif olmayan gizlenir: sekme değiştirince
          kaydedilmemiş metinler, önizlemeler ve bir kez gösterilen şifreler kaybolmaz. */}
      {ADMIN_TABS.map((tab) => (
        <div key={tab.id} role="tabpanel" id={adminPanelId(tab.id)} aria-labelledby={adminTabId(tab.id)} hidden={tab.id !== active} data-testid={adminPanelId(tab.id)} className="grid grid-cols-1 gap-4">
          {sectionsOfTab(tab.id).map((id) => (
            <Fragment key={id}>{views[id]}</Fragment>
          ))}
        </div>
      ))}
    </>
  )
}
