import { readFileSync, writeFileSync } from 'node:fs';
const source = new URL('../e2e-step-6.3/mocked-browser.mjs', import.meta.url);
let script = readFileSync(source, 'utf8').replace(/\r\n/g, '\n');
script = script.replace('http://127.0.0.1:5186', 'http://127.0.0.1:5187');
script = script.replace('const report =', "let emptyData = false, aiMode = 'grounded'\nconst report =");
script = script.replace("  if (url.pathname === '/api/dashboard/summary') {", `  if (emptyData && url.pathname === '/api/dashboard/summary') return fulfill(requestId, { total_requests: 0, open_requests: 0, in_progress_requests: 0, resolved_requests: 0 })
  if (emptyData && ['/api/requests', '/api/documents'].includes(url.pathname)) return fulfill(requestId, { data: [], page: 1, page_size: 20, total: 0, total_pages: 0 })
  if (url.pathname === '/api/ai/ask' && aiMode === 'error') return fulfill(requestId, { code: 'ai_unavailable', error: 'PRIVATE provider diagnostic' }, 503)
  if (url.pathname === '/api/ai/ask' && aiMode === 'no-context') return fulfill(requestId, { answer: 'No supporting information was found in the fictional documents.', sources: [], grounded: false })
  if (url.pathname === '/api/dashboard/summary') {`);
script = script.replace("async function screenshot(name) { return; /* screenshots already retained in Step 6.2 */", "async function screenshot(name) {");
script = script.replace("url: origin + '/dashboard'", "url: origin + '/' ");
// This remains an isolated browser fixture: every API and external request is intercepted.
// Include root restoration, the new password control, and mobile composer sizing.
script = script.replace("await layout('login', width)", `assert.equal(await evaluate("document.querySelector('.connection-card')===null"), true)
    await evaluate("document.querySelector('.password-toggle').click()")
    assert.equal(await evaluate("document.querySelector('#password').type"), 'text')
    await evaluate("document.querySelector('.password-toggle').click()")
    assert.equal(await evaluate("document.querySelector('#password').type"), 'password')
    await layout('login', width)`);
script = script.replace("assert.equal(await evaluate('document.activeElement.id'), 'dashboard-main')\n    for", `assert.equal(await evaluate('document.activeElement.id'), 'dashboard-main')
    await send('Page.navigate', { url: origin + '/' })
    await until("location.pathname==='/dashboard' && document.body.textContent.includes('Summary loaded')", 'authenticated root')
    for`);
script = script.replace("if (page === 'ai-assistant') {", `if (page === 'ai-assistant') {
        await layout('ai-empty', width)
        if (width===320 || width===1440) await screenshot(width+'-ai-empty.png')`);
script = script.replace("await layout(page, width)\n      if", `if (page === 'ai-assistant' && width <= 375) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 500, deviceScaleFactor: 1, mobile: true })
        await evaluate("document.querySelector('#ai-question').focus();document.querySelector('#ai-question').scrollIntoView({block:'center'})")
        await layout('ai-composer-short-viewport', width)
        await screenshot(width+'-ai-composer-short-viewport.png')
        await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
      }
      await layout(page, width)
      if`);
script = script.replace("if (/^browser-profile-\\d+$/.test(basename(candidate)) && dirname(candidate)===artifactRoot)", "if (candidate === resolve(profile) && dirname(candidate)===artifactRoot)");
script = script.replace("await evaluate('window.scrollTo(0,0)')", "await evaluate('window.scrollTo(0,0); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')");
script = script.replace("await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })", "await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: (await send('Page.getLayoutMetrics')).cssLayoutViewport.clientWidth, height: (await send('Page.getLayoutMetrics')).cssContentSize.height, scale: 1 } })");
script = script.replace('  authenticated = true; failRequests = true', `  // Inspect actual rendered fallback states with isolated HTTP fixtures.
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
  authenticated = true; failRequests = true`);
for (const expected of ['authenticated root', 'ai-composer-short-viewport', 'candidate === resolve(profile)']) {
  if (!script.includes(expected)) throw new Error('Missing browser check: ' + expected);
}
writeFileSync(new URL('./browser-check.mjs', import.meta.url), script);
