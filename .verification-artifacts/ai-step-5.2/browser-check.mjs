// Reuses the project's existing dependency-free Chrome DevTools test approach.
// Every /api request is intercepted. No backend, database, or provider is used.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const output = new URL('./', import.meta.url)
const profile = fileURLToPath(new URL(`../../../.verification-artifacts/ai-step-5.2/browser-profile-${Date.now()}/`, output))
const origin = 'http://127.0.0.1:5182'
const noContext = "I couldn't find this information in the uploaded documents."
const answer = {
  answer: 'The uploaded fictional policies state:\n\n"Include an itemized receipt." [1]\n\n"Keep a copy of the claim form." [2]',
  sources: [{ document_id: 42, document_title: 'Fictional Receipt Policy', page_number: 7, chunk_id: 9 },
    { document_id: 12, document_title: 'Fictional Claims Policy', page_number: 4, chunk_id: 5 }], grounded: true,
}
const report = { liveGeminiCalls: 0, backendCalls: 0, requests: [], layouts: [], workflow: [], exceptions: [], blockedExternal: [] }
let chrome, ws, mode = 'success', held
const pending = new Map()
let sequence = 0
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
    if (await evaluate(expression)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${description}`)
}
async function fulfill(requestId, body, responseCode = 200) {
  await send('Fetch.fulfillRequest', { requestId, responseCode,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') })
}
async function intercept({ requestId, request }) {
  const url = new URL(request.url)
  if (url.origin !== origin) {
    report.blockedExternal.push(request.url)
    return send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
  }
  if (!url.pathname.startsWith('/api/')) return send('Fetch.continueRequest', { requestId })
  report.requests.push({ path: url.pathname, method: request.method, ...(request.postData ? { body: JSON.parse(request.postData) } : {}) })
  if (url.pathname === '/api/ai/ask') {
    assert.equal(request.method, 'POST')
    assert.deepEqual(Object.keys(JSON.parse(request.postData)), ['question'])
    if (mode === 'hold') { held = requestId; return }
    if (mode === 'network') return send('Fetch.failRequest', { requestId, errorReason: 'ConnectionFailed' })
    if (mode === 'quota') return fulfill(requestId, { error: 'SECRET diagnostic', code: 'ai_rate_limited' }, 429)
    if (mode === 'timeout') return fulfill(requestId, { error: 'SECRET diagnostic', code: 'ai_timeout' }, 504)
    if (mode === 'no-context') return fulfill(requestId, { answer: noContext, sources: [], grounded: false })
    if (mode === 'long') return fulfill(requestId, { ...answer, answer: 'Synthetic long text '.repeat(100) + 'x'.repeat(1200), sources: [{ ...answer.sources[0], document_title: 'Fictional_' + 'x'.repeat(180) }] })
    return fulfill(requestId, answer)
  }
  if (/^\/api\/documents\/\d+$/.test(url.pathname)) return fulfill(requestId, { data: {
    id: Number(url.pathname.split('/').at(-1)), title: 'Fictional Receipt Policy', original_filename: 'fictional.pdf', file_size: 2048,
    content_type: 'application/pdf', processing_status: 'INDEXED', created_at: '2026-10-24T04:30:00Z',
  } })
  if (url.pathname === '/api/dashboard/summary') return fulfill(requestId, { total_requests: 0, open_requests: 0, in_progress_requests: 0, resolved_requests: 0 })
  throw new Error(`Unexpected API request blocked: ${request.method} ${url.pathname}`)
}
async function navigate(path = '/ai-assistant') {
  await send('Page.navigate', { url: origin + path })
  await until("document.querySelector('h1')?.textContent === 'AI Assistant'", 'AI Assistant ready')
}
async function enter(text) {
  await evaluate("document.querySelector('#ai-question').focus()")
  await send('Input.insertText', { text })
}
async function keyEnter(modifiers = 0) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers })
}
async function ask(text) { await enter(text); await keyEnter() }
async function screenshot(name) {
  // Full-page capture otherwise paints offscreen fixed elements at scrollY.
  await evaluate('window.scrollTo(0, 0); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(new URL(name, output), Buffer.from(data, 'base64'))
}
async function metrics() {
  return evaluate(`(() => {
    const button = document.querySelector('.ai-composer button'), area = document.querySelector('#ai-question')
    const a = button.getBoundingClientRect(), b = area.getBoundingClientRect()
    return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
      buttonWithinWidth: a.left >= 0 && a.right <= innerWidth, composerWithinWidth: b.left >= 0 && b.right <= innerWidth,
      answerWrap: [...document.querySelectorAll('.ai-message')].every(e => e.scrollWidth <= e.clientWidth),
      sidebarVisible: getComputedStyle(document.querySelector('.dashboard-sidebar')).display !== 'none' }
  })()`)
}
try {
  await mkdir(profile, { recursive: true })
  chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-extensions', '--disable-sync', 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' })
  let port
  for (let i = 0; i < 150; i++) {
    try { [port] = (await readFile(`${profile}/DevToolsActivePort`, 'utf8')).trim().split(/\r?\n/); break } catch { await new Promise(r => setTimeout(r, 100)) }
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
        report.exceptions.push(error.message)
        await send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {})
      })
    } else if (message.method === 'Runtime.exceptionThrown') report.exceptions.push(message.params.exceptionDetails.text)
  })
  await send('Page.enable'); await send('Runtime.enable')
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  for (const [name, width, height] of [['mobile', 375, 900], ['tablet', 768, 1050], ['desktop', 1440, 1050]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await navigate()
    assert.equal(await evaluate("document.querySelector('.ai-composer button').disabled"), true)
    await screenshot(`${name}-empty.png`)
    if (width === 375) {
      await evaluate("document.querySelector('.menu-toggle').click()")
      assert.equal(await evaluate("document.querySelector('.menu-toggle').getAttribute('aria-expanded')"), 'true')
      await screenshot('mobile-navigation.png')
      await evaluate("document.querySelector('a[href=\"/ai-assistant\"]').click()")
      assert.equal(await evaluate("document.querySelector('.menu-toggle').getAttribute('aria-expanded')"), 'false')
    }
    mode = 'hold'; held = undefined
    await ask('  What does the fictional claims policy require?  ')
    await until("document.querySelector('.ai-pending') !== null", 'loading indicator')
    assert.equal(await evaluate("document.querySelector('.ai-composer button').disabled"), true)
    await keyEnter()
    await until(`document.querySelector('[role=status]').textContent.includes('Preparing')`, 'loading announcement')
    if (width === 375) await screenshot('mobile-loading.png')
    assert.ok(held)
    await fulfill(held, answer); held = undefined; mode = 'success'
    await until("document.querySelector('.ai-sources') !== null && document.querySelector('#ai-question').value === ''", 'answer and sources')
    assert.equal(await evaluate("document.querySelector('.ai-message-text:last-of-type') !== null"), true)
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.ai-sources a')].map(e=>e.textContent)"), answer.sources.map(s => s.document_title))
    assert.equal(await evaluate("document.activeElement.id"), 'ai-question')
    assert.equal(await evaluate("document.querySelector('.ai-assistant .ai-message-text').textContent"), answer.answer)
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.ai-assistant .ai-message-text')).whiteSpace"), 'pre-wrap')
    await screenshot(`${name}-answer.png`)
    mode = 'long'; await ask('Fictional long passage?')
    await until("document.querySelectorAll('.ai-assistant .ai-message-text').length === 2", 'long answer')
    const result = await metrics()
    assert.equal(result.overflow, false, `${name} horizontal overflow`)
    assert.equal(result.buttonWithinWidth, true); assert.equal(result.composerWithinWidth, true); assert.equal(result.answerWrap, true)
    assert.equal(result.sidebarVisible, width > 720)
    await screenshot(`${name}-long.png`)
    report.layouts.push({ name, ...result })
    const asks = report.requests.filter(r => r.path === '/api/ai/ask').slice(-2)
    assert.deepEqual(asks.map(r => r.body), [{ question: 'What does the fictional claims policy require?' }, { question: 'Fictional long passage?' }])
  }
  report.workflow.push('responsive layouts, Enter submission, duplicate prevention, loading, exact payload, focus, source order, long wrapping')
  await evaluate("document.querySelector('.ai-sources a').click()")
  await until("location.pathname === '/knowledge-base/42' && document.querySelector('h1')?.textContent === 'Fictional Receipt Policy'", 'existing document details route')
  await evaluate("document.querySelector('a[href=\"/ai-assistant\"]').click()")
  await until("document.querySelector('.ai-welcome') !== null", 'local conversation resets on leaving page')
  for (const [state, expected] of [['no-context', noContext], ['quota', 'quota or rate limit'], ['timeout', 'timed out'], ['network', 'Check your connection']]) {
    mode = state
    await ask(`Fictional ${state} question?`)
    await until(`document.querySelector('.ai-transcript').textContent.includes(${JSON.stringify(expected)})`, state)
    assert.equal(await evaluate("document.body.textContent.includes('SECRET')"), false)
    if (state === 'no-context') assert.equal(await evaluate("document.querySelector('.ai-sources') === null"), true)
    else assert.equal(await evaluate("document.querySelector('#ai-question').value"), `Fictional ${state} question?`)
    await screenshot(`${state}.png`)
    await evaluate("document.querySelector('.panel-heading button').click()")
    await until("document.querySelector('.ai-welcome') !== null", 'clear chat')
  }
  mode = 'success'
  await enter('Fictional line one'); await keyEnter(8)
  assert.equal(await evaluate("document.querySelector('#ai-question').value"), 'Fictional line one\n')
  await enter('Fictional line two'); await keyEnter()
  await until("document.querySelector('.ai-sources') !== null", 'multiline success')
  assert.deepEqual(report.requests.at(-1).body, { question: 'Fictional line one\nFictional line two' })
  report.workflow.push('existing document details navigation, no-context, quota, timeout, network failure, Clear chat, Shift+Enter newline')
  assert.equal(report.requests.filter(r => r.path === '/api/ai/ask').length, 11)
  assert.deepEqual(report.exceptions, [])
  report.verdict = 'PASS'
  await writeFile(new URL('browser-report.json', output), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ verdict: report.verdict, layouts: report.layouts, mockedAiRequests: 11, backendCalls: 0, liveGeminiCalls: 0 }))
} catch (error) {
  report.verdict = 'FAIL'; report.failure = error.stack
  await writeFile(new URL('browser-report.json', output), JSON.stringify(report, null, 2))
  throw error
} finally {
  if (ws?.readyState === WebSocket.OPEN) { await send('Browser.close').catch(() => {}); ws.close() }
  if (chrome && chrome.exitCode === null) chrome.kill()
}
