# Render deployment preparation

Date: 2026-10-28. Scope: preparation only; no commit, push, deployment,
cloud resource creation, migration, live PostgreSQL connection, or Gemini request.

## Verdict

**DEPLOYMENT PREPARATION BLOCKED** pending the items below. The single-service
application path and private Supabase PDF adapter are prepared locally. Actual
cloud persistence and Linux/Gunicorn execution remain unverified.

## Inspection and files changed

The working tree was clean before editing. Inspected the factory, configuration,
authentication/CSRF, database setup, PDF upload/processing/deletion, migrations,
frontend API client, Vite proxy, dependency manifests and local startup scripts.
Models, migrations, PDF validation, Gemini configuration and frontend features
were preserved.

| File | Change |
| --- | --- |
| `Dockerfile` | Multi-stage React build and one Python/Gunicorn service, non-root runtime |
| `.dockerignore` | Keep local settings, uploads, virtual environments and Git out of build context |
| `.gitignore` | Exclude backup virtual environments, PDFs and common credential files |
| `backend/requirements.txt` | Add Gunicorn; explicitly declare the existing HTTPX transport |
| `backend/gunicorn.conf.py` | Bind all interfaces and PORT; disable forwarded-header interpretation |
| `backend/app/config.py` | Render configuration and explicit local/Supabase storage settings |
| `backend/app/__init__.py` | Compiled assets, React deep links, fixed Render HTTPS scheme and storage configuration validation |
| `backend/app/auth.py` | Preserve unknown API 404 handling with the new frontend catch-all |
| `backend/.env.example` | Document production configuration names |
| `backend/tests/test_production_serving.py` | Static/API boundaries, host/TLS configuration, compiled assets and HTTPS auth tests |
| `backend/app/pdf_storage.py` | Private Supabase REST adapter, bounded temporary retrieval and remote deletion consistency |
| `backend/app/documents.py` | Route existing save/cleanup/delete operations through selected storage |
| `backend/app/document_processing.py` | Materialize remote objects for the existing parser; propagate storage failures |
| `backend/tests/test_pdf_storage.py` | Offline local/Supabase lifecycle and failure coverage |
| `docs/persistent-pdf-storage.md` | Configuration, private bucket setup, lifecycle and transaction limitations |
| `docs/render-deployment-preparation.md` | This report |

## Production build and start

Use repository root as the Docker build context and a **single Render Docker
Web Service**. No separate frontend service. The image installs frontend
dependencies with `npm ci`, runs `npm run build` (TypeScript + Vite), and copies
only compiled assets into the Python runtime. Python 3.11 and Node 24 image tags
receive patch updates; dependencies retain the project's existing version ranges.

Build command (when Docker is available):

```sh
docker build -t healthcareassist-ai .
```

Production start command (Docker CMD, working directory `/app/backend`):

```sh
gunicorn --config gunicorn.conf.py 'app:create_app()'
```

Gunicorn binds `0.0.0.0:$PORT` (default 10000), with one worker, two threads and a
120-second timeout to accommodate synchronous PDF processing. No migration runs
at startup. Use `/api/health` for health checks; it does not query PostgreSQL.
Tune memory/concurrency only after Linux PDF processing checks on the target tier.

Compiled React and `/api/*` share the same HTTPS origin. The build explicitly
sets `VITE_API_BASE_URL` empty. Missing assets return 404; extensionless UI deep
links return index.html. Existing API blueprints/error handlers retain priority;
unknown API paths never return the SPA. No CORS is enabled.

## Environment variable names

