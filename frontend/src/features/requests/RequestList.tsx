import { requestCategories, requestStatuses } from '../../services/requests'
import type { RequestStatus, SupportRequest } from '../../services/requests'

const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const timestampFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function RequestDate({ value }: { value: string }) {
  const date = new Date(value)
  return <time dateTime={value} title={timestampFormat.format(date)}>{dateFormat.format(date)}</time>
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`request-status status-${status.toLowerCase()}`}><span aria-hidden="true" />{requestStatuses[status]}</span>
}

export function RequestList({ requests }: { requests: SupportRequest[] }) {
  return (
    <>
      <table className="request-table">
        <caption className="sr-only">Healthcare support requests, newest first</caption>
        <thead><tr><th scope="col">Request ID</th><th scope="col">Title</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col">Updated</th></tr></thead>
        <tbody>{requests.map((request) => <tr key={request.id}>
          <td className="request-id">#{request.id}</td><th scope="row"><Link className="request-title-link" to={`/requests/${request.id}`}>{request.title}</Link></th><td>{requestCategories[request.category]}</td><td><StatusBadge status={request.status} /></td><td><RequestDate value={request.created_at} /></td><td><RequestDate value={request.updated_at} /></td>
        </tr>)}</tbody>
      </table>
      <ul className="request-cards" aria-label="Healthcare support requests, newest first">
        {requests.map((request) => <li key={request.id}>
          <div className="request-card-heading"><span className="request-id">#{request.id}</span><StatusBadge status={request.status} /></div>
          <h3><Link className="request-title-link" to={`/requests/${request.id}`}>{request.title}</Link></h3>
          <dl><div><dt>Category</dt><dd>{requestCategories[request.category]}</dd></div><div><dt>Created</dt><dd><RequestDate value={request.created_at} /></dd></div><div><dt>Updated</dt><dd><RequestDate value={request.updated_at} /></dd></div></dl>
        </li>)}
      </ul>
    </>
  )
}
import { Link } from 'react-router-dom'
