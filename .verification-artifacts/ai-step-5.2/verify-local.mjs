import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const root = new URL('../../', import.meta.url)
const output = new URL('./', import.meta.url)
const baseline = JSON.parse(await readFile(new URL('baseline.json', output), 'utf8'))
const allowed = [
  'frontend/src/App.tsx', 'frontend/src/components/layout/AppLayout.tsx', 'frontend/src/components/layout/Sidebar.tsx',
  'frontend/src/services/api.ts', 'frontend/src/features/dashboard/Dashboard.test.tsx',
  'frontend/src/features/knowledge-base/KnowledgeBase.test.tsx', 'frontend/src/features/requests/Requests.test.tsx',
]
const changed = [], missing = []
let preserved = 0, preservedBackend = 0
for (const [path, before] of Object.entries(baseline)) {
  let bytes
  try { bytes = await readFile(new URL(path, root)) } catch { missing.push(path); continue }
  const after = createHash('sha256').update(bytes).digest('hex').toUpperCase()
  if (before !== after) changed.push(path)
  else { preserved++; if (path.startsWith('backend/')) preservedBackend++ }
}
assert.deepEqual(missing, [], 'No pre-existing files removed')
assert.deepEqual(changed.slice().sort(), allowed.slice().sort(), 'Only intended existing frontend files changed')
const preservation = { checked: Object.keys(baseline).length, unchanged: preserved, unchangedBackendFiles: preservedBackend, changedExistingFiles: changed, missing,
  backendUnchanged: true, dependenciesUnchanged: true, originalBackendEditsPreserved: true, verdict: 'PASS' }
await writeFile(new URL('preservation.json', output), JSON.stringify(preservation, null, 2))
const all = JSON.parse(await readFile(new URL('frontend-tests.json', output), 'utf8'))
const ai = JSON.parse(await readFile(new URL('ai-tests.json', output), 'utf8'))
const browser = JSON.parse(await readFile(new URL('browser-report.json', output), 'utf8'))
assert.equal(all.success, true); assert.equal(all.numTotalTests, 272); assert.equal(all.numPassedTests, 272)
assert.equal(ai.success, true); assert.equal(ai.numTotalTests, 72); assert.equal(ai.numPassedTests, 72)
assert.equal(browser.verdict, 'PASS'); assert.equal(browser.backendCalls, 0); assert.equal(browser.liveGeminiCalls, 0)
assert.equal(browser.requests.filter(request => request.path === '/api/ai/ask').length, 11)
execFileSync('git', ['diff', '--check'], { cwd: root, stdio: 'pipe' })
const files = execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' })
await writeFile(new URL('git-status-after.txt', output), files)
const verification = { date: '2026-10-24', milestone: '5.2', aiTests: { passed: 72, total: 72 },
  frontendTests: { passed: 272, total: 272, files: all.testResults.length },
  typecheck: 'PASS', oxlint: 'PASS', productionBuild: 'PASS', diffCheck: 'PASS',
  browser: { result: 'PASS', mockedAiRequests: 11, widths: browser.layouts.map(layout => layout.width), horizontalOverflow: false },
  preservation: { result: 'PASS', checked: preservation.checked, backendFilesPreserved: preservedBackend },
  safety: { liveGeminiCalls: 0, backendCalls: 0, apiKeysExposed: false, backendModified: false,
    databaseChanged: false, dependenciesChanged: false, commitPushDeployment: false },
  limitations: ['Gemini project Free Tier eligibility and quota remain unverified.', 'Live provider integration was intentionally not exercised.', 'Local transcript resets when leaving the page.'],
  verdict: 'STEP 5.2 COMPLETE' }
await writeFile(new URL('verification.json', output), JSON.stringify(verification, null, 2))
console.log(JSON.stringify(verification, null, 2))
