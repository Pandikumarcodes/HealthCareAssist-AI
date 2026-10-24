import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { resetApiSession } from '../../services/api'
import { sessionKey } from '../../services/auth'
import { safeDestination } from './validation'

const user = { id: 'demo', display_name: 'Demo User' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
let authenticated: boolean
let unavailable: boolean
let denied: number
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
let expiresAt: number
const clients: QueryClient[] = []
const session = () => ({ user, csrf_token: 'synthetic-authenticated-csrf', expires_at: expiresAt })
function start(path = '/login') {
  window.history.replaceState({}, '', path)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  return { ...render(<App client={client} />), client }
}
async function form() { return screen.findByRole('form', { name: 'Demo sign in' }) }
function fill() {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'fictional-reviewer' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic-input-only' } })
}
async function signIn() { await form(); fill(); fireEvent.submit(await form()) }
const loginCalls = () => fetchMock.mock.calls.filter(([path]) => path === '/api/auth/login')

beforeEach(() => {
  authenticated = false; unavailable = false; denied = 0; expiresAt = Date.now() / 1000 + 28800
  resetApiSession()
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
    const path = String(url).split('?')[0]
    if (path === '/api/auth/me') return unavailable ? response({ error: 'PRIVATE diagnostic' }, 503) : authenticated ? response(session()) : response({ code: 'auth_required', csrf_token: 'synthetic-guest-csrf' }, 401)
    if (path === '/api/auth/login') {
      if (unavailable) throw new TypeError('PRIVATE network details')
      if (denied) return response({ error: 'PRIVATE credential reason' }, denied)
      authenticated = true; return response(session())
    }
    if (path === '/api/auth/logout') { authenticated = false; return response({ message: 'Signed out.' }) }
    if (!authenticated) return response({ code: 'auth_required' }, 401)
    if (path === '/api/dashboard/summary') return response({ total_requests: 2, open_requests: 1, in_progress_requests: 1, resolved_requests: 0 })
    if (path === '/api/documents') return response({ data: [], page: 1, page_size: 20, total: 0, total_pages: 0 })
    if (path === '/api/requests') return response({ data: [], page: 1, page_size: 20, total: 0, total_pages: 0 })
    if (path === '/api/ai/ask' && options?.method === 'POST') return response({ answer: 'Fictional local conversation', sources: [], grounded: false })
    throw new Error(`Unexpected mocked request: ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { for (const client of clients.splice(0)) client.clear(); resetApiSession(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('server-backed demo authentication', () => {
  it('renders accessible fields and password masking without persisting credentials', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    start(); await form()
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(screen.queryByRole('link', { name: /forgot|register/i })).not.toBeInTheDocument()
    await signIn(); await screen.findByRole('heading', { name: 'Dashboard', level: 1 })
    expect(storage).not.toHaveBeenCalled()
  })
  it('validates required fields and focuses the first invalid control', async () => {
    start(); fireEvent.submit(await form())
    expect(screen.getByText('Username is required.')).toBeInTheDocument()
    expect(screen.getByText('Password is required.')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toHaveFocus()
    expect(loginCalls()).toHaveLength(0)
  })
  it.each([['Username', 'x'.repeat(101)], ['Password', 'x'.repeat(1025)]])('validates bounds for %s', async (label, value) => {
    start(); await form(); fill(); fireEvent.change(screen.getByLabelText(label), { target: { value } }); fireEvent.submit(await form())
    expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true')
    expect(loginCalls()).toHaveLength(0)
  })
  it.each(['/dashboard', '/requests/new', '/knowledge-base', '/ai-assistant'])('redirects guests from %s and returns after login', async (path) => {
    start(path); await form()
    expect(window.location.pathname).toBe('/login')
    expect(screen.queryByRole('navigation', { name: 'Workspace' })).not.toBeInTheDocument()
    await signIn()
    await waitFor(() => expect(window.location.pathname).toBe(path))
    expect(loginCalls()[0][1]).toMatchObject({ credentials: 'same-origin', headers: { 'X-CSRF-Token': 'synthetic-guest-csrf' } })
  })
  it('hides protected content while the initial session is unknown', () => {
    fetchMock.mockReturnValue(new Promise(() => {})); start('/ai-assistant')
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session')
    expect(screen.queryByRole('heading', { name: 'AI Assistant' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })
  it('restores the session with a new empty query cache after refresh', async () => {
    authenticated = true
    const view = start('/knowledge-base'); await screen.findByRole('heading', { name: 'Knowledge Base', level: 1 })
    view.unmount()
    start('/knowledge-base'); await screen.findByRole('heading', { name: 'Knowledge Base', level: 1 })
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/auth/me')).toHaveLength(2)
    expect(loginCalls()).toHaveLength(0)
  })
  it('redirects authenticated visitors away from login', async () => {
    authenticated = true; start(); await screen.findByRole('heading', { name: 'Dashboard', level: 1 })
    expect(window.location.pathname).toBe('/dashboard')
  })
  it('keeps invalid credentials generic and clears the password', async () => {
    denied = 401; start(); await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(document.body).not.toHaveTextContent('PRIVATE')
    expect(loginCalls()).toHaveLength(1)
  })
  it('shows a safe login network failure without retrying', async () => {
    start(); await form(); unavailable = true; fill(); fireEvent.submit(await form())
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in is unavailable')
    expect(document.body).not.toHaveTextContent('PRIVATE')
    expect(loginCalls()).toHaveLength(1)
  })
  it('recovers when session verification is unavailable', async () => {
    unavailable = true; start('/dashboard')
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to verify your session')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    unavailable = false; fireEvent.click(screen.getByRole('button', { name: 'Try again' })); await form()
  })
  it('disables pending login and prevents same-tick duplicate submissions', async () => {
    start(); await form(); fill()
    let resolve!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    act(() => { fireEvent.submit(screen.getByRole('form')); fireEvent.submit(screen.getByRole('form')) })
    expect(screen.getByRole('button', { name: 'Signing in...' })).toBeDisabled()
    expect(loginCalls()).toHaveLength(1)
    authenticated = true; resolve(response(session())); await screen.findByRole('heading', { name: 'Dashboard', level: 1 })
  })
  it('logs out, clears private query/mutation caches and removes local AI conversation', async () => {
    authenticated = true; const { client } = start('/ai-assistant')
    await screen.findByRole('heading', { name: 'AI Assistant', level: 1 })
    client.setQueryData(['documents', 'private'], { title: 'Prior private document' })
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Fictional policy?' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Ask the AI Assistant' }))
    await screen.findByText('Fictional local conversation')
    fireEvent.click(screen.getByRole('button', { name: 'Logout' })); await form()
    expect(client.getQueryCache().getAll().filter((query) => query.queryKey[0] !== 'auth')).toHaveLength(0)
    expect(client.getMutationCache().getAll()).toHaveLength(0)
    expect(client.getQueryData(sessionKey)).toBeNull()
    expect(screen.queryByText('Fictional local conversation')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.find(([path]) => path === '/api/auth/logout')?.[1]).toMatchObject({ method: 'POST', headers: { 'X-CSRF-Token': 'synthetic-authenticated-csrf' } })
    await signIn(); await screen.findByRole('heading', { name: 'AI Assistant', level: 1 })
    expect(screen.queryByText('Fictional local conversation')).not.toBeInTheDocument()
  })
  it('handles mutation 401 as expiration, clears private data and never retries it', async () => {
    authenticated = true; const { client } = start('/ai-assistant')
    await screen.findByRole('heading', { name: 'AI Assistant', level: 1 }); client.setQueryData(['private'], 'Synthetic private data')
    authenticated = false
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Fictional policy?' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Ask the AI Assistant' })); await form()
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/ai/ask')).toHaveLength(1)
    expect(client.getQueryData(['private'])).toBeUndefined()
    expect(window.location.pathname).toBe('/login')
    expect(screen.queryByRole('region', { name: 'Conversation' })).not.toBeInTheDocument()
  })
  it('expires locally at the server-provided deadline', async () => {
    authenticated = true; expiresAt = Date.now() / 1000 + 0.3
    start('/ai-assistant'); await screen.findByRole('heading', { name: 'AI Assistant', level: 1 })
    authenticated = false
    await form()
    expect(window.location.pathname).toBe('/login')
  })
  it('clears private caches when session revalidation returns 401', async () => {
    authenticated = true; const { client } = start('/ai-assistant')
    await screen.findByRole('heading', { name: 'AI Assistant', level: 1 })
    client.setQueryData(['private'], 'Synthetic private data'); authenticated = false
    await act(async () => { await client.invalidateQueries({ queryKey: sessionKey }) })
    await form()
    expect(client.getQueryData(['private'])).toBeUndefined()
    await signIn(); await screen.findByRole('heading', { name: 'AI Assistant', level: 1 })
  })
  it('does not log out on a mutation 403 or retry the mutation', async () => {
    authenticated = true; start('/ai-assistant'); await screen.findByRole('heading', { name: 'AI Assistant', level: 1 })
    fetchMock.mockResolvedValueOnce(response({ code: 'auth_csrf_failed' }, 403))
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Fictional policy?' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Ask the AI Assistant' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send question' })).toBeEnabled())
    expect(window.location.pathname).toBe('/ai-assistant')
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/ai/ask')).toHaveLength(1)
  })
  it('keeps logout failure visible and does not falsely claim server logout', async () => {
    authenticated = true; start('/ai-assistant'); await screen.findByRole('heading', { name: 'AI Assistant', level: 1 })
    fetchMock.mockRejectedValueOnce(new TypeError('PRIVATE'))
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to sign out')
    expect(window.location.pathname).toBe('/ai-assistant')
  })
  it('preserves the existing public welcome and 404 routes', () => {
    start('/unknown-local-path'); expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('safe local destinations', () => {
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/login', '/unknown', '/%2f%2fevil.example', '/requests/../login', '/requests\n/1', null])('rejects %j', (value) => expect(safeDestination(value)).toBe('/dashboard'))
  it.each(['/dashboard', '/requests/42/edit', '/knowledge-base/42', '/ai-assistant', '/requests?status=OPEN#results'])('allows %s', (value) => expect(safeDestination(value)).toBe(value))
})
