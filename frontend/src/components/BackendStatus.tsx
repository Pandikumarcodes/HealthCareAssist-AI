import { useEffect, useState } from 'react'
import { getHealth } from '../services/health'
import type { HealthResponse } from '../services/health'

type ConnectionState =
  | { status: 'loading' }
  | { status: 'success'; health: HealthResponse }
  | { status: 'error' }

export function BackendStatus() {
  const [connection, setConnection] = useState<ConnectionState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getHealth(controller.signal).then(
      (health) => {
        if (!controller.signal.aborted) setConnection({ status: 'success', health })
      },
      () => {
        if (!controller.signal.aborted) setConnection({ status: 'error' })
      },
    )
    return () => controller.abort()
  }, [attempt])

  return (
    <section className="connection-card" aria-labelledby="connection-title">
      <div className="card-heading">
        <span className="eyebrow">System connection</span>
        <span className="endpoint">GET /api/health</span>
      </div>
      <h2 id="connection-title">Backend availability</h2>
      <div role="status" aria-live="polite" aria-atomic="true">
        <p className={`connection-state ${connection.status}`}>
          <span className="status-dot" aria-hidden="true" />
          {connection.status === 'loading' && 'Checking backend connection…'}
          {connection.status === 'success' && 'Backend connected'}
          {connection.status === 'error' && 'Backend unavailable'}
        </p>
        {connection.status === 'success' && (
          <dl className="service-details">
            <div><dt>Service</dt><dd>{connection.health.service}</dd></div>
            <div><dt>Version</dt><dd>{connection.health.version}</dd></div>
          </dl>
        )}
        {connection.status === 'loading' && <p>Connecting to the application service.</p>}
        {connection.status === 'error' && <p>Start the Flask backend, check your API URL configuration, then try again.</p>}
      </div>
      <button type="button" disabled={connection.status === 'loading'} onClick={() => {
        setConnection({ status: 'loading' })
        setAttempt((value) => value + 1)
      }}>
        {connection.status === 'error' ? 'Try again' : 'Check connection'} <span aria-hidden="true">↗</span>
      </button>
      <p className="connection-note">This checks application availability only. Database connectivity is checked separately.</p>
    </section>
  )
}
