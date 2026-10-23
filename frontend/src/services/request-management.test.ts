import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { createRequest, deleteRequest, getRequest, updateRequest } from './requests'

const item = { id: 42, title: 'Synthetic title', description: 'Synthetic details', category: 'GENERAL', status: 'OPEN', created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T11:00:00Z' }
const input = { title: item.title, description: item.description, category: 'GENERAL' as const }
function mock(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
afterEach(() => vi.unstubAllGlobals())

describe('request management API contracts', () => {
  it('loads the single data envelope and forwards cancellation', async () => {
    const fetchMock = mock({ data: item })
    const controller = new AbortController()
    await expect(getRequest('42', controller.signal)).resolves.toEqual(item)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/requests/42')
    controller.abort()
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
  })

  it('encodes path IDs instead of accepting path injection', async () => {
    const fetchMock = mock({ data: item })
    await getRequest('../health')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/requests/..%2Fhealth')
  })

  it('creates with the exact JSON contract and preserves timestamps', async () => {
    const fetchMock = mock({ data: item }, 201)
    await expect(createRequest(input)).resolves.toEqual(item)
    expect(fetchMock).toHaveBeenCalledWith('/api/requests', expect.objectContaining({ method: 'POST', body: JSON.stringify(input), headers: { Accept: 'application/json', 'Content-Type': 'application/json' } }))
  })

  it('sends a partial PATCH without adding unchanged or server-managed fields', async () => {
    const fetchMock = mock({ data: { ...item, status: 'RESOLVED' } })
    await expect(updateRequest('42', { status: 'RESOLVED' })).resolves.toMatchObject({ status: 'RESOLVED' })
    expect(fetchMock).toHaveBeenCalledWith('/api/requests/42', expect.objectContaining({ method: 'PATCH', body: '{"status":"RESOLVED"}' }))
  })

  it('accepts an empty 204 DELETE response without parsing JSON', async () => {
    const fetchMock = mock(null, 204)
    await expect(deleteRequest('42')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/requests/42', expect.objectContaining({ method: 'DELETE' }))
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined()
  })

  it.each([null, {}, { data: [] }, { data: { ...item, status: 'CLOSED' } }, { data: { ...item, updated_at: 'not a date' } }])('rejects malformed single-record data %j', async (body) => {
    mock(body)
    await expect(getRequest('42')).rejects.toThrow('Unexpected support request response')
  })

  it('preserves only typed validation details for HTTP 400', async () => {
    mock({ error: 'Invalid input.', details: { title: 'Must be a nonblank string.', category: null } }, 400)
    await expect(createRequest(input)).rejects.toMatchObject({ status: 400, details: { title: 'Must be a nonblank string.' } })
  })

  it.each([404, 500])('provides typed HTTP %s errors without leaking server content', async (status) => {
    mock({ error: 'Secret database information', details: { body: 'Private details' } }, status)
    try { await deleteRequest('42'); expect.fail('Expected an error') } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({ status, details: {}, message: `API request failed (${status})` })
    }
  })

  it('handles non-JSON error responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Proxy unavailable</html>', { status: 502 })))
    await expect(updateRequest('42', { title: 'New title' })).rejects.toMatchObject({ status: 502 })
  })
})
