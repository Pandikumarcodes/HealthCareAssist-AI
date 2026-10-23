import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import type { DocumentMetadata } from '../../services/documents'

const original: DocumentMetadata = { id: 42, title: 'Fictional benefits policy', original_filename: 'fictional-policy.pdf', file_size: 2048,
  content_type: 'application/pdf', created_at: '2026-10-23T10:00:00Z', processing_status: 'INDEXED' }
let records: DocumentMetadata[]
let postStatus: number, deleteStatus: number, searchStatus: number
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
function response(body: unknown, status = 200) { return new Response(status === 204 ? null : JSON.stringify(body), { status }) }
function calls(method: string) { return fetchMock.mock.calls.filter(([, options]) => options?.method === method) }
function searches() { return fetchMock.mock.calls.filter(([url]) => String(url).includes('/documents/search?')) }
function renderAt(path = '/knowledge-base') { window.history.replaceState({}, '', path); return render(<App />) }
function file(name = 'fictional.pdf', type = 'application/pdf') { return new File(['fictional synthetic bytes'], name, { type }) }
function choose(value = file()) { fireEvent.change(screen.getByLabelText(/^PDF file/), { target: { files: [value] } }) }
function upload() { fireEvent.click(screen.getByRole('button', { name: 'Upload PDF' })) }
function query(value: string) { fireEvent.change(screen.getByLabelText('Search PDF content'), { target: { value } }) }
async function openDelete() {
  const button = (await screen.findAllByRole('button', { name: `Delete ${original.title}` }))[0]
  button.focus(); fireEvent.click(button); return screen.getByRole('dialog')
}
async function passages() { return screen.findByText('Fictional coverage includes annual checkups.') }

