# Step 6.3 — End-to-End Testing and Full Regression

Verified 24 October 2026, in `D:\HealthAssit\HealthCareAssist-AI`. Scope: verify and stabilize the existing portfolio application. The only application change is the confirmed Vite development-proxy integration correction described below. Existing Step 6.2 changes were preserved. No CI/CD, GCP, or Step 7 work was started.

## A. Environment and isolation

Backend: Python 3.11.9, Flask 3.1.3, SQLAlchemy 2.1.6, Flask-Migrate 4.1.0, psycopg 3.3.6, Pytest 9.1.1, PyMuPDF 1.28.2, google-genai 2.33.0. Frontend: React 19.3.1, TypeScript 6.0.3, Vite 8.3.5, Vitest 5.0.5, Oxlint 1.89.0, Node 24.18.0. Browser: isolated headless Chrome 155.0.8059.85, using the established dependency-free Chrome DevTools harness. No packages or frameworks were installed.

Initial Git status contained the Step 6.2 implementation, tests, documentation and artifacts. A SHA-256 snapshot covers tracked and existing untracked files, plus `backend/.env`. The pre-edit workflow/environment/coverage/safety plan is [test-plan.md](../.verification-artifacts/e2e-step-6.3/test-plan.md).

The first PostgreSQL inspection explicitly set `default_transaction_read_only=on` and inspected catalogs only. Local configuration points to `localhost:7498/healthcareassist_ai`; its configured role is a superuser. There was no project-specific test database or test URL. Several unrelated databases share that service, including another project's test database; none was selected or modified.

