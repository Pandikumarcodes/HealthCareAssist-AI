import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../app/authenticated-test-app'
import type { SupportRequest } from '../../services/requests'

const original: SupportRequest = { id: 42, title: 'Synthetic coverage question', description: 'Synthetic policy details.', category: 'COVERAGE', status: 'OPEN', created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T11:00:00Z' }
let item: SupportRequest | undefined
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
function response(body: unknown, status = 200) { return new Response(status === 204 ? null : JSON.stringify(body), { status }) }
function mutations(method: string) { return fetchMock.mock.calls.filter(([, options]) => options?.method === method) }
function renderAt(path: string) { window.history.replaceState({}, '', path); return render(<App />) }
async function details() { await screen.findByRole('heading', { level: 1, name: item!.title }) }
function fill(title = 'Synthetic new question') {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: title } })
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Synthetic new details.' } })
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'CLAIMS' } })
}
function submit(name: string) { fireEvent.click(screen.getByRole('button', { name })) }
async function openDelete() { screen.getByRole('button', { name: 'Delete' }).focus(); submit('Delete'); return screen.getByRole('dialog') }

beforeEach(() => {
  item = { ...original }
  // jsdom does not implement the browser's native dialog top layer.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
    const path = String(url).split('?')[0]
    if (path === '/api/dashboard/summary') return response({ total_requests: item ? 1 : 0, open_requests: item?.status === 'OPEN' ? 1 : 0, in_progress_requests: item?.status === 'IN_PROGRESS' ? 1 : 0, resolved_requests: item?.status === 'RESOLVED' ? 1 : 0 })
    if (options?.method === 'POST') { item = { ...original, ...JSON.parse(options.body as string) }; return response({ data: item }, 201) }
    if (options?.method === 'PATCH') { item = { ...item!, ...JSON.parse(options.body as string), updated_at: '2026-10-23T12:00:00Z' }; return response({ data: item }) }
    if (options?.method === 'DELETE') { item = undefined; return response(null, 204) }
    if (path === '/api/requests') return response({ data: item ? [item] : [], page: 1, page_size: 20, total: item ? 1 : 0, total_pages: item ? 1 : 0 })
    return item ? response({ data: item }) : response({ error: 'Support request not found.' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('request creation', () => {
  it('opens New Request from the existing list and renders every required field', async () => {
    renderAt('/requests')
    fireEvent.click(screen.getByRole('link', { name: 'New Request' }))
    expect(screen.getByRole('heading', { name: 'New Request' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toBeRequired()
    expect(screen.getByLabelText('Description')).toBeRequired()
    expect(screen.getByLabelText('Category')).toBeRequired()
    expect(screen.getAllByRole('option').map((el) => el.textContent)).toEqual(['Select a category', 'General', 'Coverage', 'Claims', 'Appointment'])
  })

  it('validates blank fields, focuses the first error, and sends no POST', () => {
    renderAt('/requests/new'); submit('Create request')
    expect(screen.getByText('Title is required.')).toBeInTheDocument()
    expect(screen.getByText('Description is required.')).toBeInTheDocument()
    expect(screen.getByText('Choose a category.')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveFocus()
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true')
    expect(mutations('POST')).toHaveLength(0)
    fill()
    expect(screen.queryByText('Title is required.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'false')
  })

  it('rejects titles longer than 200 characters', () => {
    renderAt('/requests/new'); fill('x'.repeat(201)); submit('Create request')
    expect(screen.getByText('Title must be at most 200 characters.')).toBeInTheDocument()
    expect(mutations('POST')).toHaveLength(0)
  })

  it('matches backend trimming and Unicode title length, creates, and opens real details', async () => {
    renderAt('/requests/new'); fill(`  ${'😀'.repeat(200)}  `); submit('Create request')
    await screen.findByText('Request created successfully.')
    expect(window.location.pathname).toBe('/requests/42')
    expect(JSON.parse(mutations('POST')[0][1]!.body as string)).toEqual({ title: '😀'.repeat(200), description: 'Synthetic new details.', category: 'CLAIMS' })
    expect(screen.getByText('Synthetic new details.')).toBeInTheDocument()
  })

  it('displays server field errors, retains input, and allows correction', async () => {
    fetchMock.mockResolvedValueOnce(response({ details: { title: 'Must be at most 200 characters.' } }, 400))
    renderAt('/requests/new'); fill(); submit('Create request')
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save request')
    expect(screen.getByText('Must be at most 200 characters.')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Synthetic new question')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Corrected synthetic title' } }); submit('Create request')
    await screen.findByText('Request created successfully.')
  })

  it('handles failed creation without exposing server details', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'Sensitive database details' }, 500))
    renderAt('/requests/new'); fill(); submit('Create request')
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save request')
    expect(screen.queryByText('Sensitive database details')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create request' })).toBeEnabled()
  })

  it('prevents duplicate creation and disables form controls while pending', async () => {
    let resolve!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    renderAt('/requests/new'); fill()
    const form = screen.getByLabelText('Title').closest('form')!
    fireEvent.submit(form); fireEvent.submit(form)
    await waitFor(() => expect(mutations('POST')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Saving request…' })).toBeDisabled()
    expect(screen.getByLabelText('Description')).toBeDisabled()
    await act(async () => resolve(response({ data: original }, 201)))
    await screen.findByText('Request created successfully.')
  })

  it('cancels creation without writing data', async () => {
    renderAt('/requests/new'); fill(); fireEvent.click(screen.getByRole('link', { name: 'Cancel' }))
    await screen.findByRole('heading', { name: 'Support Requests' })
    expect(mutations('POST')).toHaveLength(0)
  })
})

describe('request details and editing', () => {
  it('links list titles to details', async () => {
    renderAt('/requests')
    const links = await screen.findAllByRole('link', { name: original.title })
    expect(links[0]).toHaveAttribute('href', '/requests/42')
    fireEvent.click(links[0]); await details()
    expect(screen.getByText(original.description)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Support Requests' })).toHaveAttribute('aria-current', 'page')
    const region = screen.getByRole('region', { name: 'Request details' })
    expect(within(region).getByText('#42')).toBeInTheDocument()
    expect(within(region).getByText('Coverage')).toBeInTheDocument()
    expect(region.querySelectorAll('time')[0]).toHaveAttribute('datetime', original.created_at)
    expect(region.querySelectorAll('time')[1]).toHaveAttribute('datetime', original.updated_at)
  })

  it('announces details loading without fake data', () => {
    fetchMock.mockReturnValue(new Promise(() => {})); renderAt('/requests/42')
    expect(screen.getByRole('status')).toHaveTextContent('Loading request')
    expect(screen.queryByText(original.description)).not.toBeInTheDocument()
  })

  it.each(['/requests/42', '/requests/42/edit', '/requests/not-an-id'])('shows not-found with a way back at %s', async (path) => {
    item = undefined; renderAt(path)
    expect(await screen.findByRole('heading', { name: 'Request not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Requests' })).toHaveAttribute('href', '/requests')
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('retries a details error without exposing response text', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'Secret internals' }, 500))
    renderAt('/requests/42')
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load request')
    expect(screen.queryByText('Secret internals')).not.toBeInTheDocument()
    submit('Try again'); await details()
  })

  it('prefills editing, validates, and patches only changed fields', async () => {
    renderAt('/requests/42'); await details()
    fireEvent.click(screen.getByRole('link', { name: 'Edit request' }))
    expect(await screen.findByLabelText('Title')).toHaveValue(original.title)
    expect(screen.getByLabelText('Description')).toHaveValue(original.description)
    expect(screen.getByLabelText('Category')).toHaveValue('COVERAGE')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Updated synthetic title  ' } }); submit('Save changes')
    await screen.findByText('Request updated successfully.')
    expect(JSON.parse(mutations('PATCH')[0][1]!.body as string)).toEqual({ title: 'Updated synthetic title' })
    expect(screen.getByRole('heading', { name: 'Updated synthetic title' })).toBeInTheDocument()
    expect(item!.description).toBe(original.description)
    expect(item!.status).toBe('OPEN')
  })

  it('returns to details without an unnecessary PATCH when unchanged', async () => {
    renderAt('/requests/42/edit'); await screen.findByLabelText('Title'); submit('Save changes')
    await screen.findByText('No changes to save.')
    expect(mutations('PATCH')).toHaveLength(0)
  })

  it.each([400, 404, 500])('retains edits after HTTP %s and shows actionable feedback', async (status) => {
    renderAt('/requests/42/edit'); await screen.findByLabelText('Title')
    fetchMock.mockResolvedValueOnce(response({ details: { description: 'Must be a nonblank string.' } }, status))
    fill(); submit('Save changes')
    expect(await screen.findByRole('alert')).toHaveTextContent(status === 404 ? 'This request no longer exists' : 'Unable to save request')
    expect(screen.getByLabelText('Title')).toHaveValue('Synthetic new question')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    if (status === 400) expect(screen.getByText('Must be a nonblank string.')).toBeInTheDocument()
  })

  it('prevents duplicate edit submissions while pending', async () => {
    renderAt('/requests/42/edit'); await screen.findByLabelText('Title'); fill()
    fetchMock.mockReturnValueOnce(new Promise(() => {}))
    const form = screen.getByLabelText('Title').closest('form')!
    fireEvent.submit(form); fireEvent.submit(form)
    await waitFor(() => expect(mutations('PATCH')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Saving request…' })).toBeDisabled()
  })
})

describe('status and deletion', () => {
  it.each(['IN_PROGRESS', 'RESOLVED', 'OPEN'] as const)('supports changing to %s without extra workflow rules', async (status) => {
    item = { ...original, status: status === 'OPEN' ? 'RESOLVED' : 'OPEN' }
    renderAt('/requests/42'); await details()
    expect(screen.getByRole('button', { name: 'Save status' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Request status'), { target: { value: status } }); submit('Save status')
    await screen.findByText('Status updated successfully.')
    expect(JSON.parse(mutations('PATCH')[0][1]!.body as string)).toEqual({ status })
    expect(screen.getByLabelText('Request status')).toHaveValue(status)
    expect(screen.getByRole('button', { name: 'Save status' })).toBeDisabled()
  })

  it('handles status failure and allows retry', async () => {
    renderAt('/requests/42'); await details()
    fetchMock.mockResolvedValueOnce(response({ error: 'Secret SQL' }, 500))
    fireEvent.change(screen.getByLabelText('Request status'), { target: { value: 'IN_PROGRESS' } }); submit('Save status')
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to update status')
    expect(screen.getByText('Open', { selector: '.request-status' })).toBeInTheDocument()
    expect(screen.queryByText('Secret SQL')).not.toBeInTheDocument()
    submit('Save status'); await screen.findByText('Status updated successfully.')
  })

  it('disables status and destructive controls during a pending status save', async () => {
    renderAt('/requests/42'); await details(); fetchMock.mockReturnValueOnce(new Promise(() => {}))
    fireEvent.change(screen.getByLabelText('Request status'), { target: { value: 'RESOLVED' } })
    const form = screen.getByLabelText('Request status').closest('form')!
    fireEvent.submit(form); fireEvent.submit(form)
    await waitFor(() => expect(mutations('PATCH')).toHaveLength(1))
    expect(screen.getByLabelText('Request status')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('requires confirmation identifying the request and allows cancellation', async () => {
    renderAt('/requests/42'); await details(); const dialog = await openDelete()
    expect(dialog).toHaveAccessibleName('Delete request #42?')
    expect(within(dialog).getByText(original.title)).toBeInTheDocument()
    expect(mutations('DELETE')).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mutations('DELETE')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()
  })

  it('supports Escape cancellation', async () => {
    renderAt('/requests/42'); await details(); const dialog = await openDelete()
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mutations('DELETE')).toHaveLength(0)
  })

  it('keeps keyboard focus inside the delete dialog in both directions', async () => {
    renderAt('/requests/42'); await details(); const dialog = await openDelete()
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    const confirm = within(dialog).getByRole('button', { name: 'Delete request' })
    confirm.focus(); fireEvent.keyDown(confirm, { key: 'Tab' })
    expect(cancel).toHaveFocus()
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(confirm).toHaveFocus()
  })

  it('deletes after confirmation and navigates to the refreshed list', async () => {
    renderAt('/requests/42'); await details(); const dialog = await openDelete()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete request' }))
    await screen.findByText('No support requests yet.')
    expect(window.location.pathname).toBe('/requests')
    expect(screen.getByRole('status')).toHaveTextContent('Request deleted successfully.')
    expect(mutations('DELETE')).toHaveLength(1)
    const deleteIndex = fetchMock.mock.calls.findIndex(([, options]) => options?.method === 'DELETE')
    expect(fetchMock.mock.calls.slice(deleteIndex + 1).filter(([url]) => url === '/api/requests/42')).toHaveLength(0)
  })

  it.each([404, 500])('handles delete HTTP %s without navigating away', async (status) => {
    renderAt('/requests/42'); await details(); const dialog = await openDelete()
    fetchMock.mockResolvedValueOnce(response({ error: 'Secret internals' }, status))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete request' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(status === 404 ? 'already deleted' : 'Unable to delete request')
    expect(window.location.pathname).toBe('/requests/42')
    expect(screen.queryByText('Secret internals')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('prevents repeated deletion and cancellation while pending', async () => {
    renderAt('/requests/42'); await details(); const dialog = await openDelete()
    fetchMock.mockReturnValueOnce(new Promise(() => {}))
    const confirm = within(dialog).getByRole('button', { name: 'Delete request' })
    fireEvent.click(confirm); fireEvent.click(confirm)
    await waitFor(() => expect(mutations('DELETE')).toHaveLength(1))
    expect(within(dialog).getByRole('button', { name: 'Deleting…' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('mutation cache consistency', () => {
  it('invalidates only lists, affected details, and dashboard summary after creating', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    renderAt('/requests/new'); fill(); submit('Create request')
    await screen.findByText('Request created successfully.')
    expect(invalidate.mock.calls.map(([options]) => options)).toEqual([
      { queryKey: ['requests'], refetchType: 'all' }, { queryKey: ['request', '42'], exact: true }, { queryKey: ['dashboard', 'summary'], exact: true, refetchType: 'all' },
    ])
  })

  it('refreshes cached dashboard and list values through status changes and deletion', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    const remove = vi.spyOn(QueryClient.prototype, 'removeQueries')
    renderAt('/dashboard'); await screen.findByText('Summary loaded')
    fireEvent.click(screen.getByRole('link', { name: 'Support Requests' }))
    const links = await screen.findAllByRole('link', { name: original.title }); fireEvent.click(links[0]); await details()
    fireEvent.change(screen.getByLabelText('Request status'), { target: { value: 'RESOLVED' } }); submit('Save status')
    await screen.findByText('Status updated successfully.')
    expect(invalidate.mock.calls.map(([options]) => options)).toContainEqual({ queryKey: ['request', '42'], exact: true })
    fireEvent.click(screen.getByRole('link', { name: 'Dashboard' })); await screen.findByText('Summary loaded')
    expect(within(screen.getByText('Resolved Requests').closest('dt')!.parentElement!).getByRole('definition')).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('link', { name: 'Support Requests' }))
    const updatedLinks = await screen.findAllByRole('link', { name: original.title }); fireEvent.click(updatedLinks[0]); await details()
    const dialog = await openDelete(); fireEvent.click(within(dialog).getByRole('button', { name: 'Delete request' }))
    await screen.findByText('No support requests yet.')
    expect(remove).toHaveBeenCalledWith({ queryKey: ['request', '42'], exact: true })
    fireEvent.click(screen.getByRole('link', { name: 'Dashboard' })); await screen.findByText('No support requests yet.')
    for (const value of screen.getAllByRole('definition')) expect(value).toHaveTextContent('0')
    expect(invalidate.mock.calls.every(([options]) => ['requests', 'request', 'dashboard'].includes(String(options?.queryKey?.[0])))).toBe(true)
  })

  it('does not invalidate queries after a failed mutation', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    fetchMock.mockRejectedValueOnce(new TypeError('Network unavailable'))
    renderAt('/requests/new'); fill(); submit('Create request')
    await screen.findByRole('alert')
    expect(invalidate).not.toHaveBeenCalled()
  })
})
