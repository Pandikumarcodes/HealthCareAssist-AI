import { apiGet } from './api'

export interface HealthResponse {
  status: 'healthy'
  service: string
  version: string
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const data = await apiGet('/api/health', signal)
  if (
    typeof data !== 'object' || data === null ||
    !('status' in data) || data.status !== 'healthy' ||
    !('service' in data) || typeof data.service !== 'string' || !data.service.trim() ||
    !('version' in data) || typeof data.version !== 'string' || !data.version.trim()
  ) throw new Error('Unexpected health response')
  return { status: data.status, service: data.service, version: data.version }
}