Following explicit execution approval, each integration run created a fresh `hca_e2e_63_<random>` database from `template0` and a separate random-password role. The role owns only the newly created test database and has `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, and `NOREPLICATION`. PUBLIC database privileges were revoked on the new database. No grants or changes were made to existing databases. A SQLAlchemy connection guard permits only the exact generated database/role/port, and database identity and role flags were checked from the actual connection.

PostgreSQL is version 18.4. Existing migrations were applied through Flask-Migrate to head `9d82b6f31a04`. The PostgreSQL GIN full-text index was verified in the catalog. No new migration, model change, `create_all()` substitute, or application-data reset was used. The ordinary Pytest suite retains its original unconditional SQLite-only DBAPI guard.

Flask ran on `127.0.0.1:5053` through its actual WSGI application; Vite ran on `127.0.0.1:5186`, using the repository's proxy configuration. `TESTING=False` was used for this integration app. Credentials and signing secrets were generated in memory; browser credentials were passed over stdin, never in source, arguments, reports, or browser storage. No auth bypass or additional application endpoint was introduced. PDF storage used an exclusive temporary private directory inside the milestone artifact directory.

All browser-created requests, documents, chunks and PDF files were verified absent before teardown. Cleanup drops only the newly created database after checking its generated name, database OID and owner, then removes its new role. The same cleanup ran after unsuccessful diagnostic attempts. Final catalog comparison verifies that the original database list is unchanged and no generated test role remains. Catalog comparison does not claim a row-by-row audit of unrelated data; isolation rests on the restricted test connection guard and the absence of commands targeting those databases.

## B. Workflows and integration evidence

### Authentication and logout

Real browser bootstrap, anonymous protected-route redirect, generic invalid credentials, successful fictional login, CSRF rotation, HttpOnly/SameSite/path cookie behavior, Dashboard navigation, refresh restoration, logout and protected-route rejection passed at all five widths. Browser storage remained empty. No protected application shell appeared in the observed unauthenticated/unresolved states. Relogin showed an empty chat. Existing component tests separately inspect private query/mutation cache removal and in-flight request cancellation.

A correctly signed but already expired test session was issued using the integration app's actual serializer and rejected by Flask after browser refresh. This exercises server expiration without waiting eight hours or adding an expiry endpoint. Cookie signature age/tampering, credential rotation, local expiry timing, safe destinations and non-sliding expiration are also covered by existing API/component tests. Secure cookies are checked in the existing backend suite; real browser checks used explicit local HTTP `Secure=False`. HTTPS proxy behavior was not tested.

### Dashboard and Support Requests

The empty dashboard and list passed. Real HTTP fixtures created requests in the supported `OPEN`, `IN_PROGRESS` and `RESOLVED` states; summary counts were compared to those fixtures. Browser cards were compared directly to the actual summary API. Browser creation, details, editing, status change, refresh persistence, title/description search, supported status/category filtering, keyboard delete dialogs and deletion passed at every requested width. PostgreSQL-backed API pagination used three fixture requests and a two-item page; real browser pagination across a large list was not separately exercised.

Invalid payloads, unauthenticated access, missing/invalid CSRF and cross-origin requests were rejected. Controlled commit failures exercised actual Flask rollback and PostgreSQL persistence checks for failed update/delete, followed by successful recovery. Browser-only injected update/delete failures verified retained input and an open, retryable delete dialog. Those injected failures are explicitly identified in the browser report.

### Knowledge Base

The generated one-page PDF contains only: “Demo Clinic appointment cancellation policy: Appointments can be cancelled 24 hours before the scheduled time.” Real multipart uploads passed through React, Vite and Flask. Existing validation/extraction subprocesses produced `INDEXED` metadata and real PostgreSQL chunks. Full-text search returned the stored document/chunk IDs and page 1; zero-match search and document metadata/details navigation passed. Deletion removed metadata, chunks, search results and the private PDF.

Actual HTTP checks rejected non-PDF, empty, structurally corrupt, oversized (5 MiB + 1 byte), and traversal filenames, invalid document IDs, unauthenticated upload and invalid multipart CSRF. A scoped extraction failure produced the existing `FAILED` status; the established `process-document` CLI retry produced `INDEXED`, followed by cleanup. No parsing, worker deadline, storage, chunking or processing lifecycle was changed. The two fresh-process worker import-boundary tests still pass.

### AI Assistant

The successful browser path was React → Vite → Flask → actual PostgreSQL full-text retrieval → fake Gemini SDK client → existing answer parser → Flask → React. Retrieval was never replaced to manufacture browser citations. The fake SDK client parsed the real generated request and asserted the configured model, one attempt, 1–5 passages, at most 1,200 characters per passage, known synthetic text and actual page provenance. It returned controlled extractive JSON. The application validated quotations and built citations using retrieved document/chunk IDs; UI links and page labels were checked against the uploaded document.

No-context questions produced the actual fallback and skipped the SDK. Real HTTP cases covered empty and 1,001-Unicode-code-point questions, invalid provider JSON, quota, rejected credentials, timeout and unavailability. Errors remained sanitized. An invented excerpt was rejected. Existing 104 AI tests additionally cover configuration, SDK serialization via mock HTTP transports, malformed responses, input/resource bounds and citation checks.

Browser tests verified readable answers/citations, three immediate Enter presses producing one POST, Clear chat, input retention after a controlled network error, route-unmount request cancellation, and removal of conversation history after logout/relogin. Cancellation is the existing browser request/unmount behavior; it does not imply remote model execution can be revoked.

## C. Verification levels and results

| Category | Result | Boundary / isolation |
| --- | --- | --- |
| Full existing backend Pytest | **503 passed**, zero failures/skips; two existing warnings | Actual Flask test client; disposable SQLite; provider/retrieval/connection doubles where appropriate |
| Authentication | **59 passed**, plus 13 security-polish cases | Included in 503; real Flask hooks, SQLite/mocks as fixtures require |
| Support Requests / Dashboard | **140 / 20 passed** | Included in 503 |
| Document APIs / PDF processing | **89 / 54 passed** | Included in 503; synthetic PDFs and disposable SQLite/private storage |
| AI | **104 passed** | Included in 503; SDK/HTTP transport/retrieval mocks |
| Database configuration / health | **19 / 3 passed** | Included in 503; PostgreSQL configuration/SQL tests are not live DB tests |
| PDF worker startup | **2 passed separately**, also included in 503 | Fresh subprocesses; web/ORM/Google import rejection |
| New standalone integration scenarios | **28 passed; 63 recorded direct HTTP requests**, plus focused proxy and browser requests | Actual HTTP Flask + exclusive PostgreSQL; controlled doubles only for labelled failures/provider |
| Full frontend Vitest | **320 passed**, zero failures | Components/shared clients with mocked HTTP, jsdom |
| Existing mocked browser regression | **110 layout states; five journeys passed** | All API traffic synthetic; no real backend claims |
| Real cross-stack browser | **55 layout states; five journeys passed** | Real browser + Vite + Flask + exclusive PostgreSQL; Gemini SDK fake |
| TypeScript / Oxlint / production build | **PASS / PASS / PASS** | Existing project commands/dependencies |
| Python compilation / dependency consistency | **PASS / PASS** | Existing venv; `pip check` reports no broken requirements |
| Preservation / whitespace / secret scan | **PASS** | Original case IDs and frontend test names retained; original files compared by digest |

The standalone scenarios and browser journeys are assertion-based verification scripts, not extra Pytest/Vitest cases. Do not add them to the 503/320 suite totals. Authentication/PDF/AI category counts overlap only as described above; startup cases are included in 503 and rerun separately.

Backend full-suite time was 196.07 seconds. The two unsuppressed warnings are the unchanged SQLite/Alembic reflection limitation for `ix_document_chunks_search`. PostgreSQL index creation and actual search were separately verified successfully; SQLite is not represented as a substitute for PostgreSQL lexical behavior.

An intermediate frontend rerun passed 319/320, with the existing logout/cache-cleanup case timing out while waiting for the login form. The unchanged 36-test auth file subsequently passed in isolation. The unsuccessful full report is retained as `frontend-tests-intermediate.json`; final full-suite evidence is separate. No assertion, timeout or application auth logic was changed to address this timing-sensitive observation.

Exact request counts, provider observations, response timing samples, assertion names and final resource names/OIDs are in [cross-stack-report.json](../.verification-artifacts/e2e-step-6.3/cross-stack-report.json), with retained-case comparisons and aggregate counts in [verification.json](../.verification-artifacts/e2e-step-6.3/verification.json).

### Browser evidence

Both harnesses used 320, 375, 768, 1024 and 1440 px. The reused mocked harness additionally exercised long unbroken titles, citations, both dialogs and simulated 200% text scaling. The actual integration harness checked login, dashboard, request list/form/details/edit/dialog, Knowledge Base search/details/dialog and grounded chat. No unexpected horizontal overflow, offscreen checked controls or uncaught application exceptions occurred.

Real keyboard events covered Tab/Shift+Tab, typing, Enter submission/activation, native select Home/Arrow keys, dialog containment/Escape and navigation focus. The harness positions initial focus programmatically and selects the PDF through the DevTools file-input facility. This is instrumented keyboard verification, not a screen-reader or exhaustive assistive-technology audit. Existing focus, validation associations, enlarged-text and reduced-motion checks remain intact. Complete WCAG conformance is not claimed.

Reports: [mocked browser](../.verification-artifacts/e2e-step-6.3/mocked-browser-report.json) and [integrated browser](../.verification-artifacts/e2e-step-6.3/integrated-browser-report.json). One representative [320px grounded-answer screenshot](../.verification-artifacts/e2e-step-6.3/320-integrated-ai.png) was retained and visually reviewed; previous milestone screenshots were preserved without generating duplicates.

## D. Confirmed defect and correction

**Vite proxy Host/Origin mismatch prevented real browser login and other protected POSTs.** The original string proxy shorthand implicitly enables `changeOrigin: true` in the installed Vite proxy implementation. Browser Origin remained `http://127.0.0.1:5186`, while Flask received Host `127.0.0.1:5053`, so its correct same-origin CSRF check returned 403. Mocked browser/component tests did not cross this boundary.

