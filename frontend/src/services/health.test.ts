import { afterEach, describe, expect, it, vi } from 'vitest'
import { getHealth } from './health'

afterEach(() => vi.unstubAllGlobals())

describe('health API client', () => {
  it('requests the health endpoint and returns metadata', async () => {
    const body = { status: 'healthy', service: 'HealthCareAssist AI', version: '1.0.0' }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getHealth()).resolves.toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({ headers: { Accept: 'application/json' } }))
  })

  it('rejects unsuccessful HTTP responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    await expect(getHealth()).rejects.toThrow('503')
  })

  it.each([null, {}, { status: 'unhealthy', service: 'Flask', version: '1' }, { status: 'healthy', service: '', version: 1 }])('rejects invalid response %j', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))
    await expect(getHealth()).rejects.toThrow('Unexpected health response')
  })

  it('propagates network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network unavailable')))
    await expect(getHealth()).rejects.toThrow('Network unavailable')
  })
})
