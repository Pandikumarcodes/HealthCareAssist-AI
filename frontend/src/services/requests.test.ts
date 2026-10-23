import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRequests } from './requests'

const record = { id: 42, title: 'Coverage question', description: 'Private details', category: 'COVERAGE', status: 'IN_PROGRESS', created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T11:00:00Z' }
const response = { data: [record], page: 1, page_size: 20, total: 1, total_pages: 1 }
const parameters = { page: 1, page_size: 20 }
afterEach(() => vi.unstubAllGlobals())

function mockResponse(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('support requests API', () => {
  it('preserves exact fields and timestamps and forwards cancellation through the shared client', async () => {
    const fetchMock = mockResponse(response)
    const controller = new AbortController()
    await expect(getRequests(parameters, controller.signal)).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith('/api/requests?page=1&page_size=20', expect.objectContaining({ headers: { Accept: 'application/json' } }))
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    controller.abort()
    expect(signal.aborted).toBe(true)
  })

  it('encodes all combined filters using the exact backend parameter names', async () => {
    const fetchMock = mockResponse({ ...response, page: 2, total: 21, total_pages: 2 })
    await getRequests({ page: 2, page_size: 20, status: 'OPEN', category: 'CLAIMS', q: '  100% policy_ & visit  ' })
    const url = new URL(fetchMock.mock.calls[0][0] as string, 'http://localhost')
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: '2', page_size: '20', status: 'OPEN', category: 'CLAIMS', q: '100% policy_ & visit' })
  })

  it('omits blank search and accepts an empty database', async () => {
    const empty = { ...response, data: [], total: 0, total_pages: 0 }
    const fetchMock = mockResponse(empty)
    await expect(getRequests({ ...parameters, q: '   ' })).resolves.toEqual(empty)
    expect(fetchMock.mock.calls[0][0]).not.toContain('q=')
  })

  it('accepts the backend out-of-range page response for page recovery', async () => {
    const body = { ...response, data: [], page: 3, total: 1 }
    mockResponse(body)
    await expect(getRequests({ ...parameters, page: 3 })).resolves.toEqual(body)
  })

  it.each([
    null, {}, { ...response, data: null }, { ...response, total: '1' },
    { ...response, total: -1 }, { ...response, total_pages: 2 },
    { ...response, page: 2 }, { ...response, page_size: 10 },
    { ...response, total: 1.5 }, { ...response, data: [] },
    ...[{ id: 0 }, { title: '' }, { description: null }, { category: 'coverage' }, { status: 'CLOSED' }, { created_at: 'invalid' }, { updated_at: undefined }].map((change) => ({ ...response, data: [{ ...record, ...change }] })),
  ])('rejects a malformed or inconsistent response %j', async (body) => {
    mockResponse(body)
    await expect(getRequests(parameters)).rejects.toThrow('Unexpected support requests response')
  })

  it.each([400, 500, 503])('propagates HTTP %s without treating it as an empty list', async (status) => {
    mockResponse({ error: 'Internal details' }, status)
    await expect(getRequests(parameters)).rejects.toThrow(String(status))
  })

  it('propagates a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(getRequests(parameters)).rejects.toThrow('Failed to fetch')
  })
})
