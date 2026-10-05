import CategoryList from '../components/CategoryList'
import DayToolbar from '../components/DayToolbar'
import NoData from '../components/NoData'
import PageTitle from '../components/PageTitle'
import { categoriesInGroup, type GroupDef } from '../config/categories'
import { useApp } from '../state/AppContext'

export default function GroupPage({ group }: { group: GroupDef }) {
  const { analysis, dates, loading } = useApp()
  return (
    <>
      <PageTitle title={group.label} />
      {loading ? null : dates.length === 0 ? (
        <NoData />
      ) : (
        <>
          <DayToolbar />
          <div className="space-y-8">
            {categoriesInGroup(group.id).map((c) => (
              <section key={c.id}>
                <h2 className="mb-2 text-lg font-extrabold tracking-wide text-brand">{c.label} ÖNERİLERİ</h2>
                <CategoryList analysis={analysis[c.id]} />
              </section>
            ))}
          </div>
        </>
      )}
    </>
  )
}
