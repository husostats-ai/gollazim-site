import { Navigate, useParams } from 'react-router-dom'
import CategoryList from '../components/CategoryList'
import DayToolbar from '../components/DayToolbar'
import NoData from '../components/NoData'
import PageTitle from '../components/PageTitle'
import { getCategoryBySlug } from '../config/categories'
import { useApp } from '../state/AppContext'

export default function CategoryPage() {
  const { slug } = useParams()
  const { analysis, dates, loading } = useApp()
  const category = slug ? getCategoryBySlug(slug) : undefined
  if (!category || category.group) return <Navigate to="/" replace />
  return (
    <>
      <PageTitle title={category.label} />
      {loading ? null : dates.length === 0 ? (
        <NoData />
      ) : (
        <>
          <DayToolbar />
          <CategoryList analysis={analysis[category.id]} />
        </>
      )}
    </>
  )
}