Required production settings: `RENDER_DEPLOYMENT` (true), `PUBLIC_HOST` (exact
public hostname only), `DATABASE_URL` (provider PostgreSQL URI with encrypted
`sslmode`), `SECRET_KEY`, `DEMO_USERNAME`, `DEMO_PASSWORD_HASH`,
`SESSION_COOKIE_SECURE` (true), `GEMINI_API_KEY`, `GEMINI_MODEL`,
`PDF_STORAGE_BACKEND` (supabase), `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and
`SUPABASE_STORAGE_BUCKET`. `DOCUMENT_UPLOAD_DIR` applies only to local mode.
Render supplies `PORT`.

Optional existing Gemini controls: `GEMINI_TIMEOUT_SECONDS`,
`GEMINI_MAX_OUTPUT_TOKENS`. Keep `GEMINI_MODEL=gemini-3.5-flash-lite` unless an
explicit future instruction changes it. No fallback, retry, or billing change.
Keep `FLASK_DEBUG=false`. Keys and password hashes belong only in private server
environment settings; never in VITE variables, source, Docker build arguments,
screenshots or logs. Generate unique authentication values privately using the
existing authentication documentation. No public demo credentials are supplied.

Local configuration still supports `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`,
`DB_NAME`; a nonempty `DATABASE_URL` takes precedence. Provider `postgres://` and
`postgresql://` schemes continue selecting psycopg 3. Production requires the URL
form with `sslmode=require`, `verify-ca` or `verify-full`. Prefer provider-supported
certificate verification (`verify-full`) and retain any channel-binding options
in the supplied URI. URL-encode credential characters. Do not log the URI.

## Render proxy and authentication boundary