The failure reproduced in two real-browser attempts. [proxy-defect-before.json](../.verification-artifacts/e2e-step-6.3/proxy-defect-before.json) records login 403 and the generic security error. The original code's actual behavior also contradicted the existing auth documentation's statement that the proxy preserved Host.

The minimal fix in `frontend/vite.config.ts` uses an explicit proxy object with the same target and `changeOrigin: false`. Flask auth, CSRF, Origin validation, API contracts and public configuration remain unchanged. The focused live regression verifies invalid same-origin credentials → 401, mismatched Origin → 403, and valid same-origin credentials → 200. Subsequent browser mutations, including multipart uploads, passed through the actual proxy.

Two intermediate browser uploads of the valid synthetic PDF returned 400. The second captured response explicitly identifies the unchanged five-second structure-validation timeout; the first inner diagnostic was not captured. Twelve focused validation subprocess probes then all passed under the same five-second limit, in 0.565–1.049 seconds. A preceding complete five-width journey also passed unchanged, and the final sequential run passed all five journeys/55 layout states. These observations show intermittent local deadline sensitivity; the underlying operating-system scheduling/startup cause was not proven. No parsing change, increased timeout, skipped case or weakened assertion was used. Failed-run evidence remains in `pdf-timeout-integration.json` and `pdf-timeout-browser.json`. Harness-only diagnostic corrections addressed a hidden duplicate desktop link and React StrictMode's cancelled initial GET during the controlled outage probe; these were not application defects.

