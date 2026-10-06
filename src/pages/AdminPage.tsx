import BackupPanel from '../components/BackupPanel'
import MatchEditPanel from '../components/MatchEditPanel'
import PageTitle from '../components/PageTitle'
import StoryPanel from '../components/StoryPanel'
import StoryTextsPanel from '../components/StoryTextsPanel'
import ThresholdPanel from '../components/ThresholdPanel'
import UploadPanel from '../components/UploadPanel'

export default function AdminPage() {
  return (
    <>
      <PageTitle title="ADMİN" />
      <div className="grid grid-cols-1 gap-4">
        <UploadPanel />
        <ThresholdPanel />
        <MatchEditPanel />
        <StoryPanel />
        <StoryTextsPanel />
        <BackupPanel />
      </div>
    </>
  )
}
