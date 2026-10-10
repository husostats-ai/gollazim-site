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
import PageTitle from '../components/PageTitle'
import RawComparePanel from '../components/RawComparePanel'
import StoryPanel from '../components/StoryPanel'
import StoryTextsPanel from '../components/StoryTextsPanel'
import ThresholdPanel from '../components/ThresholdPanel'
import UploadPanel from '../components/UploadPanel'
import { useDailyStatus } from '../state/useDailyStatus'

export default function AdminPage() {
  const daily = useDailyStatus()
  return (
    <>
      <PageTitle title="ADMİN" />
      <BackupReminder status={daily} />
      <MemberKeyReminder />
      <div className="grid grid-cols-1 gap-4">
        <HighlightsPanel />
        <StreakPanel />
        <UploadPanel />
        <ThresholdPanel />
        <MarketLimitPanel />
        <MatchEditPanel />
        <LeagueTablePanel />
        <StoryPanel />
        <StoryTextsPanel />
        <MemberTextsPanel />
        <BackupPanel />
        <MemberAdminSection />
        <RawComparePanel />
      </div>
    </>
  )
}
