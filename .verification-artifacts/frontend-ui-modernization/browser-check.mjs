// Reuses the dependency-free Chrome DevTools harness from Step 6.1.
// All API traffic is synthetic; external requests are blocked before transmission.
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { resolve, dirname, basename } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const output = new URL('./', import.meta.url)
const profile = fileURLToPath(new URL(`browser-profile-${Date.now()}/`, output))
const origin = 'http://127.0.0.1:5187'
let emptyData = false, aiMode = 'grounded'
const report = { backendCalls: 0, liveGeminiCalls: 0, layouts: [], workflows: [], contrasts: [], exceptions: [], blockedExternal: [], requests: [] }
const operations = new Map()
let sequence = 0, ws, chrome, authenticated = false, attempt = 0, expireOnAsk = false, failRequests = false
const session = () => ({ user: { id: 'demo', display_name: 'Demo User' }, csrf_token: 'synthetic-private-csrf', expires_at: Date.now() / 1000 + 28800 })
const document = { id: 42, title: 'FictionalPolicy'.repeat(13), original_filename: 'fictional-policy.pdf', content_type: 'application/pdf', file_size: 2048, processing_status: 'INDEXED', created_at: '2026-10-23T10:00:00Z' }
const item = { id: 42, title: 'FictionalSupport'.repeat(12), description: 'Fictional synthetic description. '.repeat(8), status: 'OPEN', category: 'GENERAL', created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T10:00:00Z' }
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { operations.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    operations.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
async function until(expression, label) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return
    await new Promise(resolve => setTimeout(resolve, 80))
  }
  throw new Error(`Timed out: ${label}`)
}
async function fulfill(requestId, body, responseCode = 200) {
  return send('Fetch.fulfillRequest', { requestId, responseCode, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }], body: Buffer.from(JSON.stringify(body)).toString('base64') })
}
async function intercept({ requestId, request }) {
  const url = new URL(request.url)
  if (url.origin !== origin) { report.blockedExternal.push(url.origin); return send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }) }
  if (!url.pathname.startsWith('/api/')) return send('Fetch.continueRequest', { requestId })
  report.requests.push({ path: url.pathname, method: request.method })
  if (request.method !== 'GET') assert.equal(Object.entries(request.headers).find(([key]) => key.toLowerCase() === 'x-csrf-token')?.[1], authenticated ? 'synthetic-private-csrf' : 'synthetic-guest-csrf')
  if (url.pathname === '/api/auth/me') return fulfill(requestId, authenticated ? session() : { code: 'auth_required', csrf_token: 'synthetic-guest-csrf' }, authenticated ? 200 : 401)
  if (url.pathname === '/api/auth/login') {
    if (++attempt === 1) return fulfill(requestId, { code: 'auth_invalid_credentials', error: 'PRIVATE diagnostic' }, 401)
    authenticated = true; return fulfill(requestId, session())
  }
  if (url.pathname === '/api/auth/logout') { authenticated = false; return fulfill(requestId, { message: 'Signed out.' }) }
  if (url.pathname === '/api/ai/ask' && expireOnAsk) { authenticated = false; expireOnAsk = false }
  if (!authenticated) return fulfill(requestId, { code: 'auth_required' }, 401)
  if (emptyData && url.pathname === '/api/dashboard/summary') return fulfill(requestId, { total_requests: 0, open_requests: 0, in_progress_requests: 0, resolved_requests: 0 })
  if (emptyData && ['/api/requests', '/api/documents'].includes(url.pathname)) return fulfill(requestId, { data: [], page: 1, page_size: 20, total: 0, total_pages: 0 })
  if (url.pathname === '/api/ai/ask' && aiMode === 'error') return fulfill(requestId, { code: 'ai_unavailable', error: 'PRIVATE provider diagnostic' }, 503)
  if (url.pathname === '/api/ai/ask' && aiMode === 'no-context') return fulfill(requestId, { answer: 'No supporting information was found in the fictional documents.', sources: [], grounded: false })
  if (url.pathname === '/api/dashboard/summary') {
    await new Promise(resolve => setTimeout(resolve, 180))
    return fulfill(requestId, { total_requests: 2, open_requests: 2, in_progress_requests: 0, resolved_requests: 0 })
  }
  if (url.pathname === '/api/requests') return fulfill(requestId, failRequests ? { error: 'PRIVATE database details' } : { data: [item], page: 1, page_size: 20, total: 1, total_pages: 1 }, failRequests ? 503 : 200)
  if (url.pathname === '/api/requests/42') return fulfill(requestId, { data: item })
  if (url.pathname === '/api/documents') return fulfill(requestId, { data: [document], page: 1, page_size: 20, total: 1, total_pages: 1 })
  if (url.pathname === '/api/documents/42') return fulfill(requestId, { data: document })
  if (url.pathname === '/api/ai/ask') return fulfill(requestId, { answer: 'Fictional grounded answer. <img src=x onerror=alert(1)>', sources: [{ document_id: 42, document_title: document.title, page_number: 2, chunk_id: 1 }], grounded: true })
  throw new Error(`Unexpected API blocked: ${request.method} ${url.pathname}`)
}
async function key(key, code, virtual, modifiers = 0, text) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtual, modifiers, ...(text ? { text } : {}) })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtual, modifiers })
}
const enter = () => key('Enter', 'Enter', 13, 0, '\r')
const tab = (shift = false) => key('Tab', 'Tab', 9, shift ? 8 : 0)
async function type(selector, text) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`); await send('Input.insertText', { text }) }
async function login() {
  await type('#username', 'fictional-reviewer'); await tab()
  assert.equal(await evaluate('document.activeElement.id'), 'password')
  await send('Input.insertText', { text: 'synthetic-input-only' }); await enter()
}
async function navigate(path, ready) {
  const exists = await evaluate(`!!document.querySelector('a[href="${path}"]')`)
  if (exists) await evaluate(`document.querySelector('a[href="${path}"]').click()`)
  else { await send('Page.navigate', { url: origin + path }); await until("document.querySelector('.dashboard-shell')", path) }
  await until(`location.pathname === ${JSON.stringify(path)} && (${ready})`, path)
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
}
async function screenshot(name) {
  await evaluate('window.scrollTo(0,0); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: (await send('Page.getLayoutMetrics')).cssLayoutViewport.clientWidth, height: (await send('Page.getLayoutMetrics')).cssContentSize.height, scale: 1 } })
  await writeFile(new URL(name, output), Buffer.from(data, 'base64'))
}
async function layout(page, width, textScale = 1) {
  const value = await evaluate(`(() => {
    const visible = e => {const r=e.getBoundingClientRect(); return !e.closest('[aria-hidden=true]') && r.width>0 && r.height>0 && getComputedStyle(e).visibility!=='hidden'};
    return {page:${JSON.stringify(page)}, width:innerWidth, textScale:${textScale}, overflow:document.documentElement.scrollWidth>innerWidth+1,
      offenders:[...document.querySelectorAll('main *, .mobile-header *, aside *')].filter(visible).filter(e => {const r=e.getBoundingClientRect(),side=e.closest('aside');return r.right>innerWidth+1 || r.left < -1 || (side && r.right>side.getBoundingClientRect().right+1)}).slice(0,10).map(e=>({tag:e.tagName,class:e.className})),
      smallTargets:[...document.querySelectorAll('button,a,input,select,textarea')].filter(visible).filter(e=>!e.closest('.skip-link') && !e.matches(':disabled')).filter(e=>{const r=e.getBoundingClientRect();return r.width<24 || r.height<24}).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.slice(0,40)}))};
  })()`)
  assert.equal(value.width, width)
  report.layouts.push(value)
}
// Conservative computed text/background measurements; gradients/opacity require visual review.
async function contrast(page) {
  const values = await evaluate(`(() => {
    const rgb = value => value.match(/[\\d.]+/g)?.map(Number);
    const lum = c => c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
    return [...document.querySelectorAll('main *, aside *')].filter(e=> !e.closest('[aria-hidden=true]') && e.getBoundingClientRect().width && [...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()) && !e.closest(':disabled')).flatMap(e=>{
      const s=getComputedStyle(e); if(s.opacity!=='1')return [];
      let b=e,bg; while(b){bg=rgb(getComputedStyle(b).backgroundColor);if(bg?.[3]===1||bg?.length===3)break;b=b.parentElement}
      if(!bg||(bg.length===4&&bg[3]!==1))return []; const fg=rgb(s.color); const ratio=(Math.max(lum(fg),lum(bg))+.05)/(Math.min(lum(fg),lum(bg))+.05);
      const large=parseFloat(s.fontSize)>=24 || (parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700);
      return ratio+0.01<(large?3:4.5)?[{class:e.className,text:e.textContent.slice(0,45),color:s.color,bg:bg.slice(0,3),ratio:Number(ratio.toFixed(2))}]:[];
    });
  })()`)
  report.contrasts.push({ page, failures: values })
  const boundaries = await evaluate(`(() => {
    const rgb=v=>v.match(/[\\d.]+/g).map(Number);
    const lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
    return [...document.querySelectorAll('input,select,textarea,.request-secondary')].filter(e=>e.getBoundingClientRect().width&&!e.matches(':disabled')).map(e=>{
      const s=getComputedStyle(e),a=lum(rgb(s.borderTopColor)),b=lum(rgb(s.backgroundColor));return {tag:e.tagName,id:e.id,ratio:Number(((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2))};
    });
  })()`)
  report.contrasts.at(-1).controlBoundaries = boundaries
  report.contrasts.at(-1).failures.push(...boundaries.filter(x=>x.ratio<3))
}
async function resizeText(enable) {
  await evaluate(enable ? `(() => {window.textSizes=[...document.querySelectorAll('body *')].filter(e=>!e.closest('[aria-hidden=true]')).map(e=>[e,e.style.fontSize,getComputedStyle(e).fontSize]);for(const [e,,size] of window.textSizes)e.style.fontSize=(parseFloat(size)*2)+'px'})()` : `(() => {for(const [e,size] of window.textSizes)e.style.fontSize=size;delete window.textSizes})()`)
}
try {
  await mkdir(profile, { recursive: true })
  chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-extensions', '--disable-sync', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let port
  for (let i = 0; i < 150; i++) { try { [port] = (await readFile(`${profile}/DevToolsActivePort`, 'utf8')).trim().split(/\r?\n/); break } catch { await new Promise(resolve => setTimeout(resolve, 100)) } }
  assert.ok(port, 'Chrome ready')
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.id) { const op = operations.get(message.id); if (op) { operations.delete(message.id); message.error ? op.reject(new Error(message.error.message)) : op.resolve(message.result) } }
    else if (message.method === 'Fetch.requestPaused') void intercept(message.params).catch(error => {
      if (error.message === 'Invalid InterceptionId.' && message.params.request.method === 'GET') return
      report.exceptions.push(error.message); void send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'BlockedByClient' }).catch(()=>{})
    })
    else if (message.method === 'Runtime.exceptionThrown') report.exceptions.push(message.params.exceptionDetails.text)
  })
  await send('Page.enable'); await send('Runtime.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  for (const width of [320, 375, 768, 1024, 1440]) {
    authenticated = false; attempt = 0
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: origin + '/'  })
    await until("location.pathname==='/login' && document.querySelector('#username')", 'guest redirect')
    assert.equal(await evaluate("document.querySelector('.connection-card')===null"), true)
    await evaluate("document.querySelector('.password-toggle').click()")
    assert.equal(await evaluate("document.querySelector('#password').type"), 'text')
    await evaluate("document.querySelector('.password-toggle').click()")
    assert.equal(await evaluate("document.querySelector('#password').type"), 'password')
    await layout('login', width)
    if (width===1440) await contrast('login')
    if (width===320 || width===1440) await screenshot(`${width}-login.png`)
    await resizeText(true); await layout('login', width, 2)
    if (width===320 || width===1440) await screenshot(`${width}-login-text200.png`)
    await resizeText(false)
    await evaluate("document.querySelector('button[type=submit]').focus()"); await enter()
    assert.equal(await evaluate('document.activeElement.id'), 'username')
    assert.equal(await evaluate("document.querySelector('#username').getAttribute('aria-invalid')"), 'true')
    await login(); await until("document.querySelector('[role=alert]')?.textContent.includes('Invalid username')", 'invalid login')
    assert.equal(await evaluate("document.body.textContent.includes('PRIVATE')"), false)
    await type('#password', 'synthetic-input-only'); await enter()
    await until("document.querySelector('.dashboard-shell')", 'authenticated shell')
    await until("document.querySelector('[role=status]')?.textContent.includes('Loading dashboard') || document.body.textContent.includes('Summary loaded')", 'accessible dashboard feedback')
    await until("document.body.textContent.includes('Summary loaded')", 'dashboard complete')
    assert.equal(await evaluate('document.activeElement.id'), 'dashboard-main')
    await send('Page.navigate', { url: origin + '/' })
    await until("location.pathname==='/dashboard' && document.body.textContent.includes('Summary loaded')", 'authenticated root')
    for (const [path, ready, page] of [
      ['/dashboard', "document.body.textContent.includes('Summary loaded')", 'dashboard'],
      ['/requests', "document.querySelector('.request-cards h3')", 'requests'],
      ['/requests/new', "document.querySelector('#title')", 'new-request'],
      ['/requests/42', "document.querySelector('#change-status')", 'request-details'],
      ['/requests/42/edit', "document.querySelector('#title')?.value", 'edit-request'],
      ['/knowledge-base', "document.querySelector('.kb-cards h3')", 'knowledge-base'],
      ['/knowledge-base/42', "document.querySelector('h1')?.textContent.startsWith('FictionalPolicy')", 'document-details'],
      ['/ai-assistant', "document.querySelector('#ai-question')", 'ai-assistant'],
    ]) {
      await navigate(path, ready)
      if (page === 'ai-assistant') {
        await layout('ai-empty', width)
        if (width===320 || width===1440) await screenshot(width+'-ai-empty.png')
        await type('#ai-question', 'Fictional policy?'); await enter()
        await until("document.querySelector('.ai-sources a')", 'grounded citation')
        assert.equal(await evaluate("document.querySelector('.ai-message-text img')===null"), true)
        assert.equal(await evaluate('document.activeElement.id'), 'ai-question')
        assert.equal(await evaluate("document.querySelector('.ai-sources a').getAttribute('href')"), '/knowledge-base/42')
      }
      if (page === 'ai-assistant' && width <= 375) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 500, deviceScaleFactor: 1, mobile: true })
        await evaluate("document.querySelector('#ai-question').focus();document.querySelector('#ai-question').scrollIntoView({block:'center'})")
        await layout('ai-composer-short-viewport', width)
        await screenshot(width+'-ai-composer-short-viewport.png')
        await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
      }
      await layout(page, width)
      if (width === 1440) await contrast(page)
      await resizeText(true); await layout(page, width, 2)
      if (width === 320 || width === 1440) await screenshot(`${width}-${page}-text200.png`)
      await resizeText(false)
      if (width === 320 || width === 1440) await screenshot(`${width}-${page}.png`)
      if (page === 'request-details' || page === 'document-details') {
        await evaluate("document.querySelector('.request-detail-heading .request-danger').focus()")
        await enter(); await until("document.querySelector('dialog[open]')", 'dialog entry')
        assert.equal(await evaluate("document.activeElement.textContent.trim()"), 'Cancel')
        await tab(true)
        assert.equal(await evaluate("document.activeElement.classList.contains('request-danger')"), true)
        await tab()
        assert.equal(await evaluate("document.activeElement.textContent.trim()"), 'Cancel')
        await layout(page + '-dialog', width)
        await resizeText(true); await layout(page + '-dialog', width, 2); await resizeText(false)
        await key('Escape', 'Escape', 27)
        await until("!document.querySelector('dialog[open]')", 'dialog Escape')
        assert.equal(await evaluate("document.activeElement.classList.contains('request-danger')"), true)
      }
    }
    if (width <= 375) {
      await evaluate("document.querySelector('.menu-toggle').focus()"); await key(' ', 'Space', 32, 0, ' ')
      await until("document.querySelector('.menu-toggle').getAttribute('aria-expanded')==='true'", 'menu Space')
      await tab(); await key('Escape', 'Escape', 27)
      assert.equal(await evaluate("document.activeElement.classList.contains('menu-toggle')"), true)
      await enter(); await tab(); await enter()
      await until("location.pathname==='/dashboard' && document.querySelector('h1')?.textContent==='Dashboard' && document.activeElement.id==='dashboard-main'", 'keyboard menu navigation and focus')
      assert.equal(await evaluate('document.activeElement.id'), 'dashboard-main')
      await navigate('/ai-assistant', "document.querySelector('#ai-question')")
    }
    expireOnAsk = true; await type('#ai-question', 'Fictional expiry check?'); await enter()
    await until("location.pathname==='/login' && document.querySelector('#username')", 'expiry redirect')
    assert.equal(await evaluate("document.querySelector('.dashboard-shell')===null"), true)
    await login(); await until("document.querySelector('#ai-question')", 'relogin')
    assert.equal(await evaluate("document.querySelector('.ai-turn')===null"), true)
    if (width <= 375) await evaluate("document.querySelector('.menu-toggle').click()")
    await evaluate("document.querySelector('.logout-button').focus()"); await enter()
    await until("location.pathname==='/login' && document.querySelector('#username')", 'logout')
    await send('Page.navigate', { url: origin + '/knowledge-base' })
    await until("location.pathname==='/login' && document.querySelector('#username')", 'private route after logout')
    assert.equal(await evaluate('localStorage.length+sessionStorage.length'), 0)
    report.workflows.push({ width, guestRedirect: true, validation: true, keyboardLogin: true, navigation: true, dialogKeyboard: true, expiry: true, logout: true, protectedAfterLogout: true })
  }
  // Inspect actual rendered fallback states with isolated HTTP fixtures.
  for (const width of [320, 375, 768, 1024, 1440]) {
    authenticated = true; emptyData = true
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
    async function inspectState(page) {
      await layout(page, width)
      if (width===1440) await contrast(page)
      await resizeText(true); await layout(page, width, 2); await resizeText(false)
      if (width===320 || width===1440) await screenshot(width+'-'+page+'.png')
    }
    for (const [path, text, page] of [
      ['/dashboard', 'No support requests yet.', 'dashboard-empty'],
      ['/requests', 'No support requests yet.', 'requests-empty'],
      ['/knowledge-base', 'No documents yet.', 'knowledge-base-empty'],
    ]) {
      await send('Page.navigate', { url: origin+path })
      await until('document.body.textContent.includes('+JSON.stringify(text)+')', page)
      await inspectState(page)
    }
    emptyData = false; failRequests = true
    await send('Page.navigate', { url: origin+'/requests' })
    await until("document.querySelector('[role=alert]')?.textContent.includes('Unable to load support requests')", 'request error')
    await inspectState('requests-error')
    failRequests = false; aiMode = 'error'
    await send('Page.navigate', { url: origin+'/ai-assistant' })
    await until("document.querySelector('#ai-question')", 'assistant composer')
    await type('#ai-question', 'Fictional provider error?'); await enter()
    await until("document.querySelector('.ai-error')", 'safe provider error')
    assert.equal(await evaluate("document.body.textContent.includes('PRIVATE')"), false)
    await inspectState('ai-error')
    aiMode = 'no-context'
    await type('#ai-question', ' Fictional policy?'); await enter()
    await until("document.querySelector('.ai-no-context')", 'no context response')
    await inspectState('ai-no-context')
    aiMode = 'grounded'
  }
  authenticated = true; failRequests = true
  await send('Page.navigate', { url: origin + '/requests' })
  await until("document.querySelector('[role=alert]')?.textContent.includes('Unable to load support requests')", 'accessible error')
  assert.equal(await evaluate("document.body.textContent.includes('PRIVATE')"), false)
  failRequests = false
  await evaluate("document.querySelector('[role=alert] button').focus()"); await enter()
  await until("document.querySelector('.request-cards h3')", 'explicit error retry')
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  assert.equal(await evaluate("(() => {const e=document.createElement('span');e.className='loading-spinner';document.body.append(e);const a=getComputedStyle(e).animationName;e.remove();return a})()"), 'none')
  assert.deepEqual(report.exceptions, [])
  report.verdict = report.layouts.some(x=>x.overflow || x.offenders.length) || report.contrasts.some(x=>x.failures.length) ? 'REVIEW' : 'PASS'
  await writeFile(new URL('mocked-browser-report.json', output), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ verdict: report.verdict, layouts: report.layouts.length, overflows: report.layouts.filter(x=>x.overflow||x.offenders.length), contrasts: report.contrasts.filter(x=>x.failures.length), smallTargets: report.layouts.filter(x=>x.smallTargets.length).map(x=>({page:x.page,width:x.width,textScale:x.textScale,targets:x.smallTargets})), workflows: report.workflows.length }))
} catch (error) {
  report.verdict = 'FAIL'; report.failure = error.stack
  await writeFile(new URL('mocked-browser-report.json', output), JSON.stringify(report, null, 2)); throw error
} finally {
  if (ws?.readyState === WebSocket.OPEN) { await send('Browser.close').catch(()=>{}); ws.close() }
  if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise(resolve => chrome.once('exit', resolve)) }
  // Remove only disposable profiles created by this milestone, after Chrome exits.
  const artifactRoot = resolve(fileURLToPath(output))
  for (const name of await readdir(artifactRoot)) {
    const candidate = resolve(artifactRoot, name)
    if (candidate === resolve(profile) && dirname(candidate)===artifactRoot)
      await rm(candidate, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 })
  }
}
