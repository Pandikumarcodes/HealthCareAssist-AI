# Step 6.2 — Security, Accessibility and UI Polish

Verified 24 October 2026. This milestone hardens the existing portfolio demo. No application rebuild, new workflow, database model, migration, dependency, CI/CD or deployment was introduced. Step 6.3, 7.1 and 7.2 were not started.

## A. Audit summary

Reviewed the factory/configuration, every API blueprint, authentication/CSRF, error handling, PDF storage/validation/processing/search, AI validation/provider handling, shared client/auth provider/router, all main pages, navigation, dialogs, forms, feedback and existing tests. Read Step 6.1, demo authentication, Step 5.1a and Step 5.2 reports. The initial Git status and diff were clean. A pre-edit digest baseline covers 1,687 paths, including a digest of `backend/.env`; no configuration values were copied.

The issue/evidence/fix/risk table is [audit.md](../.verification-artifacts/security-step-6.2/audit.md).

| Severity | Confirmed findings | Outcome |
| --- | --- | --- |
| HIGH | None discovered | No unresolved HIGH finding |
| MEDIUM | Malformed Unicode credentials and deeply nested login JSON raised uncaught exceptions | Fixed and regression tested |
| MEDIUM | Route focus, navigation Escape handling, PDF server-validation focus and search-error associations | Fixed and regression tested |
| MEDIUM | Low contrast note/control boundaries; clipping or overlap with enlarged text | Fixed and browser verified |
| LOW | Small standalone link targets; missing explicit API nosniff/referrer policy | Fixed |

No discovered authentication/CSRF bypass, SQL injection, unsafe HTML execution, credential disclosure, citation-validation bypass or PDF path traversal. This audit is not a penetration-test certification.

## B. Security changes and retained behavior

An anonymous client that first bootstrapped its legitimate CSRF token could submit JSON containing a lone UTF-16 surrogate in either credential, causing `UnicodeEncodeError` during password hashing or username comparison. A 2.2 KiB nested JSON array caused `RecursionError`. Five tests reproduced these exceptions before the fix. Login now rejects malformed Unicode before hashing and catches JSON parser recursion, returning the existing `{error,code}` invalid-input envelope with status 400. Valid credentials, Unicode code-point limits and successful authentication contracts are unchanged. No authentication bypass was found. Uncaught errors could expose debugging details if an operator enabled the debugger, which remains prohibited for public hosting.

API responses now explicitly set `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`, including public health, private responses and routing errors. Existing cache control and cookie behavior remain. These API response headers do not establish the SPA document's embedding or CSP policy.

Thirteen added backend cases cover malformed credentials, deep JSON, headers/CORS absence, and CSRF rejection across text/plain, URL-encoded, multipart and `+json` requests. Existing 59 authentication cases cover server-side credential verification, fail-closed configuration, cookies, absolute/signature expiry, credential rotation, protected APIs, logout and CSRF. No testing-mode authentication bypass was added.

Cookies remain HttpOnly, SameSite=Lax, host-only, `/api` scoped, Secure by default and finite at eight hours. Reads do not extend sessions. Protected reads/mutations, multipart uploads and AI requests require authentication; unsafe methods require cookie-bound CSRF and enforce Origin/Fetch Metadata checks. No credentialed CORS or forwarded-header trust was introduced. Debug defaults off.

PDFs retain the 5 MiB file limit, multipart/form/part limits, signature/EOF/structural validation, encrypted/empty/corrupt rejection, private generated storage names, path/symlink protections, bounded workers and transactions. There is no PDF download/preview route or public storage endpoint. Document APIs expose metadata only. Search remains parameterized PostgreSQL full-text search. PyMuPDF, worker startup optimization, deadlines, chunking and indexing are unchanged.

The AI question limit remains **1,000 code points**. Keys stay server-side. Retrieval metadata and extractive quotes/citations remain validated. Provider errors stay sanitized, attempts remain one, and function/tool execution remains disabled. Responses and titles render as React text. Cancellation, in-memory chat, logout/cache cleanup and no conversation storage are preserved. No live provider calls were made.

## C. Accessibility

