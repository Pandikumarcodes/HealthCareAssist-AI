import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { getDashboardSummary } from '../../services/dashboard'
import { getHealth } from '../../services/health'

vi.mock('../../services/dashboard', () => ({ getDashboardSummary: vi.fn() }))
vi.mock('../../services/health', () => ({ getHealth: vi.fn() }))

const populated = { total_requests: 14, open_requests: 6, in_progress_requests: 5, resolved_requests: 3 }
const empty = { total_requests: 0, open_requests: 0, in_progress_requests: 0, resolved_requests: 0 }

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard')
  vi.mocked(getDashboardSummary).mockReset()
  vi.mocked(getHealth).mockReset().mockResolvedValue({ status: 'healthy', service: 'HealthCareAssist AI', version: '1.0.0' })
})

function card(label: string) {
  return screen.getByText(label).closest('dt')!.parentElement!
}

describe('dashboard', () => {
  it('renders the direct route and maps all four API statistics', async () => {
    vi.mocked(getDashboardSummary).mockResolvedValue(populated)
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    await screen.findByText('Summary loaded')
    expect(screen.getAllByRole('term')).toHaveLength(4)
    for (const [label, value] of [['Total Requests', '14'], ['Open Requests', '6'], ['In Progress', '5'], ['Resolved Requests', '3']]) {
      expect(within(card(label)).getByRole('definition')).toHaveTextContent(value)
    }
    expect(screen.queryByText('No support requests yet.')).not.toBeInTheDocument()
    expect(screen.getByText('11 awaiting attention or in progress.')).toBeInTheDocument()
    expect(getDashboardSummary).toHaveBeenCalledTimes(1)
    expect(getDashboardSummary).toHaveBeenCalledWith(expect.any(AbortSignal))
  })

  it('shows genuine zero values and the empty state only after success', async () => {
    vi.mocked(getDashboardSummary).mockResolvedValue(empty)
    render(<App />)
    expect(await screen.findByText('No support requests yet.')).toBeInTheDocument()
    expect(screen.getAllByRole('definition')).toHaveLength(4)
    for (const label of ['Total Requests', 'Open Requests', 'In Progress', 'Resolved Requests']) {
      expect(within(card(label)).getByText('0', { exact: true })).toBeInTheDocument()
    }
    expect(screen.getByText(/Metrics will update when support requests are created/)).toBeInTheDocument()
  })

  it('announces loading and does not present pending values as zero or empty', () => {
    vi.mocked(getDashboardSummary).mockReturnValue(new Promise(() => {}))
    render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading dashboard metrics')
    expect(screen.getByLabelText('Request statistics')).toHaveAttribute('aria-busy', 'true')
    for (const value of screen.getAllByRole('definition')) expect(value).toHaveTextContent('—')
    expect(screen.queryByText('No support requests yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument()
  })

  it('shows a sanitized error without empty data and does not retry automatically', async () => {
    vi.mocked(getDashboardSummary).mockRejectedValue(new Error('Internal database details'))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load dashboard')
    for (const value of screen.getAllByRole('definition')) expect(value).toHaveTextContent('—')
    expect(screen.queryByText('No support requests yet.')).not.toBeInTheDocument()
    expect(screen.queryByText('Internal database details')).not.toBeInTheDocument()
    expect(getDashboardSummary).toHaveBeenCalledTimes(1)
  })

  it('retries explicitly, announces loading, and replaces the error with real metrics', async () => {
    let resolveRetry!: (value: typeof populated) => void
    vi.mocked(getDashboardSummary).mockRejectedValueOnce(new Error('Offline')).mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve }))
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Try again/ }))
    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status')).toHaveTextContent('Loading dashboard metrics')
    resolveRetry(populated)
    await screen.findByText('Summary loaded')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(within(card('Total Requests')).getByRole('definition')).toHaveTextContent('14')
  })

  it('keeps future navigation disabled and identifies the active dashboard', async () => {
    vi.mocked(getDashboardSummary).mockResolvedValue(empty)
    render(<App />)
    const navigation = screen.getByRole('navigation', { name: 'Workspace' })
    expect(within(navigation).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    expect(within(navigation).getByRole('link', { name: 'Support Requests' })).toHaveAttribute('href', '/requests')
    expect(within(navigation).getByRole('link', { name: 'Knowledge Base' })).toHaveAttribute('href', '/knowledge-base')
    for (const label of ['AI Assistant']) {
      expect(within(navigation).getByRole('button', { name: `${label} Coming soon` })).toBeDisabled()
    }
    await screen.findByText('Summary loaded')
  })

  it('toggles mobile navigation and closes it when navigating', async () => {
    vi.mocked(getDashboardSummary).mockResolvedValue(empty)
    render(<App />)
    const toggle = screen.getByRole('button', { name: 'Open navigation' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('workspace-navigation')).toHaveClass('is-open')
    fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false')
    await screen.findByText('Summary loaded')
  })

  it('returns to the preserved welcome page and health indicator', async () => {
    vi.mocked(getDashboardSummary).mockResolvedValue(empty)
    render(<App />)
    await screen.findByText('Summary loaded')
    fireEvent.click(screen.getByRole('link', { name: /Welcome & connection/ }))
    expect(screen.getByRole('heading', { level: 1, name: /Welcome to HealthCareAssist AI/ })).toBeInTheDocument()
    expect(await screen.findByText('Backend connected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: /Open dashboard/ }))
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(getDashboardSummary).toHaveBeenCalledTimes(1)
  })

  it('shows a useful fallback for an unknown route', () => {
    window.history.replaceState({}, '', '/unknown')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Return to welcome' })).toHaveAttribute('href', '/')
    expect(getDashboardSummary).not.toHaveBeenCalled()
  })
})
