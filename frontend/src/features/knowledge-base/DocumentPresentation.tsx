import { processingOutcomes } from '../../services/documents'
import type { ProcessingStatus } from '../../services/documents'

const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const timestampFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
export function DocumentDate({ value, full = false }: { value: string; full?: boolean }) {
  return <time dateTime={value} title={timestampFormat.format(new Date(value))}>{(full ? timestampFormat : dateFormat).format(new Date(value))}</time>
}
export function ProcessingBadge({ status }: { status: ProcessingStatus }) {
  return <span className={`kb-status kb-status-${status.toLowerCase()}`} title={processingOutcomes[status].description}>{processingOutcomes[status].label}</span>
}
