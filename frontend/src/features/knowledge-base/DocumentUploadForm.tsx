import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../services/api'
import { hasControlCharacters, MAX_PDF_BYTES, processingOutcomes } from '../../services/documents'
import type { DocumentMetadata, DocumentUpload } from '../../services/documents'

type Errors = { file?: string; title?: string }
export function DocumentUploadForm({ pending, onUpload }: { pending: boolean; onUpload: (input: DocumentUpload) => Promise<DocumentMetadata> }) {
  const [file, setFile] = useState<File>()
  const [title, setTitle] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState('')
  const [success, setSuccess] = useState<DocumentMetadata>()
  const lock = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  return <form className="dashboard-panel request-form kb-upload" ref={form} noValidate onSubmit={async (event) => {
    event.preventDefault()
    if (lock.current || pending) return
    const next: Errors = {}
    if (!file) next.file = 'Choose a PDF file.'
    else if (!/\.pdf$/i.test(file.name) || (file.type && !['application/pdf', 'application/x-pdf', 'application/octet-stream'].includes(file.type))) next.file = 'Choose a PDF file with a .pdf extension.'
    else if (file.size === 0) next.file = 'The PDF file must not be empty.'
    else if (file.size > MAX_PDF_BYTES) next.file = 'The PDF must be 5 MiB or smaller.'
    if (Array.from(title.trim()).length > 200 || hasControlCharacters(title.trim())) next.title = 'Use at most 200 characters without control characters.'
    setErrors(next); setFailure(''); setSuccess(undefined)
    if (next.file || next.title) { (next.file ? fileInput.current : form.current?.querySelector<HTMLInputElement>('#document-title'))?.focus(); return }
    lock.current = true
    try {
      const item = await onUpload({ file: file!, ...(title.trim() ? { title: title.trim() } : {}) })
      setSuccess(item); setFile(undefined); setTitle('')
      if (fileInput.current) fileInput.current.value = ''
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        const fields: Errors = {}
        if (error.details.file) fields.file = 'The backend could not validate this PDF. Choose a complete, unencrypted PDF with at least one page.'
        if (error.details.title) fields.title = 'Check the title or use a shorter filename for the default title.'
        setErrors(fields)
      }
      setFailure(error instanceof ApiError && error.status === 413 ? 'Upload too large. Choose a PDF of 5 MiB or smaller.' :
        error instanceof ApiError && error.status === 400 ? 'Unable to upload this document. Check the fields below.' :
          'Upload could not be confirmed. Check the document list before trying again to avoid a duplicate.')
    } finally { lock.current = false }
  }}>
    <div className="panel-heading"><h2>Upload a PDF</h2><span className="request-sort">Up to 5 MiB</span></div>
    <div className="request-form-body">
      <p className="kb-help">Add a fictional policy to your library. Selectable text is processed for search after upload.</p>
      {failure && <p className="field-error" role="alert">{failure}</p>}
      <fieldset disabled={pending}>
        <div className="request-field"><label htmlFor="document-file">PDF file <span className="kb-required">(required)</span></label>
          <input ref={fileInput} id="document-file" name="file" type="file" accept=".pdf,application/pdf" required aria-invalid={!!errors.file} aria-describedby={`document-file-help${errors.file ? ' document-file-error' : ''}`} onChange={(event) => { setFile(event.target.files?.[0]); setErrors((old) => ({ ...old, file: undefined })); setFailure(''); setSuccess(undefined) }} />
          <p id="document-file-help">PDF only. Maximum 5 MiB. Scanned PDFs have no searchable text without OCR.</p>{errors.file && <p id="document-file-error" className="field-error">{errors.file}</p>}
        </div>
        <div className="request-field"><label htmlFor="document-title">Document title <span className="kb-required">(optional)</span></label>
          <input id="document-title" name="title" value={title} aria-invalid={!!errors.title} aria-describedby={`document-title-help${errors.title ? ' document-title-error' : ''}`} onChange={(event) => { setTitle(event.target.value); setErrors((old) => ({ ...old, title: undefined })); setFailure('') }} />
          <p id="document-title-help">Up to 200 characters. Leave blank to use the filename.</p>{errors.title && <p id="document-title-error" className="field-error">{errors.title}</p>}
        </div>
      </fieldset>
      <button type="submit" disabled={pending}>{pending ? 'Uploading and processing…' : 'Upload PDF'}</button>
      <div role="status" aria-atomic="true" className="kb-upload-feedback">{pending ? 'Uploading PDF and processing its text. Please wait.' : success ? <><strong>Document uploaded. </strong>{processingOutcomes[success.processing_status].description} <Link to={`/knowledge-base/${success.id}`}>View uploaded document</Link></> : ''}</div>
    </div>
  </form>
}
