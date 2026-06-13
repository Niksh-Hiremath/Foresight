import { NavLink, Outlet } from 'react-router-dom'
import './Layout.css'

const NAV_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/connectors', label: 'Connectors' },
  { to: '/upload', label: 'Upload' },
  { to: '/dashboard', label: 'Dashboard' },
]

export default function Layout() {
  return (
    <div className="app-shell">
      <nav className="nav">
        <span className="nav-brand">Foresight</span>
        <ul className="nav-links">
          {NAV_LINKS.map(({ to, label, end }) => (
            <li key={to}>
              <NavLink to={to} end={end} className={({ isActive }) => isActive ? 'active' : ''}>
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
