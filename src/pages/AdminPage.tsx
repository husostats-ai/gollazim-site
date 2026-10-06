import BackupPanel from '../components/BackupPanel'
import BackupReminder from '../components/BackupReminder'
import MarketLimitPanel from '../components/MarketLimitPanel'
import MatchEditPanel from '../components/MatchEditPanel'
import PageTitle from '../components/PageTitle'
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
      <div className="grid grid-cols-1 gap-4">
        <UploadPanel />
        <ThresholdPanel />
        <MarketLimitPanel />
        <MatchEditPanel />
        <StoryPanel />
        <StoryTextsPanel />
        <BackupPanel />
      </div>
    </>
  )
}
