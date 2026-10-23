import { Icon } from '../../components/layout/Icon'

export function DashboardStatus({ loading, error, retry }: { loading: boolean; error: boolean; retry: () => void }) {
  if (error) return (
    <div className="dashboard-notice error-notice" role="alert">
      <div><strong>Unable to load dashboard</strong><p>We couldn’t retrieve your request metrics. Please try again.</p></div>
      <button className="dashboard-button" type="button" onClick={retry}><Icon name="refresh" /> Try again</button>
    </div>
  )
  if (loading) return <div className="dashboard-notice loading-notice" role="status"><span className="loading-spinner" aria-hidden="true" /> Loading dashboard metrics…</div>
  return null
}
