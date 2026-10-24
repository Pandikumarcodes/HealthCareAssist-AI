# Step 6.1 — Demo Authentication

Verified 24 October 2026. Scope is limited to one fictional demo account. No Step 6.2, Step 6.3 or deployment work was implemented.

## A. Authentication architecture

Flask's existing signed-cookie session mechanism is used with environment-provided credentials and Werkzeug password verification. No database users, schema changes, OAuth, external identity service or new packages were introduced. A centralized app hook protects existing registered APIs. The factory loads auth only when creating the web app, preserving lightweight PDF worker imports.

The cookie is HttpOnly, SameSite=Lax, host-only and scoped to `/api`. Secure is enabled by default and must remain enabled over HTTPS; local HTTP requires explicit opt-out. Sessions expire eight hours after login, without extending on reads. Both cookie signature age and absolute expiry are enforced. Credential changes invalidate existing sessions through a keyed credential-version digest. Cookies contain no password/hash. The design follows [Flask's security guidance](https://flask.palletsprojects.com/en/stable/web-security/) and [session configuration](https://flask.palletsprojects.com/en/stable/config/).

## B. Backend implementation

| Endpoint                | Result                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/login`  | Bounded JSON username/password validation, constant generic invalid-credential response, server-side hash verification, previous session clearing and CSRF rotation. |
| `GET /api/auth/me`      | Authenticated metadata or 401 with an anonymous CSRF token for login bootstrap.                                                                                      |
| `POST /api/auth/logout` | Requires a valid session and CSRF; clears the current browser cookie.                                                                                                |

Missing/invalid `DEMO_USERNAME`, `DEMO_PASSWORD_HASH` or `SECRET_KEY` fails closed with a sanitized 503. Health remains public. Protected operations include dashboard, support requests, document upload/metadata/delete/search and AI requests. Unknown endpoints retain 404 behavior. Authentication is enforced in testing mode too.

All unsafe methods require a random cookie-bound synchronizer token in `X-CSRF-Token`. Explicit Origin headers must match the request origin; cross-site Fetch Metadata is rejected. This also protects login. Multipart PDF boundaries are untouched. No wildcard or credentialed CORS was added; the existing same-origin Vite proxy remains the development architecture. Private API responses use `Cache-Control: no-store`.

No successful existing business API payloads changed. `/api/ai/ask` still accepts `{question}` and returns `{answer,sources,grounded}`. Document storage remains private, without adding file-download routes.

## C. Frontend implementation

The responsive `/login` page uses existing visual conventions, accessible labels, masked password input, validation/focus feedback, generic errors, pending states and a same-tick submission lock. It contains no credentials, registration or dead recovery links.

TanStack Query loads `/auth/me` before protected content renders. An authenticated visitor to login returns to a validated local destination; guests are redirected to login while retaining a permitted destination. Existing application layouts/routes and public welcome/404 behavior remain.

The shared API client sends same-origin cookies and the in-memory CSRF token on mutations, including FormData uploads. Logout and expiry abort pending operations, reject obsolete responses, remove private query/mutation cache entries and unmount local AI history. Session revalidation losing authentication follows the same cleanup path. The server expiry supplies a local deadline. Private 401 responses expire authentication; 403 responses do not. Failed mutations are not retried. Logout network failure is shown honestly and leaves the UI available for retry.

## D. Files

Created application, test and documentation files:

| File                                          | Purpose                                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `backend/app/auth.py`                         | Auth blueprint, credential validation, session expiry, CSRF/origin enforcement and centralized protection. |
| `backend/scripts/generate_demo_auth.py`       | Interactive hidden-input setup; writes an ignored private configuration only when absent.                  |
| `backend/tests/conftest.py`                   | Ephemeral credentials, actual login fixture and non-SQLite connection guard.                               |
| `backend/tests/test_auth.py`                  | 59 focused backend authentication/security/integration cases.                                              |
| `frontend/src/services/auth.ts`               | Session bootstrap, login/logout HTTP methods and response validation.                                      |
| `frontend/src/services/auth.test.ts`          | Seven shared-client/CSRF/cancellation cases.                                                               |
| `frontend/src/features/auth/AuthProvider.tsx` | Session query, expiry handling, cleanup and route guards.                                                  |
| `frontend/src/features/auth/auth-context.ts`  | Shared auth context/hook.                                                                                  |
| `frontend/src/features/auth/validation.ts`    | Control-character checking and local redirect validation.                                                  |
| `frontend/src/features/auth/auth.css`         | Responsive login/session/logout styling.                                                                   |
| `frontend/src/features/auth/Auth.test.tsx`    | 36 login, route, restoration, expiry, logout and redirect cases.                                           |
| `frontend/src/pages/LoginPage.tsx`            | Accessible demo login form.                                                                                |
| `frontend/src/app/authenticated-test-app.tsx` | Explicit verified-session fixture for existing feature tests.                                              |
| `docs/demo-authentication.md`                 | Setup, contracts, session/CSRF details, testing and known limits.                                          |
| `docs/step-6.1-implementation-report.md`      | This report.                                                                                               |

Modified existing files:

| File                                                          | Purpose                                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `backend/app/__init__.py`                                     | Install auth inside the existing lazy factory.                                                                           |
| `backend/app/config.py`                                       | Environment credentials and cookie/lifetime configuration; normalize mixed line endings. Existing lazy imports retained. |
| `backend/.env.example`                                        | Blank credential placeholders and local HTTP cookie setting.                                                             |
| `backend/tests/test_ai.py`                                    | Use legitimate authenticated client.                                                                                     |
| `backend/tests/test_dashboard.py`                             | Use legitimate authenticated client for private reads.                                                                   |
| `backend/tests/test_requests.py`                              | Use legitimate authenticated client and CSRF headers.                                                                    |
| `backend/tests/test_documents.py`                             | Use legitimate authenticated client and CSRF headers.                                                                    |
| `backend/tests/test_document_processing.py`                   | Use legitimate authenticated client and CSRF headers.                                                                    |
| `frontend/src/App.tsx`                                        | Auth/login route nesting and injectable query client for tests.                                                          |
| `frontend/src/components/layout/Sidebar.tsx`                  | Logout action, pending guard and safe failure feedback. Existing AI navigation retained.                                 |
| `frontend/src/services/api.ts`                                | Cookie/CSRF handling, 401 notification and cancellation of obsolete requests; existing AI errors retained.               |
| `frontend/.env.example`                                       | Document same-origin requirement.                                                                                        |
| `frontend/src/features/dashboard/Dashboard.test.tsx`          | Explicit authenticated feature fixture.                                                                                  |
| `frontend/src/features/requests/Requests.test.tsx`            | Explicit authenticated feature fixture.                                                                                  |
| `frontend/src/features/requests/RequestManagement.test.tsx`   | Explicit authenticated feature fixture.                                                                                  |
| `frontend/src/features/knowledge-base/KnowledgeBase.test.tsx` | Explicit authenticated feature fixture.                                                                                  |
| `frontend/src/features/ai-assistant/AiAssistant.test.tsx`     | Explicit authenticated feature fixture.                                                                                  |
| `README.md`                                                   | Link to authentication setup.                                                                                            |

Evidence is under `.verification-artifacts/auth-step-6.1/`: baseline/preservation/verification JSON, full and focused JUnit/Vitest reports, setup verification, browser harness/report and six login/navigation screenshots. Existing milestone artifacts were preserved.

## E. Test results

| Check                          | Final result                                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full Pytest suite              | **490 passed**, zero failures/skips; all original 431 case IDs retained, plus 59 auth cases.                                                                                                                                             |
| Auth backend coverage          | Valid/invalid login, malformed/bounded input, missing/invalid config, session reads/expiry/tampering, cookie controls, logout, protected APIs, CSRF/origin, authenticated multipart PDF processing/validation and secret non-disclosure. |
| PDF regressions                | Existing document/processing cases pass in the full suite; dedicated worker startup run **2 passed**.                                                                                                                                    |
| Full Vitest suite              | **315 passed** across 15 files; all original 272 case names retained, plus 43 auth cases.                                                                                                                                                |
| TypeScript                     | Passed.                                                                                                                                                                                                                                  |
| Oxlint                         | Passed with zero warnings/errors.                                                                                                                                                                                                        |
| Production build               | Passed.                                                                                                                                                                                                                                  |
| Python compilation / pip check | Passed; no broken requirements.                                                                                                                                                                                                          |
| Credential setup helper        | Synthetic hash verification, hidden-input use, no secret output, no overwrite, and noninteractive rejection passed in a temporary directory.                                                                                             |
| Mocked browser                 | Passed at **375, 768, 1440 px**; no horizontal overflow, visible Logout, no application exceptions.                                                                                                                                      |
| Preservation / secret audit    | Passed; 119 baseline file digests checked, no missing/unexpected changes, no actual local secret found in scanned deliverables.                                                                                                          |

The two unchanged warnings are SQLite/Alembic reflection limitations for PostgreSQL expression index `ix_document_chunks_search`. They were investigated previously and remain unsuppressed. The backend run took approximately 476 seconds on this host; no PDF deadlines were increased. The original frontend Unicode request-creation test initially timed out under concurrent work, then passed in isolation and in the final full suite with one worker; its assertions and timeouts were not weakened.

The browser journey covers guest redirect, generic invalid credentials, keyboard login, Dashboard → Support Requests → Knowledge Base → AI Assistant, local mocked AI response, refresh restoration, logout, protected-route rejection and fresh dashboard data after another login. Unit tests directly inspect query/mutation cache cleanup. Browser interception cancellation records are obsolete GETs cancelled by StrictMode/navigation; they are recorded separately from application exceptions. Refresh checks wait for a new document time origin.

## F. Security and safety

`backend/.env`, dependency manifests, migrations, AI backend/contracts and PDF worker code are unchanged from the captured baseline. Existing user changes were reviewed and retained. No real password, hash or key was embedded in new source, API output or frontend bundles. The helper was tested with ephemeral synthetic values only; it did not create real local credentials.

Tests used isolated temporary SQLite databases or in-memory SQLite. A DBAPI guard rejects non-SQLite connections before opening them. Existing PostgreSQL URL tests inspect configuration without connecting. Neither `healthcareassist_ai` nor unrelated PostgreSQL databases were modified. Gemini calls were mocked; browser APIs were fully intercepted. No live Gemini request, dependency installation, migration, commit, push or deployment occurred.

## G. Remaining issues and verification limits

No known failing tests or functional defects remain. Manual local credential setup is still required before normal login; failing closed until configured is intentional. Actual local credentials, live PostgreSQL auth journeys, HTTPS reverse-proxy behavior and live Gemini behavior were not exercised. Gemini Free Tier eligibility and remaining quota remain unverified.

This is a shared fictional account with no login throttling, MFA, identity audit or persistent per-session revocation. Logout clears the current browser cookie but cannot revoke a copied cookie before expiry. Rotating the signing key invalidates all sessions. Cross-origin hosting is unsupported; stale CSRF tokens require refresh. Later security work should evaluate throttling, revocable server sessions, TLS/proxy/host validation, secret operations and monitoring. None of those later milestones was started. No production-readiness or healthcare compliance claim is made.

## H. Final verdict

**STEP 6.1 COMPLETE**