[Render documents](https://render.com/docs/web-services) public HTTPS termination
and forwarding HTTP to a port that is not directly public. This implementation
uses that fixed deployment topology: only when `RENDER_DEPLOYMENT=true`, the
factory sets the WSGI scheme to HTTPS, and Flask validates the exact `PUBLIC_HOST`.
Neither Gunicorn nor Flask trusts X-Forwarded-Proto, X-Forwarded-Host,
X-Forwarded-For or Forwarded. No proxy-hop count or client-IP trust is assumed.
Do not enable this mode on a directly exposed HTTP server. Private-network callers
must be treated as trusted infrastructure; the scheme flag does not prove they
used TLS. Reassess this boundary if ingress topology changes.

Secure, HttpOnly, SameSite=Lax signed cookies, server-side password hashing,
credential-version checks, authentication expiry and Origin/token CSRF checks
remain in place. Tokens and hashes never enter public assets. Configure only the
canonical public hostname; alternate hostnames require a deliberate future change.

## Safe one-time migration procedure (not executed)

1. After separate authorization, select and verify the intended Neon project,
   database and role privately. Back up any existing database and record its
   revision. Use a separate staging branch/database for the rehearsal first.
2. In a private operator environment with the same backend dependencies, set
   `DATABASE_URL` to the provider's **direct** PostgreSQL connection URL with TLS.
   Keep any required provider SSL/channel-binding parameters. Use a schema-owner
   migration role; the runtime role should have only required application rights.
3. From `backend/`, run `python -m flask --app 'app:create_app()' db current`,
   inspect `db heads` and `db history`, then run `db upgrade` once. Substitute
   each subcommand after the same Flask prefix. Do not run `create_all`, regenerate
   migrations, stamp over an unknown schema, or run upgrades in every web worker.
4. Run `db current` again and verify the expected head `9d82b6f31a04`. Review
   application read/write behavior on staging before applying to the intended DB.
   Pause writes during an existing database upgrade. Investigate failures and
   restore from the verified backup if needed; avoid blind downgrade/retry.

[Neon requires encrypted connections](https://neon.com/blog/oops-proof-your-vibe-code-with-neon-because-mistakes-happen).
No local `.env` should be copied into the image or committed for this procedure.

## Persistent PDF storage: implemented offline, cloud verification pending

Local default is `backend/instance/document_uploads`; relative configured paths
resolve against backend. Validated PDFs use server-generated UUID filenames;
the database stores metadata/chunks, not the source PDF. Upload rollback,
processing retries and staged deletion depend on these private local files.
Render free-service filesystem data is not a durable source of truth. Set
`PDF_STORAGE_BACKEND=supabase` for the implemented private object adapter, with
`SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `SUPABASE_STORAGE_BUCKET` configured
privately on the server. `DOCUMENT_UPLOAD_DIR` alone is not persistent storage.

The adapter saves without overwrites, retrieves bounded PDF bytes into a private
temporary path for existing workers, and removes exact UUID object keys. Local
storage remains the default. Invalid or unavailable Supabase configuration fails
closed without falling back to disk. No schema migration or public PDF URLs.

Uploads persist objects before metadata and compensate known DB failures.
Remote deletion commits metadata/chunk removal before deleting the object; a
later storage failure returns HTTP 500 and logs the key for reconciliation.
Uncertain DB outcomes retain objects. See [persistent PDF storage](persistent-pdf-storage.md)
for lifecycle, manual private-bucket setup, existing-document transfer and
cross-system transaction limitations. No real Supabase requests were made.

## Secret and repository audit

`backend/.env`, backend instance authentication data, uploaded PDFs and common
credential files are ignored; `git check-ignore` confirmed representative paths.
Tracked paths contain only `.env.example`, no actual environment/authentication
files. A tracked-content pattern scan found no Google API keys, GitHub tokens or
private-key headers. This is a targeted audit, not proof that arbitrary secrets
cannot exist. No secret values were printed.

History path inspection found a synthetic policy PDF under prior verification
artifacts; no historical backend `.env` or instance authentication path appeared.
Deployment Fix 1 staged removal of **1,462 backup-environment files** from the
index under `backend/.venv.broken-20261023`; local copies remain intact. That
staged cleanup is preserved. Available remote/history checks identified no
actual credential exposure. No history rewrites were made.

## Verification and remaining blockers

Deployment Fix 2 verification (supersedes the earlier totals below):

- 40 new storage tests passed in both complete-suite executions. The final
  focused storage, worker-startup, production and database-configuration run
  passed all 67 tests.
- Full backend suite ran twice: each finished with **548 passed, 1 failed** and
  two existing SQLite index-reflection warnings. The first failure was the
  existing `test_duplicate_original_names_have_unique_internal_names` reporting
  the unchanged 5-second validation deadline. The second was the existing
  `test_exact_size_limit_with_multipart_allowance` returning HTTP 400. These were
  different local-mode failures; no Supabase test failed. The cause of the second
  rejection was not established by its assertion output.
- Isolated existing PDF upload/deletion suite: **89 passed**, including both
  failing cases. Isolated existing PDF-processing suite: **54 passed**. Each had
  one existing SQLite reflection warning. No deadlines or tests were weakened.
- Python compilation passed; `pip check` reported no broken requirements. The
  already installed HTTPX 0.28.1 satisfies the explicit range; no packages added.
- Frontend files/contracts were unchanged; frontend checks were not rerun.
- Credential files remained byte-identical, no local credential values matched
  publishable files, and the 1,462 staged backup removals remained the only staged
  changes. No virtual environment remains tracked. No real PostgreSQL, Supabase,
  or Gemini operation occurred.

A clean single full-suite pass remains unconfirmed on this host. Repeat the
unchanged suite on an idle host before release; do not treat isolated passes as
a clean full regression result. Persistent-storage verdict:
**PERSISTENT STORAGE IMPLEMENTED LOCALLY — CLOUD VERIFICATION PENDING**.

Earlier deployment-preparation baseline:

- Frontend: 324 tests passed; typecheck, lint and production build passed.
- Production-specific backend tests: 6 passed, including actual built JS/CSS,
  React deep links, API 404/auth behavior, secure-cookie login/logout, same-origin
  CSRF and spoofed forwarded headers.
- Full backend suite: 505 passed (503 existing tests plus the initial two new
  tests), with two existing SQLite expression-index reflection warnings. The final
  expanded production test file then passed all six tests separately. Tests
  install a guard forbidding PostgreSQL connections and use disposable SQLite.
- Final production and database-configuration regression check: 25 passed after
  forcing debug off in Render mode.
- `git diff --check` passed. No existing tests were weakened.
- Existing PowerShell startup scripts and Vite proxy are unchanged. Production
  mode defaults off; existing development configuration paths remain in place.
  Interactive local servers were not launched as part of this verification.
- Docker/Gunicorn Linux image execution is unverified because Docker is absent.
- Previous 28 PostgreSQL E2E scenarios and 177 UI layout checks were not rerun;
  live database access is outside this task.

Blockers: obtain a clean full regression pass; authorize and perform actual Supabase private-bucket/restart persistence
verification; verify the Docker image, Gunicorn startup and Linux PDF processing
in the next appropriate isolated environment. The Supabase adapter is implemented
and tested offline; it does not establish real cloud persistence by itself.
No external resources were created or modified.