beforeEach(() => {
  records = [{ ...original }]; postStatus = 201; deleteStatus = 204; searchStatus = 200
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
    const parsed = new URL(String(url), 'http://localhost')
    if (parsed.pathname === '/api/dashboard/summary') return response({ total_requests: 0, open_requests: 0, in_progress_requests: 0, resolved_requests: 0 })
    if (options?.method === 'POST') {
      if (postStatus !== 201) return response({ error: 'Secret storage path', details: { file: '/private/path' } }, postStatus)
      const body = options.body as FormData
      const item: DocumentMetadata = { ...original, id: 43, title: String(body.get('title') || 'fictional'), original_filename: (body.get('file') as File).name }
      records = [item, ...records]; return response({ data: item }, 201)
    }
    if (options?.method === 'DELETE') {
      if (deleteStatus === 404) records = []
      if (deleteStatus !== 204) return response({ error: 'Secret database information' }, deleteStatus)
      records = records.filter((item) => item.id !== Number(parsed.pathname.split('/').at(-1)))
      return response(null, 204)
    }
    if (parsed.pathname === '/api/documents/search') {
      if (searchStatus !== 200) return response({ error: 'Secret SQL' }, searchStatus)
      const q = parsed.searchParams.get('q')!
      return response({ query: q, results: q === 'unmatched' ? [] : records.filter((item) => item.processing_status === 'INDEXED').map((item) => ({ document_id: item.id,
        document_title: item.title, chunk_id: item.id, page_number: 2, text: 'Fictional coverage includes annual checkups.', score: 0.42 })).slice(0, Number(parsed.searchParams.get('limit'))) })
    }
    if (parsed.pathname === '/api/documents') {
      const page = Number(parsed.searchParams.get('page')), size = Number(parsed.searchParams.get('page_size'))
      return response({ data: records.slice((page - 1) * size, page * size), page, page_size: size, total: records.length, total_pages: Math.ceil(records.length / size) })
    }
    const item = records.find((item) => item.id === Number(parsed.pathname.split('/').at(-1)))
    return item ? response({ data: item }) : response({ error: 'Document not found.' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Knowledge Base library', () => {
  it('renders the direct route, active navigation and synthetic-data guidance', async () => {
    renderAt()
    expect(screen.getByRole('heading', { level: 1, name: 'Knowledge Base' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Knowledge Base' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'AI Assistant Coming soon' })).toBeDisabled()
    expect(screen.getByText(/Fictional documents and synthetic data only/)).toBeInTheDocument()
    const table = await screen.findByRole('table')
    expect(table).toHaveTextContent(original.title + original.original_filename)
    expect(table).toHaveTextContent('2.0 KiB')
    expect(table.querySelector('time')).toHaveAttribute('datetime', original.created_at)
    expect(searches()).toHaveLength(0)
  })
  it('navigates from the dashboard using the enabled sidebar', async () => {
    renderAt('/dashboard'); fireEvent.click(screen.getByRole('link', { name: 'Knowledge Base' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/knowledge-base')
  })
  it('handles zero documents with disabled pagination', async () => {
    records = []; renderAt()
    expect(await screen.findByText('No documents yet.')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  })
  it('announces loading without showing a false empty list', () => {
    fetchMock.mockReturnValue(new Promise(() => {})); renderAt()
    expect(screen.getByRole('region', { name: 'Document library' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading documents…')).toBeInTheDocument()
    expect(screen.queryByText('No documents yet.')).not.toBeInTheDocument()
  })
  it('shows a sanitized library error and explicit retry', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'Secret filesystem path' }, 500)); renderAt()
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load documents')
    expect(screen.queryByText('Secret filesystem path')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })
  it('uses server pagination and recovers the last page after its last item is deleted', async () => {
    records = Array.from({ length: 21 }, (_, i) => ({ ...original, id: i + 1, title: `Fictional ${i + 1}` }))
    renderAt(); await screen.findByRole('table'); fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Page 2 of 2')
    expect(within(screen.getByRole('table')).getByText('Fictional 21')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete Fictional 21' })[0])
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete document' }))
    await screen.findByText('Document and indexed text deleted successfully.')
    await screen.findByText('Page 1 of 1')
    expect(within(screen.getByRole('table')).getByText('Fictional 1')).toBeInTheDocument()
    expect(screen.queryByText('Fictional 21')).not.toBeInTheDocument()
  })
  it.each([['INDEXED', 'Searchable'], ['UNPROCESSED', 'Not processed'], ['NO_TEXT', 'No selectable text'], ['FAILED', 'Processing failed']] as const)('renders the exact %s processing outcome', async (processing_status, label) => {
    records = [{ ...original, processing_status }]; renderAt()
    expect(within(await screen.findByRole('table')).getByText(label)).toBeInTheDocument()
  })
})

describe('PDF upload', () => {
  it('requires a file and focuses its control', async () => {
    renderAt(); upload()
    expect(screen.getByText('Choose a PDF file.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^PDF file/)).toHaveFocus()
    expect(calls('POST')).toHaveLength(0)
  })
  it.each([['fictional.txt', 'text/plain'], ['fictional.pdf', 'text/plain']])('rejects invalid type %s/%s', (name, type) => {
    renderAt(); choose(file(name, type)); upload()
    expect(screen.getByText('Choose a PDF file with a .pdf extension.')).toBeInTheDocument()
    expect(calls('POST')).toHaveLength(0)
  })
  it('rejects oversized and empty files before transmission', () => {
    renderAt(); const huge = file(); Object.defineProperty(huge, 'size', { value: 5242881 }); choose(huge); upload()
    expect(screen.getByText('The PDF must be 5 MiB or smaller.')).toBeInTheDocument()
    choose(new File([], 'empty.pdf', { type: 'application/pdf' })); upload()
    expect(screen.getByText('The PDF file must not be empty.')).toBeInTheDocument()
    expect(calls('POST')).toHaveLength(0)
  })
  it('validates title length before submission', () => {
    renderAt(); choose(); fireEvent.change(screen.getByLabelText(/^Document title/), { target: { value: 'x'.repeat(201) } }); upload()
    expect(screen.getByText('Use at most 200 characters without control characters.')).toBeInTheDocument()
    expect(calls('POST')).toHaveLength(0)
  })
  it('uploads a PDF, reports its outcome, clears the form and refreshes the library', async () => {
    renderAt(); await screen.findByRole('table'); choose()
    fireEvent.change(screen.getByLabelText(/^Document title/), { target: { value: '  Synthetic new policy  ' } }); upload()
    expect(await screen.findByText('Document uploaded.')).toBeInTheDocument()
    expect(within(await screen.findByRole('table')).getByText('Synthetic new policy')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View uploaded document' })).toHaveAttribute('href', '/knowledge-base/43')
    expect(screen.getByLabelText(/^Document title/)).toHaveValue('')
    expect(calls('POST')).toHaveLength(1)
  })
  it.each([400, 413, 500])('handles upload HTTP %s safely without automatic retries', async (status) => {
    postStatus = status; renderAt(); choose(); upload()
    expect(await screen.findByRole('alert')).toHaveTextContent(status === 413 ? 'Upload too large' : status === 400 ? 'Unable to upload' : 'Upload could not be confirmed')
    expect(screen.queryByText(/Secret storage path|\/private\/path/)).not.toBeInTheDocument()
    expect(calls('POST')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Upload PDF' })).toBeEnabled()
  })
  it('prevents synchronous duplicate submits and announces processing', async () => {
    renderAt(); await screen.findByRole('table'); choose()
    let resolve!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const form = screen.getByLabelText(/^PDF file/).closest('form')!
    fireEvent.submit(form); fireEvent.submit(form)
    await waitFor(() => expect(calls('POST')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Uploading and processing…' })).toBeDisabled()
    expect(screen.getByLabelText(/^PDF file/)).toBeDisabled()
    await act(async () => resolve(response({ data: original }, 201)))
    await screen.findByText('Document uploaded.')
  })
})

describe('document details', () => {
  it('shows safe metadata, processing outcome, timestamp and back navigation', async () => {
    renderAt('/knowledge-base/42')
    await screen.findByRole('heading', { level: 1, name: original.title })
    const details = screen.getByRole('region', { name: 'Document details' })
    expect(details).toHaveTextContent('application/pdf')
    expect(details).toHaveTextContent(original.original_filename)
    expect(details).toHaveTextContent('2,048 bytes')
    expect(details.querySelector('time')).toHaveAttribute('datetime', original.created_at)
    expect(screen.getByRole('link', { name: /Back to Knowledge Base/ })).toHaveAttribute('href', '/knowledge-base')
    expect(screen.getByRole('link', { name: 'Knowledge Base' })).toHaveAttribute('aria-current', 'page')
  })
  it('handles details loading', () => {
    fetchMock.mockReturnValue(new Promise(() => {})); renderAt('/knowledge-base/42')
    expect(screen.getByRole('status')).toHaveTextContent('Loading document details')
  })
  it.each(['/knowledge-base/999', '/knowledge-base/invalid'])('handles missing document at %s', async (path) => {
    renderAt(path); expect(await screen.findByRole('heading', { name: 'Document not found' })).toBeInTheDocument()
  })
  it('retries a details error without exposing internals', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'Secret SQL' }, 500)); renderAt('/knowledge-base/42')
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load document details')
    expect(screen.queryByText('Secret SQL')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { name: original.title })
  })
})

describe('document content search', () => {
  it('debounces input, shows actual passages and page references, and returns to the library', async () => {
    renderAt(); await screen.findByRole('table'); query('annual'); query('annual coverage')
    expect(searches()).toHaveLength(0)
    await passages()
    expect(searches()).toHaveLength(1)
    expect(screen.getByText('Page 2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: original.title })).toHaveAttribute('href', '/knowledge-base/42')
    expect(screen.queryByText(/42%/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All documents' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.queryByText('Fictional coverage includes annual checkups.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Search PDF content')).toHaveValue('')
  })
  it('omits empty search requests and rejects overlong queries locally', async () => {
    renderAt(); await screen.findByRole('table'); query('   ')
    expect(searches()).toHaveLength(0)
    query('x'.repeat(201))
    expect(screen.getByRole('alert')).toHaveTextContent('Use at most 200 characters')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)) })
    expect(searches()).toHaveLength(0)
  })
  it('shows no matches and provides a path back to all documents', async () => {
    renderAt(); query('unmatched')
    expect(await screen.findByText('No matching passages.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Browse all documents' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })
  it('passes the chosen result limit', async () => {
    renderAt(); query('coverage'); await passages()
    fireEvent.change(screen.getByLabelText('Maximum passages'), { target: { value: '20' } })
    await waitFor(() => expect(String(searches().at(-1)?.[0])).toContain('limit=20'))
  })
  it('handles search failure and retries explicitly', async () => {
    searchStatus = 500; renderAt(); query('coverage')
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to search documents')
    expect(searches()).toHaveLength(1)
    expect(screen.queryByText('Secret SQL')).not.toBeInTheDocument()
    searchStatus = 200; fireEvent.click(screen.getByRole('button', { name: 'Try search again' })); await passages()
  })
  it('hides prior passages immediately while a new query is being prepared', async () => {
    renderAt(); query('coverage'); await passages(); query('unmatched')
    expect(screen.queryByText('Fictional coverage includes annual checkups.')).not.toBeInTheDocument()
    await screen.findByText('No matching passages.')
  })
})

describe('document deletion', () => {
  it('requires confirmation, identifies the document and restores focus on cancel', async () => {
    renderAt(); const dialog = await openDelete()
    expect(dialog).toHaveTextContent(original.title)
    expect(dialog).toHaveTextContent('stored PDF and its indexed text')
    expect(calls('DELETE')).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: `Delete ${original.title}` })[0]).toHaveFocus()
    expect(calls('DELETE')).toHaveLength(0)
  })
  it('supports Escape dismissal and keyboard focus trapping', async () => {
    renderAt(); const dialog = await openDelete()
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' }), confirm = within(dialog).getByRole('button', { name: 'Delete document' })
    cancel.focus(); fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true }); expect(confirm).toHaveFocus()
    fireEvent.keyDown(confirm, { key: 'Tab' }); expect(cancel).toHaveFocus()
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('deletes only after confirmation and refreshes the library', async () => {
    renderAt(); const dialog = await openDelete()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete document' }))
    await screen.findByText('Document and indexed text deleted successfully.')
    expect(await screen.findByText('No documents yet.')).toBeInTheDocument()
    expect(calls('DELETE')).toHaveLength(1)
    expect(screen.queryByText(original.title)).not.toBeInTheDocument()
  })
  it('retains an accessible retry dialog after delete failure', async () => {
    deleteStatus = 500; renderAt(); const dialog = await openDelete()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete document' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to delete document')
    expect(dialog).toBeInTheDocument(); expect(screen.queryByText('Secret database information')).not.toBeInTheDocument()
    deleteStatus = 204; fireEvent.click(within(dialog).getByRole('button', { name: 'Delete document' }))
    await screen.findByText('No documents yet.')
  })
  it('prevents duplicate deletions and disallows dismissal while pending', async () => {
    renderAt(); const dialog = await openDelete()
    let resolve!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const confirm = within(dialog).getByRole('button', { name: 'Delete document' })
    fireEvent.click(confirm); fireEvent.click(confirm)
    await waitFor(() => expect(calls('DELETE')).toHaveLength(1))
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent(dialog, new Event('cancel', { cancelable: true })); expect(dialog).toBeInTheDocument()
    await act(async () => { records = []; resolve(response(null, 204)) })
    await screen.findByText('No documents yet.')
  })
  it('deletes from details, navigates safely, and refreshes an earlier search', async () => {
    renderAt(); query('coverage'); await passages()
    fireEvent.click(screen.getByRole('link', { name: 'View document details' }))
    await screen.findByRole('heading', { name: original.title })
    fireEvent.click(screen.getByRole('button', { name: 'Delete document' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete document' }))
    await screen.findByRole('heading', { name: 'Knowledge Base' })
    expect(window.location.pathname).toBe('/knowledge-base')
    query('coverage'); await screen.findByText('No matching passages.')
    expect(screen.queryByText('Fictional coverage includes annual checkups.')).not.toBeInTheDocument()
  })
  it('handles an already deleted document without repeated deletion attempts', async () => {
    deleteStatus = 404; renderAt('/knowledge-base/42'); await screen.findByRole('heading', { name: original.title })
    fireEvent.click(screen.getByRole('button', { name: 'Delete document' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete document' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already deleted')
    expect(within(dialog).getByRole('button', { name: 'Delete document' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await screen.findByRole('heading', { name: 'Knowledge Base' })
  })
})
