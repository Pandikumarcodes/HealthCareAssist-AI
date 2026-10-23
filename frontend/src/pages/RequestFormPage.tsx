import { Link, useNavigate, useParams } from 'react-router-dom'
import { RequestForm } from '../features/requests/RequestForm'
import { RequestLoadState } from '../features/requests/RequestLoadState'
import { useRequest, useRequestMutations } from '../features/requests/queries'
import type { RequestInput, RequestUpdate } from '../services/requests'
import '../features/requests/requests.css'

export function NewRequestPage() {
  const { create } = useRequestMutations()
  const navigate = useNavigate()
  return <>
    <Link className="text-link request-back" to="/requests">Back to Requests</Link>
    <div className="dashboard-heading"><div><p className="dashboard-eyebrow">Your support workspace</p><h1>New Request</h1><p>Tell us what you need help with.</p></div></div>
    <RequestForm pending={create.isPending} cancelTo="/requests" onSave={async (input) => {
      const item = await create.mutateAsync(input)
      navigate(`/requests/${item.id}`, { replace: true, state: { feedback: 'Request created successfully.' } })
    }} />
  </>
}

export function EditRequestPage() {
  const { id = '' } = useParams()
  const query = useRequest(id)
  const { update } = useRequestMutations(id)
  const navigate = useNavigate()
  if (query.isPending || query.isError) return <RequestLoadState pending={query.isPending} error={query.error} retry={() => { void query.refetch() }} />
  const item = query.data
  return <>
    <Link className="text-link request-back" to={`/requests/${id}`}>Back to request</Link>
    <div className="dashboard-heading"><div><p className="dashboard-eyebrow">Request #{item.id}</p><h1>Edit Request</h1><p>Update the information for this support request.</p></div></div>
    <RequestForm key={id} initial={item} pending={update.isPending} cancelTo={`/requests/${id}`} onSave={async (input: RequestInput) => {
      const changes: RequestUpdate = {}
      for (const key of ['title', 'description', 'category'] as const) if (input[key] !== item[key]) Object.assign(changes, { [key]: input[key] })
      if (Object.keys(changes).length) await update.mutateAsync(changes)
      navigate(`/requests/${id}`, { replace: true, state: { feedback: Object.keys(changes).length ? 'Request updated successfully.' : 'No changes to save.' } })
    }} />
  </>
}
