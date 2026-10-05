import { Link } from 'react-router-dom'
import EmptyState from './EmptyState'

export default function NoData() {
  return (
    <EmptyState>
      Henüz maç verisi yüklenmedi.{' '}
      <Link to="/admin" className="font-bold text-brand hover:underline">
        Admin sayfasından CSV yükleyin.
      </Link>
    </EmptyState>
  )
}
