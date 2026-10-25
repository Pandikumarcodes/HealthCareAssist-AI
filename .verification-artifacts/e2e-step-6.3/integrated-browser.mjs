// Real browser -> Vite proxy -> real Flask -> dedicated PostgreSQL.
// Only explicitly labelled failures are intercepted. Provider is mocked in Python.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const input = await new Promise(resolve => { let data=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', x=>data+=x); process.stdin.on('end', ()=>resolve(JSON.parse(data))) })
const output = new URL('./', import.meta.url), origin = 'http://127.0.0.1:5186'
const profile = fileURLToPath(new URL(`browser-profile-${Date.now()}/`, output))
const report = { requests: [], responses: [], failuresInjected: [], layouts: [], workflows: [], exceptions: [], blockedExternal: [] }
let ws, chrome, sequence=0, failure, delayNext=false
const pending = new Map()
function send(method, params={}) {
  return new Promise((resolve,reject)=>{
    const id=++sequence, timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}`))},15000)
    pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}})
    ws.send(JSON.stringify({id,method,params}))
  })
}
async function evaluate(expression) {
  const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
  if(r.exceptionDetails) throw new Error('Browser evaluation failed')
  return r.result.value
}
async function until(expression,label) {
  const end=Date.now()+18000
  while(Date.now()<end){if(await evaluate(`Boolean(${expression})`))return;await new Promise(r=>setTimeout(r,80))}
  throw new Error(`Timed out: ${label}`)
}
async function key(key,code,virtual,modifiers=0,text) {
  await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtual,modifiers,...(text?{text}:{})})
  await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtual,modifiers})
}
const enter=()=>key('Enter','Enter',13,0,'\r'), tab=(shift=false)=>key('Tab','Tab',9,shift?8:0)
async function type(selector,value) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`)
  await key('a','KeyA',65,2)
  await send('Input.insertText',{text:value})
}
async function select(selector,value) {
  const index=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();return [...e.options].findIndex(o=>o.value===${JSON.stringify(value)})})()`)
  assert.ok(index>=0,'Supported select option')
  await key('Home','Home',36)
  for(let i=0;i<index;i++)await key('ArrowDown','ArrowDown',40)
  await key('Tab','Tab',9)
}
async function button(label,scope='document') {
  const ok=await evaluate(`(()=>{const e=[...${scope}.querySelectorAll('button')].find(e=>(e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)})&&!e.disabled);if(!e)return false;e.focus();return true})()`)
  assert.ok(ok,`Enabled button: ${label}`);await enter()
}
async function go(path,ready) {
  const hidden=await evaluate(`(()=>{const a=document.querySelector('a[href="${path}"]');return a&&a.closest('aside')&&getComputedStyle(a.closest('aside')).display==='none'})()`)
  if(hidden)await button('Open navigation')
  const found=await evaluate(`(()=>{const a=[...document.querySelectorAll('a[href="${path}"]')].find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);if(!a)return false;a.focus();return true})()`)
  if(found)await enter();else await send('Page.navigate',{url:origin+path})
  await until(`location.pathname===${JSON.stringify(path)}&&(${ready})`,path)
}
async function layout(page,width) {
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const r=await evaluate(`({page:${JSON.stringify(page)},width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,offscreen:[...document.querySelectorAll('main button,main input,main textarea,dialog[open] button')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&(r.left< -1||r.right>innerWidth+1)}).map(e=>e.id||e.tagName)})`)
  assert.equal(r.width,width);assert.equal(r.overflow,false,`Overflow: ${page}/${width}`);assert.deepEqual(r.offscreen,[],`Controls: ${page}/${width}`);report.layouts.push(r)
  await writeFile(new URL('integrated-browser-report.json',output),JSON.stringify(report,null,2))
}
async function login(valid=true) {
  await type('#username',input.username);await tab()
  assert.equal(await evaluate('document.activeElement.id'),'password')
  await send('Input.insertText',{text:valid?input.password:'invalid-fictional'});await enter()
}
async function intercept({requestId,request}) {
  const url=new URL(request.url)
  if(url.origin!==origin){report.blockedExternal.push(url.origin);return send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'})}
  if(url.pathname.startsWith('/api/'))report.requests.push({method:request.method,path:url.pathname})
  if(failure&&url.pathname===failure.path&&request.method===failure.method){
    const f=failure;if(!f.sticky)failure=undefined;report.failuresInjected.push({path:f.path,method:f.method,type:f.type??'HTTP 500'})
    if(f.type==='network')return send('Fetch.failRequest',{requestId,errorReason:'ConnectionFailed'})
    return send('Fetch.fulfillRequest',{requestId,responseCode:500,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({error:'PRIVATE controlled failure'})).toString('base64')})
  }
  if(delayNext&&url.pathname==='/api/ai/ask'){delayNext=false;await new Promise(r=>setTimeout(r,800))}
  return send('Fetch.continueRequest',{requestId})
}

try {
  await mkdir(profile,{recursive:true})
  chrome=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-extensions','--disable-sync','about:blank'],{windowsHide:true,stdio:'ignore'})
  let port
  for(let i=0;i<150;i++){try{[port]=(await readFile(`${profile}/DevToolsActivePort`,'utf8')).trim().split(/\r?\n/);break}catch{await new Promise(r=>setTimeout(r,100))}}
  assert.ok(port,'Chrome ready')
  const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json()
  ws=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})
  ws.addEventListener('message',({data})=>{
    const m=JSON.parse(data)
    if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}}
    else if(m.method==='Fetch.requestPaused')void intercept(m.params).catch(error=>{if(!/Invalid InterceptionId/.test(error.message))report.exceptions.push('request interception error')})
    else if(m.method==='Runtime.exceptionThrown')report.exceptions.push('uncaught browser exception')
    else if(m.method==='Network.responseReceived'&&m.params.response.url.startsWith(origin+'/api/'))report.responses.push({path:new URL(m.params.response.url).pathname,status:m.params.response.status})
  })
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]})
  report.browserVersion=(await send('Browser.getVersion')).product
  for(const width of [320,375,768,1024,1440]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false})
    await send('Page.navigate',{url:origin+'/dashboard'})
    await until("location.pathname==='/login'&&document.querySelector('#username')",'anonymous redirect')
    assert.equal(await evaluate("!!document.querySelector('.dashboard-shell')"),false)
    await layout('login',width)
    await login(false)
    await until("document.querySelector('[role=alert]')?.textContent.includes('Invalid username')",'generic credentials error')
    await type('#password',input.password);await enter()
    await until("document.body.textContent.includes('Summary loaded')",'real login/dashboard')
    assert.equal(await evaluate('document.activeElement.id'),'dashboard-main')
    await until("document.body.textContent.includes('No support requests yet.')",'empty dashboard')
    await layout('dashboard',width)
    const cookies=(await send('Network.getCookies',{urls:[origin+'/api/auth/me']})).cookies
    const cookie=cookies.find(c=>c.name==='healthcareassist_session')
    assert.ok(cookie?.httpOnly);assert.equal(cookie.sameSite,'Lax');assert.equal(cookie.path,'/api');assert.equal(cookie.secure,false)
    assert.equal(await evaluate("document.cookie.includes('healthcareassist_session')"),false)
    await send('Page.reload')
    await until("document.body.textContent.includes('Summary loaded')",'session restored after refresh')
    if(width===320){
      failure={path:'/api/dashboard/summary',method:'GET',type:'network',sticky:true}
      await send('Page.reload')
      await until("document.querySelector('[role=alert]')",'backend unavailable feedback')
      assert.equal(await evaluate("document.body.textContent.includes('PRIVATE')"),false)
      failure=undefined
      await button('Try again')
      await until("document.body.textContent.includes('Summary loaded')",'dashboard explicit recovery')
    }
    await go('/requests',"document.querySelector('#request-search')")
    await until("document.body.textContent.includes('No support requests')",'empty requests')
    await layout('requests',width)
    await go('/requests/new',"document.querySelector('#title')")
    await button('Create request')
    assert.equal(await evaluate('document.activeElement.id'),'title')
    await type('#title',`Fictional cancellation ${width}`);await tab()
    assert.equal(await evaluate('document.activeElement.id'),'description')
    await send('Input.insertText',{text:'Fictional appointment assistance. '.repeat(10)})
    await tab();assert.equal(await evaluate('document.activeElement.id'),'category')
    await key('a','KeyA',65,0,'a');await tab()
    // Native select keyboard chooses APPOINTMENT (the only A label).
    assert.equal(await evaluate("document.querySelector('#category').value"),'APPOINTMENT')
    await layout('new-request',width)
    await enter()
    await until("/^\\/requests\\/\\d+$/.test(location.pathname)&&document.querySelector('#change-status')",'created details')
    const requestPath=await evaluate('location.pathname')
    await layout('request-details',width)
    await go(requestPath+'/edit',"document.querySelector('#title')?.value")
    await type('#title',`Fictional revised ${width}`)
    if(width===320){
      failure={path:'/api'+requestPath,method:'PATCH'}
      await button('Save changes');await until("document.querySelector('[role=alert]')?.textContent.includes('Unable to save')",'failed update')
      assert.equal(await evaluate("document.querySelector('#title').value"),`Fictional revised ${width}`)
    }
    await layout('edit-request',width);await button('Save changes')
    await until("document.querySelector('#change-status')",'edited detail')
    await select('#change-status','IN_PROGRESS');await button('Save status')
    await until("document.body.textContent.includes('Status updated successfully.')",'status saved')
    await send('Page.reload');await until("document.querySelector('#change-status')?.value==='IN_PROGRESS'",'database persistence after refresh')
    await go('/dashboard',"document.body.textContent.includes('Summary loaded')")
    // Read actual backend values and compare rendered cards in display order.
    const counts=await evaluate("fetch('/api/dashboard/summary').then(r=>r.json())")
    const rendered=await evaluate("[...document.querySelectorAll('.stats-grid .stat-value')].map(e=>e.textContent.trim())")
    assert.deepEqual(rendered,[counts.total_requests,counts.open_requests,counts.in_progress_requests,counts.resolved_requests].map(String))
    await go('/requests',"document.querySelector('#request-search')")
    await type('#request-search',`revised ${width}`);await select('#request-status','IN_PROGRESS');await select('#request-category','APPOINTMENT')
    await until(`document.querySelector('.request-cards h3')?.textContent.includes('revised ${width}')`,'search/filter')
    await go(requestPath,"document.querySelector('#change-status')")
    await button('Delete');await until("document.querySelector('dialog[open]')",'request dialog')
    assert.equal(await evaluate('document.activeElement.textContent.trim()'),'Cancel')
    await tab(true);assert.equal(await evaluate("document.activeElement.classList.contains('request-danger')"),true)
    await tab();assert.equal(await evaluate('document.activeElement.textContent.trim()'),'Cancel')
    await layout('request-dialog',width)
    await key('Escape','Escape',27);await until("!document.querySelector('dialog[open]')",'cancel deletion')
    await button('Delete');await until("document.querySelector('dialog[open]')",'delete dialog')
    if(width===320){failure={path:'/api'+requestPath,method:'DELETE'};await button('Delete request',"document.querySelector('dialog')");await until("document.querySelector('dialog [role=alert]')",'failed deletion');assert.equal(await evaluate("!!document.querySelector('dialog[open]')"),true)}
    await button('Delete request',"document.querySelector('dialog')")
    await until("location.pathname==='/requests'&&document.body.textContent.includes('Request deleted successfully.')",'deleted request')
    await go('/knowledge-base',"document.querySelector('#document-file')")
    await until("document.body.textContent.includes('No documents yet.')",'empty library')
    await send('DOM.getDocument')
    const root=await send('DOM.getDocument')
    const node=await send('DOM.querySelector',{nodeId:root.root.nodeId,selector:'#document-file'})
    await send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[fileURLToPath(new URL('synthetic-policy.pdf',output))]})
    await type('#document-title',`Fictional Cancellation ${width}`)
    await button('Upload PDF')
    await until("document.querySelector('.kb-upload-feedback a')",'real PDF upload and extraction')
    const docPath=await evaluate("document.querySelector('.kb-upload-feedback a').getAttribute('href')")
    await type('#document-search','cancellation')
    await until("document.querySelector('.kb-passages li')",'PostgreSQL search in UI')
    assert.equal(await evaluate("document.querySelector('.kb-page').textContent.trim()"),'Page 1')
    await layout('knowledge-base-search',width)
    await type('#document-search','unfindablezebra')
    await until("document.body.textContent.includes('No matching passages.')",'zero search')
    await go(docPath,"document.querySelector('.request-detail h2')")
    await layout('document-details',width)
    await go('/ai-assistant',"document.querySelector('#ai-question')")
    await type('#ai-question','cancellation');delayNext=true
    const before=report.requests.filter(r=>r.path==='/api/ai/ask').length
    await enter();await enter();await enter()
    await until("document.querySelector('.ai-sources a')",'grounded real retrieval answer')
    assert.equal(report.requests.filter(r=>r.path==='/api/ai/ask').length-before,1)
    assert.equal(await evaluate("document.querySelector('.ai-sources a').getAttribute('href')"),docPath)
    assert.equal(await evaluate("document.querySelector('.ai-sources').textContent.includes('Page 1')"),true)
    assert.equal(await evaluate("document.querySelector('.ai-assistant .ai-message-text').textContent.includes('24 hours')"),true)
    assert.equal(await evaluate("document.querySelector('.ai-message-text img')===null"),true)
    await layout('ai-grounded-citations',width)
    if(width===320){await evaluate('window.scrollTo(0,0)');const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(new URL('320-integrated-ai.png',output),Buffer.from(shot.data,'base64'))}
    await type('#ai-question','unfindablezebra');await enter()
    await until("document.body.textContent.includes(\"I couldn't find this information in the uploaded documents.\")",'AI no-context')
    if(width===320){
      failure={path:'/api/ai/ask',method:'POST',type:'network'}
      await type('#ai-question','cancellation');await enter()
      await until("document.querySelector('.ai-turn:last-child [role=alert]')",'network error UI')
      assert.equal(await evaluate("document.querySelector('#ai-question').value"),'cancellation')
    }
    await button('Clear chat');assert.equal(await evaluate("document.querySelector('.ai-turn')===null"),true)
    // Cancellation is existing route-unmount cancellation, not an invented Cancel control.
    await type('#ai-question','cancellation');delayNext=true;await enter()
    await go('/dashboard',"document.body.textContent.includes('Summary loaded')")
    await go('/ai-assistant',"document.querySelector('#ai-question')")
    assert.equal(await evaluate("document.querySelector('.ai-turn')===null"),true)
    await go(docPath,"document.querySelector('.request-detail h2')")
    await button('Delete document');await until("document.querySelector('dialog[open]')",'document dialog')
    await layout('document-dialog',width)
    assert.equal(await evaluate('document.activeElement.textContent.trim()'),'Cancel')
    await button('Delete document',"document.querySelector('dialog')")
    await until("location.pathname==='/knowledge-base'&&document.body.textContent.includes('Document and indexed text deleted successfully.')",'document deletion')
    await go('/ai-assistant',"document.querySelector('#ai-question')")
    await type('#ai-question','unfindablezebra');await enter()
    await until("document.querySelector('.ai-turn')&&document.body.textContent.includes(\"I couldn't find\")",'chat before logout')
    if(width<=375)await button('Open navigation')
    await button('Logout')
    await until("location.pathname==='/login'&&document.querySelector('#username')",'logout')
    await send('Page.navigate',{url:origin+'/knowledge-base'})
    await until("location.pathname==='/login'&&document.querySelector('#username')",'protected after logout')
    await login();await until("document.querySelector('.dashboard-shell')",'relogin')
    await go('/ai-assistant',"document.querySelector('#ai-question')")
    assert.equal(await evaluate("document.querySelector('.ai-turn')===null"),true)
    assert.equal(await evaluate('localStorage.length+sessionStorage.length'),0)
    await send('Network.setCookie',{name:'healthcareassist_session',value:input.expiredCookie,url:origin+'/api',path:'/api',httpOnly:true,sameSite:'Lax'})
    await send('Page.reload')
    await until("location.pathname==='/login'&&document.querySelector('#username')",'server expired signed session')
    assert.equal(await evaluate("!!document.querySelector('.dashboard-shell')"),false)
    report.workflows.push({width,authentication:true,restoration:true,dashboard:true,requestCRUD:true,searchFilter:true,pdf:true,postgresSearch:true,aiGrounding:true,citations:true,noContext:true,duplicatePrevention:true,routeCancellation:true,clearChat:true,logout:true,expiredSession:true,storageEmpty:true})
  }
  assert.deepEqual(report.exceptions,[])
  assert.equal(await evaluate("document.body.textContent.includes('PRIVATE')"),false)
  report.verdict='PASS'
} catch(error) {
  report.verdict='FAIL';report.failure=error.message
  report.location=await evaluate('location.pathname').catch(()=>null)
  report.alerts=await evaluate("[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)").catch(()=>[])
  report.fieldErrors=await evaluate("[...document.querySelectorAll('.field-error')].map(e=>e.textContent)").catch(()=>[])
  process.exitCode=1
} finally {
  await writeFile(new URL('integrated-browser-report.json',output),JSON.stringify(report,null,2))
  if(ws?.readyState===WebSocket.OPEN){await send('Browser.close').catch(()=>{});ws.close()}
  if(chrome&&chrome.exitCode===null){chrome.kill();await new Promise(r=>chrome.once('exit',r))}
  const root=resolve(fileURLToPath(output)),candidate=resolve(profile)
  assert.equal(dirname(candidate),root);assert.match(candidate.split(/[\\/]/).at(-1),/^browser-profile-\d+$/)
  await rm(candidate,{recursive:true,force:true,maxRetries:8,retryDelay:200})
}
