import { Icon } from '../../components/layout/Icon'
import type { IconName } from '../../components/layout/Icon'

export function StatCard({ label, value, icon, tone, description }: {
  label: string
  value: number | undefined
  icon: IconName
  tone: string
  description: string
}) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <dt>
        <span>{label}</span>
        <span className="stat-icon"><Icon name={icon} /></span>
      </dt>
      <dd>
        <span className="stat-value">
          {value === undefined ? <span className="stat-placeholder" aria-label="Unavailable">—</span> : value.toLocaleString()}
        </span>
        <span className="stat-description">{description}</span>
      </dd>
    </div>
  )
}