Target: [WCAG 2.2 Level AA](https://www.w3.org/TR/WCAG22/). Audited Login, Dashboard, Support Requests list/create/details/edit, Knowledge Base/library/search/upload/document details, AI Assistant, shared navigation and both delete dialogs.

- Route pathname changes focus the existing main landmark, including asynchronous detail pages. Query updates and field editing do not repeatedly move focus.
- Escape closes expanded navigation and returns focus to its toggle. Existing nonmodal mobile disclosure behavior is retained.
- Knowledge Base search validation is conditionally associated with the field using `aria-describedby` and an error ID.
- PDF server-validation failures focus the first invalid field after pending controls re-enable. A one-shot focus flag avoids stealing focus while the user edits another field.
- Sidebar note text improved from **4.15:1 to 4.82:1**. Input/select/textarea and secondary-button boundaries improved from **1.45–1.63:1 to 3.24:1** against white using the existing green palette. Existing focus rings remain visible.
- Standalone back/navigation/details links now provide at least 24px height. The measured enabled targets in the tested states met 24×24px without relying on spacing exceptions.
- Login/filter controls use minimum heights so enlarged text fits. Login grid/card sizing, desktop brand wrapping, mobile menu sizing and AI action wrapping prevent confirmed clipping/overlap.

Retained semantic labels/headings/landmarks, status text rather than color alone, required-field indications, native keyboard submission, error alerts, concise AI status announcements and focusable transcript scrolling. Native dialogs retain safe initial Cancel focus, Tab/Shift+Tab containment, Escape cancellation and restoration. Reduced motion still disables the loading spinner.

Computed contrast, layout checks, human screenshot review and keyboard review are evidence, not complete WCAG conformance. No assistive-technology/screen-reader evaluation was performed. Disabled controls and decorative artwork are excluded from applicable contrast/target measurements. Gradients and complex rendering are not certified by the small computed-color checker.

## D. UI polish

Reused AppLayout, Sidebar, RequestForm styles, DocumentUploadForm, existing links/buttons/dialogs and design colors. Improved narrow/enlarged Login, Support Request filters/forms, Knowledge Base controls and AI composer/header. Dashboard/navigation receive shared contrast, focus and wrapping improvements. Existing routes, card layouts, brand identity, sidebar and Tailwind setup remain. No broad redesign or business-logic change was made.

## E. File inventory

All paths below are relative to the project root.

| Change | Exact path | Reason |
| --- | --- | --- |
| Modified | `backend/app/auth.py` | Reject malformed login input; explicit API headers |
| Created | `backend/tests/test_security_polish.py` | 13 focused security regressions |
| Modified | `frontend/src/components/layout/AppLayout.tsx` | Route focus and Escape/focus return |
| Created | `frontend/src/components/layout/AppLayout.test.tsx` | Two navigation/focus regressions |
| Modified | `frontend/src/features/knowledge-base/DocumentUploadForm.tsx` | One-shot server-error focus after pending |
| Modified | `frontend/src/features/knowledge-base/KnowledgeBase.test.tsx` | Three field association/focus regressions |
| Modified | `frontend/src/pages/KnowledgeBasePage.tsx` | Associate search error with its field |
| Modified | `frontend/src/features/ai-assistant/ai-assistant.css` | Enlarged header/composer wrapping |
| Modified | `frontend/src/features/auth/auth.css` | Login reflow, minimum control height, boundaries |
| Modified | `frontend/src/features/dashboard/dashboard.css` | Sidebar contrast, brand/menu sizing, link target |
| Modified | `frontend/src/features/requests/requests.css` | Form/filter/button boundaries and filter height |
| Modified | `frontend/src/features/knowledge-base/knowledge-base.css` | Select boundary and details target |
| Modified | `frontend/src/index.css` | Shared standalone link target height/alignment |
| Modified | `docs/demo-authentication.md` | Current security changes and deployment gates |
| Created | `docs/step-6.2-implementation-report.md` | This report |

Exact paths and reasons for **every** created evidence file, including all 36 screenshots, are in [inventory.json](../.verification-artifacts/security-step-6.2/inventory.json). All evidence is under `.verification-artifacts/security-step-6.2/`: audit/baseline/preservation scripts and JSON, backend/startup JUnit, frontend reports, checks and browser harness/report. Disposable browser profiles were removed after the isolated browser exited; earlier milestone artifacts remain intact.

## F. Verification

| Check | Final result |
| --- | --- |
| Full backend | **503 passed**, original 490 cases retained, zero failures |
| PDF worker startup | **2 passed** separately, also included in full suite |
| Python | **3.11.9**, compilation passed |
| Dependency check | Passed; no broken requirements |
| Full frontend | **320 passed**, original 315 tests retained, zero failures |
| TypeScript | Passed |
| Oxlint | Passed |
| Production build | Passed |
| Browser | **110 layout states**, five workflow journeys; all requested widths |
| Git/preservation | Diff whitespace check passed; protected files and HEAD unchanged |

The two historical, unsuppressed SQLite/Alembic warnings concern reflection of PostgreSQL expression index `ix_document_chunks_search` in the existing migration tests. They are unchanged; SQLite cannot compare that expression index. The full backend run took 241.71 seconds; no worker deadlines were increased.

An initial frontend run could not write its report through the sandbox. A subsequent recorded run reported two existing request-list failures (one timeout, one delayed summary assertion) while other checks ran. The unchanged 22-test request-list file passed in isolation, then the full 319-test suite passed. After the final one-shot focus correction and its added case, the final full suite passed 320 tests. Assertions, timeouts and original tests were not weakened. The unsuccessful report remains as `frontend-tests.json`; final evidence is `frontend-tests-final.json`.

The existing dependency-free Chrome DevTools approach intercepts every API request and blocks external destinations. At **320, 375, 768, 1024 and 1440px**, it checks all nine page states and both delete dialogs at normal and **200% text size**, with long unbroken request/document titles and citations. Text-only resizing is simulated by doubling computed content font sizes; it is not a claim about every browser/OS zoom combination. No unexpected document overflow or offscreen action controls remained. Native selects retain their normal dropdown behavior. Screenshots cover normal/enlarged mobile and desktop views.

Keyboard review uses real browser key events for Tab/Shift+Tab, Enter, Space and Escape, with focus inspected after actions: login validation/submission, mobile navigation, dialog entry/containment/cancel/restore, AI submission and logout. Browser journeys cover guest redirect, generic invalid login, restored authenticated API state, main navigation, accessible loading/error/retry, grounded safe-text citations, session-expiry cleanup, relogin with empty chat, logout and protected-route rejection. Unit tests additionally verify private query/mutation cache removal and cancellation. Reduced-motion CSS is verified. No application exceptions occurred.

## G. Safety and preservation

Audited fixtures use disposable temporary/in-memory SQLite and ephemeral demo credentials. Before the full run, verified the autouse DBAPI guard rejects non-SQLite connections before opening them; PostgreSQL configuration tests inspect URLs or mock operations. No live PostgreSQL database or unrelated data was modified. AI SDK boundaries and browser responses are mocked. **Zero live Gemini calls.** All data is fictional.

`backend/.env` is unchanged. Deliverables pass a local secret non-disclosure scan that emits only Boolean results. Dependencies/lockfiles, migrations, models, PDF processing/worker code and AI contracts retain their baseline hashes. Original backend case IDs and all 315 frontend test names are retained; comparison normalizes only the generated expiry timestamp embedded in two existing parameterized auth test names. No credentials were placed in the frontend or report. Existing Git changes were preserved (initial tree clean). No reset, clean, commit, push or deployment occurred. Verification helpers and screenshots remain inside this project.

## H. Remaining limitations and deployment requirements

| Severity/type | Remaining finding or required action |
| --- | --- |
| HIGH | None discovered or unresolved in this milestone |
| MEDIUM — architecture/production gate | Shared demo account has no shared login throttling, per-session server revocation, MFA, role separation or identity audit. Copied signed cookies can remain valid until expiry after browser logout. No reliable shared limiter exists to reuse; no process-local limiter was added. Evaluate shared abuse controls before public exposure. |
| MEDIUM — deployment requirement | Verify HTTPS, Secure cookies, DEBUG off, signing-secret management, explicit trusted hosts and public Host/scheme handling against the actual deployment. No hostname, ProxyFix or forwarded-header trust was guessed. |
| MEDIUM — deployment requirement | Hosting must set/validate the SPA document's nosniff/referrer/frame policy and a CSP tested against the actual built Vite app. Frame restrictions/CSP and HTTPS-only HSTS belong to verified hosting configuration; none was blindly enabled for local HTTP. Keep browser/API same-origin; cross-origin credentialed hosting remains unsupported. |
| MEDIUM — resource/deployment requirement | Login/AI/PDF endpoint bounds remain; Support Request descriptions retain the existing unrestricted TEXT contract. Validate reverse-proxy/WSGI request-size, timeout and concurrency ceilings before public exposure, including that route; no arbitrary description limit or contract change was introduced. |
| MEDIUM — unverified integration | Live PostgreSQL application journey, actual demo credentials, HTTPS reverse proxy and live Gemini/Free Tier eligibility/quota are **UNVERIFIED**. Tests do not substitute for these integrations. |
| LOW — future hardening | Consider advanced PDF malware scanning before accepting untrusted public documents. Current structural/resource checks are not antivirus. No OCR/scanning service or processing architecture was added. |
| LOW — verification scope | Broader assistive-technology testing, all browser/OS zoom modes and exhaustive WCAG evaluation remain unperformed. Stale cross-tab CSRF tokens still require refresh without mutation replay. |

This is not production readiness, healthcare compliance or full WCAG conformance.

## I. Final verdict

**STEP 6.2 COMPLETE**

Stop at Step 6.2. No later milestone, CI/CD or deployment work was started.
