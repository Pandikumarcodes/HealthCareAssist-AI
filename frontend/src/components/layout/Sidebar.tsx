import { Link, NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import type { IconName } from './Icon'

const upcoming: { label: string; icon: IconName }[] = [
  { label: 'AI Assistant', icon: 'sparkles' },
]

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  return (
    <aside id="workspace-navigation" className={`dashboard-sidebar${open ? ' is-open' : ''}`}>
      <Link className="dashboard-brand" to="/" onClick={onNavigate} aria-label="HealthCareAssist AI home">
        <span className="dashboard-brand-mark" aria-hidden="true">+</span>
        <span>HealthCareAssist<span className="brand-subtitle">AI WORKSPACE</span></span>
      </Link>
      <nav aria-label="Workspace">
        <p className="nav-label">Workspace</p>
        <NavLink className="nav-item" to="/dashboard" onClick={onNavigate}><Icon name="grid" /><span>Dashboard</span></NavLink>
        <NavLink className="nav-item" to="/requests" onClick={onNavigate}><Icon name="requests" /><span>Support Requests</span></NavLink>
        <NavLink className="nav-item" to="/knowledge-base" onClick={onNavigate}><Icon name="book" /><span>Knowledge Base</span></NavLink>
        {upcoming.map(({ label, icon }) => (
          <button className="nav-item nav-upcoming" key={label} type="button" disabled>
            <Icon name={icon} /><span>{label}{' '}<span className="coming-soon">Coming soon</span></span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note"><Icon name="shield" /><p>Care starts with connection.<span>A clearer view of healthcare support, in one place.</span></p></div>
        <Link className="welcome-link" to="/" onClick={onNavigate}>Welcome & connection <Icon name="arrow" /></Link>
        <p className="sidebar-version">HealthCareAssist AI</p>
      </div>
    </aside>
  )
}