## E. Error recovery and performance sanity

Controlled HTTP/SDK/commit/extraction doubles covered database-query failure, failed mutations, PDF `FAILED`/retry, provider timeout/quota/authentication/unavailability/invalid output, and browser network interruption. The browser dashboard outage persisted across StrictMode bootstrap requests until explicit retry; it did not stop PostgreSQL or the shared service. Errors were understandable, sensitive diagnostics were not rendered, pending states terminated, failed edits retained input, and explicit retries recovered. Existing unit tests cover additional negative/error cases without repeating the entire Step 6.2 audit.

Build output is unchanged from Step 6.2: 109 modules, JavaScript **373.72 kB / 110.78 kB gzip**, CSS **43.01 kB / 9.79 kB gzip**, HTML 0.53 kB. The final 63 recorded direct HTTP checks had a median of **23.5 ms** and maximum **1,367.1 ms**, including password hashing and actual worker subprocess startup. These samples include expected failure cases and exclude browser/CDP overhead, focused proxy calls and live provider latency. No unexpected persistent query errors, automatic AI retries, duplicate submitted AI calls or resource leaks were observed. Development StrictMode can issue/cancel bootstrap GETs; those are not counted as duplicate user mutations. These are lightweight local sanity checks, not production benchmarks or scalability evidence.

## F. Final feature matrix

Legend: **S** = existing Flask API tests with SQLite fixtures; **M** = component/API/SDK or full browser mocks; **P** = isolated real PostgreSQL through actual HTTP Flask; **B** = browser UI through Vite/Flask/PostgreSQL. The provider remains mocked even in P/B.

