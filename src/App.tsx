import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { GROUPS } from './config/categories'
import AdminPage from './pages/AdminPage'
import CategoryPage from './pages/CategoryPage'
import GroupPage from './pages/GroupPage'
import HomePage from './pages/HomePage'
import ScoreEntryPage from './pages/ScoreEntryPage'
import StatsPage from './pages/StatsPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="kategori/:slug" element={<CategoryPage />} />
        {GROUPS.map((g) => (
          <Route key={g.id} path={g.slug} element={<GroupPage group={g} />} />
        ))}
        <Route path="skor-girisi" element={<ScoreEntryPage />} />
        <Route path="istatistik" element={<StatsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
