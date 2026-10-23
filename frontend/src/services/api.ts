const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')

export class ApiError extends Error {
  status: number
  details: Record<string, string>
  constructor(status: number, details: Record<string, string> = {}) {
    super(`API request failed (${status})`)
    this.status = status
    this.details = details
  }
}

export async function apiRequest(path: string, options: { method?: 'POST' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
  const { signal, method, body, timeoutMs = 10000 } = options
  const multipart = body instanceof FormData
  const response = await fetch(`${baseUrl}${path}`, {
    ...(method ? { method } : {}),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'application/json', ...(body === undefined || multipart ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
  })
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null)
    const details: Record<string, string> = {}
    if (response.status === 400 && typeof data === 'object' && data !== null && 'details' in data && typeof data.details === 'object' && data.details !== null) {
      for (const [key, value] of Object.entries(data.details)) if (typeof value === 'string') details[key] = value
    }
    throw new ApiError(response.status, details)
  }
  if (response.status === 204) return undefined
  return response.json() as Promise<unknown>
}

export function apiGet(path: string, signal?: AbortSignal): Promise<unknown> {
  return apiRequest(path, { signal })
}