| Feature | Status | Evidence level / qualification |
| --- | --- | --- |
| Login | PASS | S, M, P, B; real proxy regression |
| Session restoration | PASS | S, M, P, B; refresh with real cookie |
| Logout | PASS | S, M, P, B; current cookie cleared; copied-cookie revocation is unsupported |
| Protected routes | PASS | S, M, P, B |
| CSRF | PASS | S, M, P, B; missing/invalid/origin/multipart checks |
| Dashboard | PASS | S, M, P, B; empty and actual fixture counts |
| Support Request create | PASS | S, M, P, B |
| Support Request read | PASS | S, M, P, B |
| Support Request update | PASS | S, M, P, B; refresh persistence and failed-save handling |
| Support Request delete | PASS | S, M, P, B; rollback, dialog, recovery |
| Support Request search/filter | PASS | S, M, P, B; pagination also verified at P level |
| Knowledge Base upload | PASS | S, M, P, B; real multipart and synthetic PDF |
| PDF processing | PASS | S, P, B; actual workers; controlled failure/retry at P |
| PostgreSQL search | PASS | P, B; actual full-text query, chunks, pages, zero results |
| Document details | PASS | S, M, P, B; existing metadata contract |
| Document deletion | PASS | S, M, P, B; metadata/chunks/files cleaned |
| AI question submission | PASS | S/M, P, B; provider fake |
| AI grounding | PASS | M, P, B; real retrieval and extractive validation in P/B |
| AI citations | PASS | M, P, B; actual stored IDs/page 1 and UI link |
| AI no-context response | PASS | M, P, B; provider skipped |
| AI provider error handling | PASS | M, P; controlled SDK errors; UI mapping covered by components |
| Chat cancellation | PASS | M, B; browser abort/unmount; no remote cancellation claim |
| Chat clearing | PASS | M, B; clear and logout/relogin |
| Responsive layout | PASS | M/B; all five requested widths; mocked long text/enlargement |
| Keyboard accessibility | PASS | M/B; scoped instrumented checks, no complete WCAG claim |
| Production build | PASS | Existing local build; no hosting/deployment test |

| Integration intentionally not performed | Status | Reason |
| --- | --- | --- |
| Live Gemini, project Free Tier, billing eligibility and remaining quota | NOT TESTED | No live calls authorized; SDK replaced and external traffic forbidden |
| HTTPS reverse proxy, public hosts, forwarded headers and Secure-cookie deployment | NOT TESTED | No deployment infrastructure in this milestone |
| Existing locally configured demo password/account | NOT TESTED | Ephemeral fictional credentials used through real auth instead |
| Real application/other database contents | NOT TESTED | Safety boundary; catalogs only, no application-data tests |
| Malware scanning, production load/concurrency, full assistive-technology coverage | NOT TESTED | Outside the defined verification scope |

## G. File inventory and reproducibility

| Created/modified path | Reason |
| --- | --- |
| Modified `frontend/vite.config.ts` | Only application correction: preserve browser Host at the existing development proxy |
| Created `docs/step-6.3-e2e-verification-report.md` | This report, evidence levels, matrix and limitations |
| Created `.verification-artifacts/e2e-step-6.3/test-plan.md` | Pre-edit internal workflow/isolation/coverage/safety plan |
| Created `inspect_environment.py`, `baseline.json`, `environment.json` in that directory | Preservation snapshot, runtime versions and read-only DB discovery |
| Created `run_cross_stack.py`, `integrated-browser.mjs`, `synthetic-policy.pdf` | Opt-in isolated DB/role lifecycle, live HTTP regression cases, real browser journeys and fictional fixture |
| Created `mocked-browser.mjs` | Generated adaptation of the existing harness, separate output directory and screenshots disabled |
| Created `backend_checks.py`, `frontend_checks.py`, `catalog_after.py`, `verify_final.py` | Existing check orchestration, catalog cleanup evidence, retained-case and preservation/secret checks |
| Created `backend-tests.xml`, `pdf-startup.xml`, `frontend-tests.json`, `frontend-tests-intermediate.json`, `backend-checks.json`, `frontend-checks.json` | Full-suite/startup/compiler/dependency/type/lint/build evidence, including the intermediate frontend timeout |
| Created `cross-stack-report.json`, `integrated-browser-report.json`, `mocked-browser-report.json`, `mocked-browser.log`, `vite.log` | Labelled integration assertions, requests, controlled failures and browser results |
| Created `proxy-defect-before.json`, `first-integration-run.json` | Retained confirmed pre-fix failure and successful isolated-resource cleanup evidence |
| Created `320-integrated-ai.png`, `catalog-after.json`, `verification.json`, `inventory.json` | Representative screenshot, final cleanup/preservation/count review and exact evidence inventory |
| Created `worker_timings.py`, `worker-timings.json`, `pdf-timeout-integration.json`, `pdf-timeout-browser.json` | Twelve bounded worker timing probes and retained unsuccessful browser-upload evidence |

