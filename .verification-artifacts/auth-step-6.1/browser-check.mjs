// Existing dependency-free CDP infrastructure; every API response is synthetic.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const output = new URL('./', import.meta.url)
const profile = fileURLToPath(new URL(`../../../.verification-artifacts/auth-step-6.1/browser-profile-${Date.now()}/`, output))
const origin = 'http://127.0.0.1:5186'
const report = { liveGeminiCalls: 0, backendCalls: 0, requests: [], layouts: [], workflows: [], exceptions: [], cancelledInterceptions: [], blockedExternal: [] }
const pending = new Map()
let sequence = 0, chrome, ws, authenticated = false, attempt = 0
const session = () => ({ user: { id: 'demo', display_name: 'Demo User' }, csrf_token: 'synthetic-private-csrf', expires_at: Date.now() / 1000 + 28800 })
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value) }, reject: (error) => { clearTimeout(timer); reject(error) } })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
async function until(expression, description) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${description}`)
}
async function fulfill(requestId, body, responseCode = 200) {
  await send('Fetch.fulfillRequest', { requestId, responseCode, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }], body: Buffer.from(JSON.stringify(body)).toString('base64') })
}
async function intercept({ requestId, request }) {
  const url = new URL(request.url)
  if (url.origin !== origin) { report.blockedExternal.push(request.url); return send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }) }
  if (!url.pathname.startsWith('/api/')) return send('Fetch.continueRequest', { requestId })
  // Deliberately do not record login passwords, request bodies or cookie values.
  report.requests.push({ path: url.pathname, method: request.method })
  const csrf = Object.entries(request.headers).find(([key]) => key.toLowerCase() === 'x-csrf-token')?.[1]
  if (request.method !== 'GET') assert.equal(csrf, authenticated ? 'synthetic-private-csrf' : 'synthetic-guest-csrf')
  if (url.pathname === '/api/auth/me') return authenticated ? fulfill(requestId, session()) : fulfill(requestId, { code: 'auth_required', csrf_token: 'synthetic-guest-csrf' }, 401)
  if (url.pathname === '/api/auth/login') {
    attempt++
    if (attempt === 1) return fulfill(requestId, { error: 'PRIVATE reason', code: 'auth_invalid_credentials' }, 401)
    authenticated = true; return fulfill(requestId, session())
  }
  if (url.pathname === '/api/auth/logout') { authenticated = false; return fulfill(requestId, { message: 'Signed out.' }) }
  if (!authenticated) return fulfill(requestId, { code: 'auth_required' }, 401)
  if (url.pathname === '/api/dashboard/summary') return fulfill(requestId, { total_requests: attempt, open_requests: attempt, in_progress_requests: 0, resolved_requests: 0 })
  if (url.pathname === '/api/requests' || url.pathname === '/api/documents') return fulfill(requestId, { data: [], page: 1, page_size: 20, total: 0, total_pages: 0 })
  if (url.pathname === '/api/ai/ask') return fulfill(requestId, { answer: 'Fictional browser conversation', sources: [], grounded: false })
  throw new Error(`Unexpected API request blocked: ${request.method} ${url.pathname}`)
}
async function screenshot(name) {
  await evaluate('window.scrollTo(0, 0); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(new URL(name, output), Buffer.from(data, 'base64'))
}
async function enter(selector, text) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`)
  await send('Input.insertText', { text })
}
async function keyEnter() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
}
async function login() {
  await enter('#username', 'fictional-reviewer')
  await enter('#password', 'synthetic-browser-input')
  await keyEnter()
}
async function navigation(path, heading) {
  await evaluate(`document.querySelector('a[href="${path}"]').click()`)
  await until(`document.querySelector('h1')?.textContent === ${JSON.stringify(heading)}`, heading)
}
try {
  await mkdir(profile, { recursive: true })
  chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-extensions', '--disable-sync', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let port
  for (let i = 0; i < 150; i++) {
    try { [port] = (await readFile(`${profile}/DevToolsActivePort`, 'utf8')).trim().split(/\r?\n/); break } catch { await new Promise((resolve) => setTimeout(resolve, 100)) }
  }
  assert.ok(port, 'Headless Chrome ready')
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.id) {
      const operation = pending.get(message.id)
      if (operation) { pending.delete(message.id); message.error ? operation.reject(new Error(message.error.message)) : operation.resolve(message.result) }
    } else if (message.method === 'Fetch.requestPaused') {
      void intercept(message.params).catch(async (error) => {
        const path = new URL(message.params.request.url).pathname
        // StrictMode and logout cancel obsolete query fetches. CDP cannot
        // fulfill a request after the browser has discarded its interception ID.
        if (error.message === 'Invalid InterceptionId.' && message.params.request.method === 'GET' && ['/api/auth/me', '/api/documents', '/api/requests', '/api/dashboard/summary'].includes(path)) {
          report.cancelledInterceptions.push({ path, method: 'GET' }); return
        }
        report.exceptions.push({ path, error: error.message }); await send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {})
      })
    } else if (message.method === 'Runtime.exceptionThrown') report.exceptions.push(message.params.exceptionDetails.text)
  })
  await send('Page.enable'); await send('Runtime.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  for (const [name, width, height] of [['mobile', 375, 900], ['tablet', 768, 1050], ['desktop', 1440, 1050]]) {
    authenticated = false; attempt = 0
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: origin + '/dashboard' })
    await until("location.pathname === '/login' && document.querySelector('#username')", 'guest redirects to login')
    assert.equal(await evaluate("document.querySelector('.dashboard-shell') === null"), true)
    assert.equal(await evaluate("document.querySelector('#password').type"), 'password')
    await screenshot(`${name}-login.png`)
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false)
    await login()
    await until("document.querySelector('[role=alert]')?.textContent === 'Invalid username or password.'", 'safe invalid credentials')
    assert.equal(await evaluate("document.body.textContent.includes('PRIVATE')"), false)
    assert.equal(await evaluate("document.querySelector('#password').value"), '')
    await enter('#password', 'synthetic-browser-input'); await keyEnter()
    await until("document.querySelector('h1')?.textContent === 'Dashboard'", 'valid login to Dashboard')
    await until("document.body.textContent.includes('Summary loaded')", 'dashboard fetched')
    if (width <= 720) await evaluate("document.querySelector('.menu-toggle').click()")
    await navigation('/requests', 'Support Requests')
    if (width <= 720) await evaluate("document.querySelector('.menu-toggle').click()")
    await navigation('/knowledge-base', 'Knowledge Base')
    if (width <= 720) await evaluate("document.querySelector('.menu-toggle').click()")
    await navigation('/ai-assistant', 'AI Assistant')
    await enter('#ai-question', 'Fictional browser question?'); await keyEnter()
    await until("document.body.textContent.includes('Fictional browser conversation')", 'local AI answer')
    const previousTimeOrigin = await evaluate('performance.timeOrigin')
    await send('Page.reload', { ignoreCache: true })
    await until(`performance.timeOrigin !== ${previousTimeOrigin} && document.querySelector('h1')?.textContent === 'AI Assistant' && document.querySelector('.dashboard-shell')`, 'restored session after refresh')
    assert.equal(await evaluate("document.body.textContent.includes('Fictional browser conversation')"), false)
    assert.equal(await evaluate('localStorage.length + sessionStorage.length'), 0)
    if (width <= 720) await evaluate("document.querySelector('.menu-toggle').click()")
    await screenshot(`${name}-navigation.png`)
    const layout = await evaluate(`(() => { const button = document.querySelector('.logout-button').getBoundingClientRect(); return {width:innerWidth, overflow:document.documentElement.scrollWidth>innerWidth, logoutVisible:button.width>0 && button.left>=0 && button.right<=innerWidth} })()`)
    assert.equal(layout.overflow, false); assert.equal(layout.logoutVisible, true)
    report.layouts.push(layout)
    await evaluate("document.querySelector('.logout-button').click()")
    await until("location.pathname === '/login' && document.querySelector('#username')", 'logout to login')
    assert.equal(await evaluate("document.querySelector('.dashboard-shell') === null"), true)
    await send('Page.navigate', { url: origin + '/knowledge-base' })
    await until("location.pathname === '/login' && document.querySelector('#username')", 'protected route rejected after logout')
    await login()
    await until("document.querySelector('h1')?.textContent === 'Knowledge Base'", 'second login destination')
    if (width <= 720) await evaluate("document.querySelector('.menu-toggle').click()")
    await navigation('/dashboard', 'Dashboard')
    await until("document.body.textContent.includes('Summary loaded')", 'fresh private query after logout')
    assert.equal(await evaluate("document.querySelector('.stat-value').textContent"), '3')
    report.workflows.push({ width, invalidLogin: true, validLogin: true, navigation: ['Dashboard', 'Requests', 'Knowledge Base', 'AI Assistant'], keyboardSubmit: true, refreshRestored: true, logout: true, protectedAfterLogout: true, freshDashboardAfterRelogin: true })
  }
  assert.deepEqual(report.exceptions, [])
  report.verdict = 'PASS'
  await writeFile(new URL('browser-report.json', output), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ verdict: report.verdict, layouts: report.layouts, backendCalls: 0, liveGeminiCalls: 0 }))
} catch (error) {
  report.verdict = 'FAIL'; report.failure = error.stack
  await writeFile(new URL('browser-report.json', output), JSON.stringify(report, null, 2)); throw error
} finally {
  if (ws?.readyState === WebSocket.OPEN) { await send('Browser.close').catch(() => {}); ws.close() }
  if (chrome && chrome.exitCode === null) chrome.kill()
}
