import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../services/api'
import { fileSize, processingOutcomes } from '../services/documents'
import type { DocumentMetadata } from '../services/documents'
import { DeleteDocumentDialog } from '../features/knowledge-base/DeleteDocumentDialog'
import { DocumentDate, ProcessingBadge } from '../features/knowledge-base/DocumentPresentation'
import { useDocument, useDocumentMutations } from '../features/knowledge-base/queries'
import '../features/requests/requests.css'
import '../features/knowledge-base/knowledge-base.css'

export function DocumentDetailsPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const document = useDocument(id)
  const { remove } = useDocumentMutations()
  const [selected, setSelected] = useState<DocumentMetadata>()
  const lock = useRef(false)
  const back = <Link className="text-link request-back" to="/knowledge-base">← Back to Knowledge Base</Link>
  const confirmation = selected && <DeleteDocumentDialog key="document-delete" item={selected} pending={remove.isPending} error={remove.error} onCancel={() => {
    if (remove.error instanceof ApiError && remove.error.status === 404) navigate('/knowledge-base', { replace: true, state: { feedback: 'This document was already deleted.' } })
    else setSelected(undefined)
  }} onDelete={() => {
    if (lock.current || remove.isPending) return
    lock.current = true
    remove.mutate(id, { onSuccess: () => navigate('/knowledge-base', { replace: true, state: { feedback: 'Document and indexed text deleted successfully.' } }), onSettled: () => { lock.current = false } })
  }} />
  if (document.isPending) return <>{back}<p role="status" className="request-loading">Loading document details…</p>{confirmation}</>
  if (document.isError) return <>{back}<section className="dashboard-panel request-state">{document.error instanceof ApiError && document.error.status === 404 ? <><h1>Document not found</h1><p>This document may have been deleted or the link is invalid.</p></> : <><h1>Document unavailable</h1><p role="alert">Unable to load document details. Check your connection and try again.</p><button type="button" onClick={() => { void document.refetch() }}>Try again</button></>}</section>{confirmation}</>
  const item = document.data
  return <>{back}<div className="dashboard-heading request-detail-heading"><div><p className="dashboard-eyebrow">Document details</p><h1 id="kb-heading" tabIndex={-1}>{item.title}</h1><p>Metadata and processing outcome for this library document.</p></div><button type="button" className="request-danger" disabled={remove.isPending} onClick={() => { remove.reset(); setSelected(item) }}>Delete document</button></div>
    <section className="dashboard-panel request-detail" aria-label="Document details"><div className="panel-heading"><h2>Document information</h2><ProcessingBadge status={item.processing_status} /></div>
      <dl className="request-metadata"><div><dt>Document ID</dt><dd>#{item.id}</dd></div><div><dt>Original filename</dt><dd>{item.original_filename}</dd></div><div><dt>File size</dt><dd>{fileSize(item.file_size)} ({item.file_size.toLocaleString()} bytes)</dd></div><div><dt>Content type</dt><dd>{item.content_type}</dd></div><div><dt>Uploaded</dt><dd><DocumentDate value={item.created_at} full /></dd></div><div><dt>Processing outcome</dt><dd>{processingOutcomes[item.processing_status].description}</dd></div></dl>
    </section>
    {confirmation}
  </>
}