All artifact paths above are under `.verification-artifacts/e2e-step-6.3/`. `inventory.json` lists each deliverable's exact path and size. Temporary browser profiles were removed after Chrome exited, and private PDF directories after workflow cleanup. Ignored Python bytecode is not a deliverable. Pre-existing user artifacts were not removed or overwritten.

Relevant commands, from the project root unless noted:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest -q --junitxml=.verification-artifacts/e2e-step-6.3/backend-tests.xml
.\backend\.venv\Scripts\python.exe .verification-artifacts/e2e-step-6.3/backend_checks.py
# Privileged local setup/cleanup requires the recorded explicit approval:
.\backend\.venv\Scripts\python.exe .verification-artifacts/e2e-step-6.3/run_cross_stack.py --provision-disposable-postgres
.\backend\.venv\Scripts\python.exe .verification-artifacts/e2e-step-6.3/frontend_checks.py
.\backend\.venv\Scripts\python.exe .verification-artifacts/e2e-step-6.3/catalog_after.py
.\backend\.venv\Scripts\python.exe .verification-artifacts/e2e-step-6.3/verify_final.py
# From frontend/:
npm.cmd run test -- --maxWorkers=1 --reporter=json --outputFile=../.verification-artifacts/e2e-step-6.3/frontend-tests.json
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

`inspect_environment.py` captures the before-state and must not be rerun to overwrite the preservation baseline. `run_cross_stack.py` requires free local ports 5053/5186, the existing venv, frontend dependencies and existing Chrome installation. Its optional skip-mocked flag was used only for diagnostic development reruns; final verification included both harnesses.

## H. Safety and remaining limitations

Final hashes preserve all pre-existing user changes and artifacts except the explicitly corrected Vite file. `backend/.env`, dependencies/lockfiles, models, migrations, PDF implementation, authentication and AI contracts are unchanged. Original 503 backend case IDs and 320 frontend test names are retained. Staging is empty and HEAD unchanged. No secret from local configuration appears in the deliverables. No actual patient data, live Gemini call, billing change, reset, clean, commit, push, deployment, or unrelated PostgreSQL mutation occurred.

| Severity | Remaining limitation / requirement |
| --- | --- |
| HIGH | No unresolved high-severity application defect found in this milestone; this is not a penetration-test conclusion |
| MEDIUM | Deployment must establish shared login throttling, secret operations, trusted hosts, TLS/proxy/Host/scheme correctness, Secure cookies, SPA headers/CSP and resource/concurrency ceilings |
| MEDIUM | Shared signed-cookie demo lacks individual server-side session revocation; copied cookies can remain valid until expiry after logout; role separation/MFA/identity audit are not implemented |
| MEDIUM | Live Gemini project model access, Free Tier eligibility, billing state and remaining quota remain unverified; mocked integration does not establish live service availability |
| LOW | Intermediate local PDF rejection/timing sensitivity remains a caveat; final workers and all workflows passed unchanged |
| LOW | Public untrusted uploads need a separately evaluated malware-scanning strategy; broader browser/OS/assistive-technology coverage and load testing remain unperformed |

These are deployment/live-service limitations, not grounds to change application contracts or start Step 7 in this milestone. This report makes no production-readiness, healthcare-compliance or complete WCAG claim.

## I. Final verdict

**STEP 6.3 COMPLETE**

Required regression checks passed and essential cross-stack workflows were verified through the real local Flask backend and an exclusive PostgreSQL test database with Gemini safely mocked. Stop at Step 6.3; no Step 7.1 or 7.2 work was undertaken.
