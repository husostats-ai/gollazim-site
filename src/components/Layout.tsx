import { Link, NavLink, Outlet } from 'react-router-dom'
import { NAV_ITEMS } from '../config/navigation'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'shrink-0 rounded-full px-3.5 py-2 text-xs font-bold tracking-wide whitespace-nowrap transition-colors',
    isActive ? 'bg-brand text-navy-950' : 'text-muted hover:bg-navy-700 hover:text-white',
  ].join(' ')

export default function Layout() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-navy-900">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <img src="./logo-256.png" alt="GOLLAZIM" className="h-11 w-11 rounded-xl sm:h-12 sm:w-12" />
            <span className="text-xl font-black italic tracking-tight sm:text-2xl">
              GOL<span className="text-brand">LAZIM</span>
            </span>
          </Link>
        </div>
        <nav className="no-scrollbar mx-auto flex max-w-6xl gap-1.5 overflow-x-auto px-4 pb-2.5 lg:flex-wrap">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
