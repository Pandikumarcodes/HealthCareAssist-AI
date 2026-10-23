import { useQuery } from '@tanstack/react-query'
import { Icon } from '../components/layout/Icon'
import { DashboardStatus } from '../features/dashboard/DashboardStatus'
import { StatCard } from '../features/dashboard/StatCard'
import { getDashboardSummary } from '../services/dashboard'

export function DashboardPage() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: ({ signal }) => getDashboardSummary(signal),
  })
  const summary = isError ? undefined : data
  const statuses = [
    { label: 'Open', count: summary?.open_requests, tone: 'blue' },
    { label: 'In progress', count: summary?.in_progress_requests, tone: 'amber' },
    { label: 'Resolved', count: summary?.resolved_requests, tone: 'teal' },
  ]

  return (
    <>
      <div className="dashboard-heading"><div><p className="dashboard-eyebrow">Your support workspace</p><h1>Dashboard</h1><p>An overview of your healthcare support requests.</p></div><span className={`summary-badge${summary ? ' is-loaded' : ''}`}><span />{isPending ? 'Connecting' : isError ? 'Summary unavailable' : 'Summary loaded'}</span></div>
      <section className="overview-banner" aria-labelledby="overview-title">
        <div><p className="banner-eyebrow">Clarity at every step</p><h2 id="overview-title">Better support starts with a clearer picture.</h2><p>Keep an eye on every request, from the first question to resolution.</p></div>
        <div className="banner-art" aria-hidden="true"><span className="banner-ring" /><svg viewBox="0 0 200 70" fill="none"><path d="M0 36h49l15-16 18 34 22-47 23 57 19-28h54" /></svg><span className="banner-cross">+</span></div>
      </section>
      <div className="section-heading"><h2>Request summary</h2><span>All requests · All time</span></div>
      <DashboardStatus loading={isPending} error={isError} retry={() => { void refetch() }} />
      <dl className="stats-grid" aria-label="Request statistics" aria-busy={isPending}>
        <StatCard label="Total Requests" value={summary?.total_requests} icon="requests" tone="teal" description="Across all statuses" />
        <StatCard label="Open Requests" value={summary?.open_requests} icon="requests" tone="blue" description="Awaiting attention" />
        <StatCard label="In Progress" value={summary?.in_progress_requests} icon="clock" tone="amber" description="Currently being handled" />
        <StatCard label="Resolved Requests" value={summary?.resolved_requests} icon="check" tone="green" description="Support delivered" />
      </dl>
      <div className="dashboard-details">
        <section className="dashboard-panel requests-panel" aria-labelledby="requests-title">
          <div className="panel-heading"><h2 id="requests-title">Request overview</h2><Icon name="requests" /></div>
          {summary ? summary.total_requests === 0 ? (
            <div className="empty-state">
              <div className="empty-illustration" aria-hidden="true"><span className="empty-orbit" /><span className="empty-document"><Icon name="requests" /></span><span className="empty-check"><Icon name="check" /></span><span className="empty-spark">+</span></div>
              <h3>No support requests yet.</h3><p>Your workspace is ready. Metrics will update when support requests are created.</p><span className="empty-caption">A fresh start for better support</span>
            </div>
          ) : (
            <div className="populated-overview"><span className="overview-symbol"><Icon name="requests" /></span><p className="overview-total">{summary.total_requests.toLocaleString()}</p><h3>Support requests in your workspace</h3><p>{(summary.open_requests + summary.in_progress_requests).toLocaleString()} awaiting attention or in progress.</p><p>{summary.resolved_requests.toLocaleString()} resolved.</p></div>
          ) : <div className="panel-unavailable"><Icon name={isError ? 'requests' : 'clock'} /><p>{isError ? 'Request overview is unavailable.' : 'Your request overview will appear here.'}</p></div>}
        </section>
        <section className="dashboard-panel breakdown-panel" aria-labelledby="breakdown-title">
          <div className="panel-heading"><h2 id="breakdown-title">Status breakdown</h2><Icon name="grid" /></div>
          <p className="panel-description">Where your requests stand.</p>
          <ul className="status-list">
            {statuses.map(({ label, count, tone }) => (
              <li className={`tone-${tone}`} key={label}><div className="status-row"><span><span className="category-dot" />{label}</span><strong>{count === undefined ? '—' : count.toLocaleString()}</strong></div><div className="status-track" aria-hidden="true"><span style={{ width: `${summary && summary.total_requests > 0 && count !== undefined ? count / summary.total_requests * 100 : 0}%` }} /></div></li>
            ))}
          </ul>
          <p className="breakdown-note"><Icon name="shield" />{summary ? summary.total_requests === 0 ? 'Your first request will bring this overview to life.' : 'Every request is included in the summary above.' : 'Waiting for request metrics.'}</p>
        </section>
      </div>
      <p className="dashboard-data-note"><Icon name="refresh" /> Metrics reflect the latest successful load. Reload to refresh.</p>
    </>
  )
}
