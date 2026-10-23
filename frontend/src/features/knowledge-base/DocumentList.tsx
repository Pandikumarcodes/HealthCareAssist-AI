import { Link } from 'react-router-dom'
import type { DocumentMetadata } from '../../services/documents'
import { DocumentDate, ProcessingBadge } from './DocumentPresentation'
import { fileSize } from '../../services/documents'

export function DocumentList({ documents, onDelete, busy }: { documents: DocumentMetadata[]; onDelete: (item: DocumentMetadata) => void; busy: boolean }) {
  const actions = (item: DocumentMetadata) => <div className="kb-row-actions"><Link className="request-title-link" to={`/knowledge-base/${item.id}`} aria-label={`View details for ${item.title}`}>View details</Link><button type="button" className="request-secondary" aria-label={`Delete ${item.title}`} disabled={busy} onClick={() => onDelete(item)}>Delete</button></div>
  return <>
    <table className="kb-table"><caption className="sr-only">PDF document library, newest first</caption>
      <thead><tr><th scope="col">Document</th><th scope="col">Size</th><th scope="col">Uploaded</th><th scope="col">Processing</th><th scope="col">Actions</th></tr></thead>
      <tbody>{documents.map((item) => <tr key={item.id}><th scope="row"><Link className="request-title-link" to={`/knowledge-base/${item.id}`}>{item.title}</Link><span className="kb-filename">{item.original_filename}</span></th><td>{fileSize(item.file_size)}</td><td><DocumentDate value={item.created_at} /></td><td><ProcessingBadge status={item.processing_status} /></td><td>{actions(item)}</td></tr>)}</tbody>
    </table>
    <ul className="kb-cards" aria-label="PDF document library, newest first">{documents.map((item) => <li key={item.id}>
      <ProcessingBadge status={item.processing_status} /><h3><Link className="request-title-link" to={`/knowledge-base/${item.id}`}>{item.title}</Link></h3><p className="kb-filename">{item.original_filename}</p>
      <dl><div><dt>File size</dt><dd>{fileSize(item.file_size)}</dd></div><div><dt>Uploaded</dt><dd><DocumentDate value={item.created_at} /></dd></div></dl>{actions(item)}
    </li>)}</ul>
  </>
}
