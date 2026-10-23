import { apiGet } from './api'

export interface DashboardSummary {
  total_requests: number
  open_requests: number
  in_progress_requests: number
  resolved_requests: number
}

export async function getDashboardSummary(signal?: AbortSignal): Promise<DashboardSummary> {
  const data = await apiGet('/api/dashboard/summary', signal)
  const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
  if (
    typeof data !== 'object' || data === null ||
    !('total_requests' in data) || !isCount(data.total_requests) ||
    !('open_requests' in data) || !isCount(data.open_requests) ||
    !('in_progress_requests' in data) || !isCount(data.in_progress_requests) ||
    !('resolved_requests' in data) || !isCount(data.resolved_requests) ||
    data.open_requests + data.in_progress_requests + data.resolved_requests !== data.total_requests
  ) throw new Error('Unexpected dashboard response')

  return {
    total_requests: data.total_requests,
    open_requests: data.open_requests,
    in_progress_requests: data.in_progress_requests,
    resolved_requests: data.resolved_requests,
  }
}
