# Pre-edit verification plan

Preserve tracked/untracked files with SHA-256 snapshots. Never modify .env, use live Gemini, deploy, mutate application data, or bypass auth.

| Workflow | Environment / isolation | Expected result | Existing coverage | Missing coverage / safety |
| --- | --- | --- | --- | --- |
| Auth/session/CSRF/logout | SQLite fixtures; actual HTTP Flask/browser, ephemeral credentials | Login/rotation/cookie restoration/expiry/protected routes/private cleanup | API/component tests; mocked CDP | Actual Vite proxy Origin/cookies; no production credentials |
| Dashboard/request CRUD/search/filter/pagination | Disposable DB + real Flask/browser | Counts from fixture states, persisted edits/deletion, safe errors | SQLite API/component/mock browser | PostgreSQL persistence and actual browser mutations |
| PDF upload/process/details/delete | Synthetic PDF, temporary private storage | INDEXED/chunks/pages, cleanup | SQLite PDF/API/component tests | PostgreSQL FTS and actual multipart |
| AI retrieval/citations/no-context/errors | Real Flask + isolated PostgreSQL if established; SDK mock + network guard | Actual chunks reach bounded request; quotes/IDs/pages validated | SDK/transport mocks, SQL compilation, components | Browser through real retrieval; refuse external provider traffic |
| Failures/recovery | Existing mocks and scoped doubles | No crashes/retry loops, input preserved, recovery | API/component suites | Controlled integrated errors; never disrupt service |
| Layout/keyboard | Existing dependency-free CDP harness; 320/375/768/1024/1440 | Usable forms/navigation/dialogs, wrapped content, no overflow | 110 mocked layouts/five journeys | Re-run plus actual Flask journey; limited screenshots |
| Regression | Existing venv/node_modules | Original 503 backend/320 frontend cases retained; startup/compile/pip/type/lint/build pass | Existing commands | Retain unsuppressed warnings |

PostgreSQL gate: catalog-only, explicit read-only connection first. Names do not prove disposability. Never mutate an existing DB. If exclusive test DB and credentials cannot be safely established with clear authorization/ownership, mark PostgreSQL BLOCKED and continue SQLite/mock checks. New resources need unique project names and narrowly scoped cleanup. No dependencies or migrations added.
