# HealthCareAssist AI

HealthCareAssist AI is a portfolio healthcare-support project. This repository contains the Flask backend, PostgreSQL infrastructure, the React dashboard, support request management, the Step 4.3 Knowledge Base React interface, its Step 4.2 PDF extraction and PostgreSQL search backend, and the Step 5.1 Gemini AI Assistant backend. The project is intended for fictional documents and synthetic data only. Never upload real patient documents or protected health information.

## Frontend setup (through Step 4.3)

Use Node.js 24 LTS and npm. From the repository root:

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Open the local URL printed by Vite (normally <http://127.0.0.1:5173>).
The existing stack is React 19.3.1, TypeScript 6.0.3, Vite 8.3.5,
and Tailwind CSS 4.3.3. Tailwind runs through its Vite plugin.

Leave `VITE_API_BASE_URL` empty in `frontend/.env` for local development.
The API client requests `/api/health`, `/api/dashboard/summary`, the `/api/requests` endpoints, and the document upload/list/details/delete/search endpoints; Vite currently proxies `/api` to
`http://127.0.0.1:5053` without changing the Flask endpoint or requiring CORS.
If Flask uses another local port, update the proxy target in `vite.config.ts`.
For a separate API host, set `VITE_API_BASE_URL` to its origin without a trailing
`/api` (for example `http://127.0.0.1:5000`); that backend must permit the frontend
origin via CORS. Restart Vite after changing environment values.
`VITE_*` values are public and must never contain credentials.

In another terminal, start Flask using the existing backend environment:

```powershell
cd backend
.\.venv\Scripts\python.exe -m flask --app app run --port 5053 --no-reload
```

To verify connectivity, open the frontend and check for **Backend connected**,
service **HealthCareAssist AI**, and version **1.0.0**. The browser's Network tab
should show a successful `GET /api/health`. With Flask stopped, use **Check connection**
to see failure guidance, then restart Flask and select **Try again**.
Requests time out after 10 seconds. This endpoint checks application availability,
not database connectivity.

Run frontend verification from `frontend`:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Vitest and React Testing Library mock network calls; unit tests do not need Flask
or PostgreSQL. `npm run build` writes the production bundle to `frontend/dist`.
For production, configure the hosting server to forward `/api` to the backend,
or set `VITE_API_BASE_URL` at build time and configure CORS on that API.
The Vite development proxy does not run in a production static deployment
or under `vite preview`.

The frontend uses `src/app` for test setup, `src/components` for the connection
card and shared layout, `src/services` for typed API services, `src/features/dashboard`
for dashboard cards, states, styling, and tests, and `src/pages`
for the welcome, dashboard, request list, creation, details, and editing screens. `src/features/requests`
contains the responsive request table/cards, shared form, query/mutation hooks, loading/error states, styling, and tests. Existing
starter assets and `App.css` are retained but unused.

## React dashboard (Step 2.2)

Open <http://127.0.0.1:5173/dashboard> after starting Flask and Vite as shown
above. `/` preserves the welcome screen and backend health indicator, with an
**Open dashboard** link. The dashboard sidebar links back to **Welcome & connection**.
React Router handles both routes. A production static host must serve `index.html`
for frontend routes such as `/dashboard` so direct links and reloads work.

The light dashboard uses a deep teal accent, four request KPI cards, an overview,
and a status breakdown. The sidebar stays visible on desktop and tablet; at 720px
and below, **Open navigation** expands an inline menu. Cards use four columns on
wide screens and two on smaller screens; detail panels stack on tablet and mobile.
Navigation includes a skip link, visible keyboard focus, and the current page.
Support Requests links to `/requests`; Knowledge Base now links to
`/knowledge-base`. AI Assistant remains disabled and labeled **Coming soon**.

`src/services/dashboard.ts` calls `GET /api/dashboard/summary` using the shared
API client, its ten-second timeout, cancellation signal, and existing
`VITE_API_BASE_URL` / Vite proxy configuration. It validates all four counts as
nonnegative safe integers and checks that status counts sum to the total.
TanStack Query handles caching (60 seconds), cancellation, and explicit retry.
There is no polling, automatic error retry, or refetch on window focus/reconnection.
Reload the page for fresh metrics; a quick return from the welcome page can reuse
the cached summary.

While loading, an announced message and dashes appear. Failures show a separate
alert and **Try again**, never zero metrics or an empty state. A successful response
with zero total displays **No support requests yet.** and explains that metrics
update when requests are created. Nonzero data displays actual counts and a
proportional status breakdown. The frontend creates no requests, demo records,
or fabricated activity; backend health and database-backed metrics remain separate.

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` from
`frontend`. The existing lint command uses **Oxlint**, not ESLint; Step 2.2 adds no
lint dependency. The 34 frontend tests cover the existing welcome/health behavior,
routing, all KPI mappings, zeros, loading, failures and explicit retry, API response
validation and cancellation, and mobile menu state. Unit tests mock the network.
Run the backend regression tests using the backend interpreter as documented
below. These remain isolated from the development database.

For a live check, open `/dashboard` with PostgreSQL and Flask running and confirm
a successful `/api/dashboard/summary` response in the browser Network panel.
The `/api/health` indicator only checks backend availability. To check error/retry
behavior, stop Flask, reload the dashboard, then restart Flask and select **Try again**.
Review at desktop, tablet, and 320px mobile widths for wrapping, menu behavior,
keyboard focus, and horizontal overflow. No schema or migration change is needed.
## Support Requests frontend (Step 3.2)

Open <http://127.0.0.1:5173/requests> or select **Support Requests** in the
existing sidebar. `/`, `/dashboard`, and the mobile navigation remain available.
Production hosting must serve `index.html` for `/requests`, including direct
links and reloads. This page only lists requests; it has no creation, editing,
status mutation, deletion, authentication, AI, or document controls.

`src/services/requests.ts` uses the shared API client and validates the actual
`GET /api/requests` contract: `{ data, page, page_size, total, total_pages }`.
Records retain `id`, `title`, `description`, `category`, `status`, `created_at`,
and `updated_at` without changing API values. Only ID, title, category, status,
and dates appear in the list; descriptions are omitted. Localized dates use
semantic `time` elements with the original UTC timestamp in `datetime` and a
full local date/time tooltip. Results retain the server's
`created_at DESC, id DESC` order. Desktop uses a table with scoped headers;
at 900px and below, the same results use wrapping cards.

Search sends trimmed `q` after a **350ms debounce**, matching a case-insensitive
literal substring in title or description on the backend. Input is limited to
200 characters. **Clear search** keeps status/category filters. **Clear all
filters** in the no-match state resets all filters. Status options send `OPEN`,
`IN_PROGRESS`, or `RESOLVED`; categories send `GENERAL`, `COVERAGE`, `CLAIMS`, or
`APPOINTMENT`. All options omit the corresponding query parameter. Filters
combine with AND, and changing a filter or committing a search resets page to 1.

TanStack Query keys include every filter, page, and page size. Requests forward
its cancellation signal through the existing ten-second timeout. The shared
60-second cache and explicit retry policy apply without polling or automatic
focus/reconnection refetches. Previous rows remain visible only during pagination
of the same filtered list, accompanied by an updating announcement. Different
filters show their own loading state. Older requests are cancelled and cannot
replace the active query's results.

Pagination uses the backend default of **20 records per page**, returned totals,
and total page count. Previous/Next disable at boundaries and while updating.
Empty results display Page 1 of 1 with both controls disabled. If a later response
reports that the current page no longer exists, the page refreshes the last valid
page, including invalidating an older cached copy of that page.

The page announces initial loading and updates, distinguishes **No support
requests yet.** from **No requests match your filters.**, and displays a sanitized
error with **Try again** for network, HTTP, or invalid-response failures. Failed
requests never appear as zero records or a successful empty state.

From `frontend`, run:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
# Optional on resource-constrained machines; still runs the entire suite:
npm test -- --maxWorkers=1
```

The Step 3.2 suite has **81 frontend tests**, covering service validation and
cancellation, routing/sidebar navigation, exact field mapping and timestamps,
badges, loading/empty/error states, explicit retry, combined filters, debounce,
pagination boundaries and loading, stale-page recovery, and existing Dashboard
and Welcome behavior. All frontend tests mock HTTP and never create development
database records. The isolated backend regression suite remains **182 tests**.
For read-only live checks, request `/api/requests?page=1&page_size=20` and combine
`status`, `category`, and `q` through the Vite proxy with Flask/PostgreSQL running.
Do not run the CRUD smoke script below for frontend-only verification because
that separate script creates temporary records.

Step 3.2 verification passed typecheck, Oxlint (no warnings), all 81 frontend
tests, the production build, and all 182 backend regression tests. Headless
Chrome checks and screenshot review passed at **1440, 1024, 390, and 320px**,
including actual scrollbar-adjusted content widths, mobile navigation, long
titles, keyboard focus, empty results, combined filters, pagination loading,
network failure/retry, and Dashboard/Welcome regressions. Removing the body's
fixed 320px minimum width prevents overflow when a vertical scrollbar reduces
the available width at a 320px viewport.

Read-only live checks returned HTTP 200 for the default list, status filter,
category filter, and combined status/category/search, with identical direct and
proxied responses. The development database was empty; populated browser cases
used intercepted HTTP fixtures only, and database summary counts stayed unchanged.
Verification used isolated Flask **5053** and Vite **5175** ports because an older
process on **5000** returned 404 for `/api/requests`. The current development
proxy targets **5053**; start this checkout's backend on that port as shown above. No records,
backend source, schema, migrations, or dependencies were changed.

## Support request management (Step 3.3)

| Route | Workflow |
| --- | --- |
| `/requests` | Existing search, filters, pagination, responsive table/cards, and **New Request** action |
| `/requests/new` | Create with a title, description, and category; success opens the created request |
| `/requests/:id` | View ID, title, description, category, status, and created/updated timestamps; edit, change status, or delete |
| `/requests/:id/edit` | Edit prefilled title, description, and category; save returns to details |

Select a title in either the desktop table or mobile cards to open its details.
Forms require nonblank titles and descriptions and one of General, Coverage,
Claims, or Appointment. Surrounding text whitespace is trimmed; the title limit
is 200 Unicode characters after trimming, matching the backend's character count.
Null characters are rejected. Descriptions have no additional application length
limit. Client and server validation errors appear beside the corresponding
fields, and the first invalid field receives focus. Corrected fields clear their
previous errors. Save failures retain entered values and offer another attempt.
Submissions are guarded against duplicates and controls disable while saving.
No form dependencies were added.

Creation uses `POST /api/requests`; details use `GET /api/requests/:id`.
Editing sends only changed fields through `PATCH /api/requests/:id`; an unchanged
form returns to details without a PATCH. The status selector supports every
transition among OPEN, IN_PROGRESS, and RESOLVED. **Save status** enables only
when a different status is selected and PATCH sends only `status`. Successful
operations announce their outcome; network/server errors show sanitized guidance.
Details and editing include loading, explicit retry, and 404 states with navigation
back to the request list.

**Delete** opens a native modal dialog identifying the request ID and title and
explaining that deletion is permanent. Cancel or Escape closes it without a
write. Focus starts on Cancel, Tab/Shift+Tab stay inside the dialog, and cancellation
restores focus to the trigger. Confirming sends `DELETE /api/requests/:id`, accepts
the empty HTTP 204 response, and returns to the list with success feedback.
Confirmation controls disable during deletion. A 404 explains that the request
was already deleted; other failures retain the dialog for retry or cancellation.

TanStack Query keeps list keys under `['requests', parameters]`, individual
details under `['request', id]`, and dashboard metrics under `['dashboard', 'summary']`.
Successful create/edit/status operations cancel an older detail GET, install the
committed API record, and invalidate the affected detail, all cached list variants,
and the exact dashboard summary. Cached lists and summary refetch before mutation
completion, including inactive destinations, so returning to them displays current
data. Deletion cancels/removes only the deleted detail and refreshes cached lists
and summary. Other detail records and unrelated queries remain untouched. Counts
are never changed optimistically, and mutations are not automatically retried.

Run the full frontend checks from `frontend`:

```powershell
npm test -- --maxWorkers=1
npm run typecheck
npm run lint
npm run build
```

Run backend regression tests from the repository root:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest -q
```

Step 3.3 verification passed **130 frontend tests**, including all 81 previous
tests, **182 backend tests**, TypeScript, Oxlint with no warnings, and the production
build. Frontend unit tests mock HTTP; backend tests use isolated databases. Neither
automated suite writes to the development database.

Separate live browser verification used isolated Flask **5054** and Vite **5175**
ports, leaving existing servers and the repository's Vite proxy unchanged. Before
any writes, the server verified this checkout's imported app module, all five
request endpoints, and both configured and connected database identity:
`healthcareassist_ai` on localhost:**7498**. A uniquely labeled synthetic request
was created through the UI, found in the list, opened, edited, moved to IN_PROGRESS
and RESOLVED, and deleted through confirmation. Dashboard UI counts matched the
API after both status changes and deletion, returning to the original all-zero
totals. Only this verification's synthetic records were deleted.

Headless Chrome passed **28 layout checks** across **1440, 1024, 390, and 320px**
for creation, details, populated lists, editing, long edited titles, dashboard,
and delete confirmation. Checks covered actual scrollbar-adjusted content width,
field focus, dialog keyboard containment/Escape/focus restoration, and 404/Welcome
regressions. Screenshots were inspected; no horizontal overflow or browser runtime
exceptions occurred. Verification scripts, server identity, screenshots, and
`browser-report.json` are saved outside the repository under
`D:\HealthAssit\.verification-artifacts\requests-step-3.3`.

Step 3.3 is complete. No backend APIs, schema, migrations, authentication,
Knowledge Base, or AI Assistant implementation was added. No commit, push, or
deployment was performed.

## Backend setup

Requirements: Python 3.11 or later and Windows PowerShell.

From the repository root, create and activate a virtual environment:

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks the activation script, run the following once for the current shell and then activate it again:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Install the backend dependencies:

```powershell
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Copy `.env.example` to `backend/.env` and set `DATABASE_URL` before normal startup. The factory loads only this local file, preserves existing environment values, and reports missing database configuration clearly. `.env` is ignored by Git. The HTTP defaults remain `127.0.0.1:5000` with debug mode disabled.

## PostgreSQL configuration

Use a dedicated database named `healthcareassist_ai`. Discover the installed server's host, port, and role; do not assume the default port or credentials. The local installation inspected for Step 1.2 uses PostgreSQL 18.4 and port **7498** (other machines may differ).

Set separate connection fields in `backend/.env`; the password is literal and
does not need URL encoding. SQLAlchemy builds the URL with `URL.create()`:

```dotenv
DB_HOST=localhost
DB_PORT=7498
DB_USER=postgres
DB_PASSWORD='YOUR_LITERAL_PASSWORD'
DB_NAME=healthcareassist_ai
```

Alternatively, set `DATABASE_URL` (a nonempty value takes precedence over the
separate fields), replacing every placeholder:

```dotenv
DATABASE_URL=postgresql+psycopg://YOUR_ROLE:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:YOUR_PORT/healthcareassist_ai
```

Percent-encode special characters in the username and password. `postgresql://` and `postgres://` URLs are also accepted and normalized to the psycopg 3 driver. Keep passwords out of source files, logs, and shell command arguments. `psycopg[binary]` provides the driver and Windows runtime without a local compiler.

Before creation, connect to the maintenance database using your authorized role and inspect whether the dedicated database exists. These commands prompt for a password and require PostgreSQL's `bin` directory on `PATH`:

```powershell
psql -h YOUR_HOST -p YOUR_PORT -U YOUR_ROLE -d postgres -W -c "SELECT datname FROM pg_database WHERE datname = 'healthcareassist_ai';"
```

Only if no row is returned, create the dedicated database with a role that has `CREATEDB` permission:

```powershell
createdb -h YOUR_HOST -p YOUR_PORT -U YOUR_ROLE -W healthcareassist_ai
```

If it exists, use it as-is. Do not drop, reset, or recreate it. No database is created automatically by application startup.

From `backend`, verify an actual connection through SQLAlchemy:

```powershell
.\.venv\Scripts\python.exe -m flask --app app:create_app check-db
```

This command executes `SELECT 1`, returns a nonzero exit status on failure, and keeps connection details out of the error output. Connections use a five-second connection timeout. Application startup and `/api/health` do not open a database connection.

## Migrations

Flask-Migrate is initialized by the factory. `backend/migrations` contains the Alembic environment, bound to the application's SQLAlchemy metadata and configured URL; no credentials are stored there. Run commands from `backend`:

```powershell
.\.venv\Scripts\python.exe -m flask --app app:create_app db heads
.\.venv\Scripts\python.exe -m flask --app app:create_app db history
```

These inspect migration configuration without connecting to PostgreSQL. The migration repository is already initialized; do not re-run `db init`. Step 2.1 adds revision `3db23834e8ac`, which creates `support_requests`; Step 4.1 adds its child `7b21d4a90c6f`, which creates `documents`; Step 4.2 adds `9d82b6f31a04`, with processing status, chunks and a PostgreSQL search index. Alembic also maintains its own `alembic_version` tracking table. No demo records are inserted.

Before applying a migration, confirm both the configured database name and
`SELECT current_database()` are `healthcareassist_ai` on the intended local
server (localhost:7498 for this setup). Never point migration commands at another
project's database. Review the revision file and rendered SQL before upgrading.
From `backend`:

```powershell
# Render the initial revision without applying it.
.\.venv\Scripts\python.exe -m flask --app app:create_app db upgrade --sql 3db23834e8ac
# Apply only this reviewed revision to the confirmed database.
.\.venv\Scripts\python.exe -m flask --app app:create_app db upgrade 3db23834e8ac
.\.venv\Scripts\python.exe -m flask --app app:create_app db current
.\.venv\Scripts\python.exe -m flask --app app:create_app db check
```

Those upgrade examples target the historical Step 2.1 revision. For the current
head, follow the Step 4.2 migration instructions below; `db current` must then
report `9d82b6f31a04 (head)` and `db check` must report no new upgrade operations.
Do not generate another migration for these existing revisions or use
`db.create_all()` or `db stamp` as a substitute for applying them.

## Dashboard backend (Step 2.1)

The `SupportRequest` model maps to `support_requests`:

| Field | Database definition |
| --- | --- |
| `id` | Integer primary key, generated by PostgreSQL |
| `title` | Required, nonblank string, maximum 200 characters |
| `description` | Required text |
| `category` | Required; GENERAL (default), COVERAGE, CLAIMS, APPOINTMENT |
| `status` | Required; OPEN (default), IN_PROGRESS, RESOLVED |
| `created_at` | Required timezone-aware timestamp, defaults to current time |
| `updated_at` | Required timezone-aware timestamp, defaults to current time |

Named database CHECK constraints enforce category, status, and title limits.
Python timestamp defaults and ORM updates use timezone-aware UTC values;
PostgreSQL stores these instants in `TIMESTAMP WITH TIME ZONE` columns.
Database timestamp defaults also support inserts outside the ORM. SQLAlchemy
refreshes `updated_at` on ORM updates; direct SQL updates must explicitly set it.

Start Flask as documented below, then test the read-only endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:5000/api/dashboard/summary
```

For an empty database, HTTP 200 returns:

```json
{
  "total_requests": 0,
  "open_requests": 0,
  "in_progress_requests": 0,
  "resolved_requests": 0
}
```

Counts come from a single database aggregate query. The status counts sum to
the total; no demo values or records are generated. A database failure returns
HTTP 503 with `{"error": "Dashboard summary is temporarily unavailable. Please try again."}`
without exposing connection details. The health endpoint remains independent of
database availability. The Step 2.2 React dashboard consumes this endpoint. The
Step 3.1 CRUD routes below use the same model and database; committed changes
are reflected in the next summary API call. Step 3.3 frontend mutations refresh
the cached dashboard summary automatically. For writes made outside the frontend,
reload the dashboard to request fresh metrics.

## Support request REST API (Step 3.1)

This backend-only step reuses `support_requests` without changing its model,
schema, migration, or dashboard. No authentication is provided. Use synthetic
demonstration data only.

| Method | Endpoint | Success | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | 200 | Existing application health check |
| GET | `/api/dashboard/summary` | 200 | Existing database-backed status counts |
| POST | `/api/requests` | 201 | Create a request with status OPEN |
| GET | `/api/requests` | 200 | List, paginate, filter, and search |
| GET | `/api/requests/{id}` | 200 | Read a request |
| PATCH | `/api/requests/{id}` | 200 | Partially update a request |
| DELETE | `/api/requests/{id}` | 204 | Delete a request; empty response body |

Create with `Content-Type: application/json` and all three required fields:

```http
POST /api/requests
Content-Type: application/json

{
  "title": "Synthetic insurance coverage clarification",
  "description": "Synthetic question about sample policy coverage requirements.",
  "category": "COVERAGE"
}
```

HTTP 201 returns the created record. GET details and PATCH use the same `data`
envelope. IDs and timestamps below are illustrative:

```json
{
  "data": {
    "id": 123,
    "title": "Synthetic insurance coverage clarification",
    "description": "Synthetic question about sample policy coverage requirements.",
    "category": "COVERAGE",
    "status": "OPEN",
    "created_at": "2026-10-23T10:00:00Z",
    "updated_at": "2026-10-23T10:00:00Z"
  }
}
```

Titles and descriptions must be nonblank strings; surrounding whitespace is
trimmed. Titles have a maximum of 200 characters after trimming. Descriptions
use the existing TEXT column, which has no application-defined length limit.
Null characters are rejected in text fields. Categories are exactly `GENERAL`,
`COVERAGE`, `CLAIMS`, or `APPOINTMENT`; statuses are exactly `OPEN`, `IN_PROGRESS`,
or `RESOLVED`. Enum values are case-sensitive and are not trimmed or coerced.
POST rejects `status`, `id`, timestamps, and all unknown fields; status always
defaults to OPEN.

PATCH accepts any nonempty subset of `title`, `description`, `category`, and
`status`, validates the whole payload before applying changes, and rejects
unknown or immutable fields. For example:

```http
PATCH /api/requests/123
Content-Type: application/json

{
  "title": "Synthetic coverage follow-up",
  "category": "CLAIMS",
  "status": "IN_PROGRESS"
}
```

Any supported status can follow any other status. `created_at` stays fixed;
the model refreshes `updated_at` when stored fields change. A PATCH that repeats
existing values leaves the timestamp unchanged. API timestamps are ISO 8601 UTC
with a `Z` suffix.

List examples (URL-encode search text):

```text
GET /api/requests
GET /api/requests?page=2&page_size=10
GET /api/requests?status=OPEN&category=COVERAGE
GET /api/requests?q=sample%20policy
GET /api/requests?status=IN_PROGRESS&category=CLAIMS&q=synthetic&page=1&page_size=20
```

`page` defaults to 1 and must be an integer from 1 to 2147483647. `page_size`
defaults to 20 and must be an integer from 1 to 100; values beyond these bounds
are rejected with 400. Unknown or repeated query parameters, empty/invalid enum
filters, and malformed integers also return 400. Optional `q` is trimmed,
limited to 200 characters, and rejects null characters. A blank `q` applies no
search filter. Search matches a case-insensitive literal substring in title or
description; `%` and `_` are treated as ordinary characters. Filters combine
with AND, while search matches either text field.

Results sort by `created_at DESC, id DESC`. Count and paginated data queries run
in the database using bound ORM parameters; the API loads only the requested
page. An example response for one matching record:

```json
{
  "data": [
    {
      "id": 123,
      "title": "Synthetic coverage follow-up",
      "description": "Synthetic question about sample policy coverage requirements.",
      "category": "CLAIMS",
      "status": "IN_PROGRESS",
      "created_at": "2026-10-23T10:00:00Z",
      "updated_at": "2026-10-23T10:05:00Z"
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 1,
  "total_pages": 1
}
```

No matches return `data: []`, `total: 0`, and `total_pages: 0` with HTTP 200.
A page beyond the last page returns an empty array while retaining the matching
total and total page count.

CRUD errors use JSON. Invalid bodies (including malformed JSON or a missing JSON
content type), field values, and list parameters return HTTP 400, for example:

```json
{
  "error": "Invalid input.",
  "details": {
    "title": "Must be a nonblank string."
  }
}
```

Missing records and malformed/out-of-range IDs return HTTP 404 with
`{"error": "Support request not found."}`. Unexpected CRUD failures return
HTTP 500 with `{"error": "Support request operation failed. Please try again."}`.
Failed database operations roll back their transaction, and responses/log messages
omit SQL, credentials, exception text, and tracebacks. The existing dashboard
keeps its documented 503 response on database failures.

Run the full isolated backend suite from the repository root:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest -q
```

The Step 3.1 verification passed **182 backend tests**, including the previous 42.
CRUD tests apply the existing migration to disposable SQLite databases and cover
validation, pagination, ordering ties, all filters, literal search, timestamps,
missing IDs, rollback after flushed writes, recovery, and dashboard consistency.
They never load `backend/.env` or reset the development database. Frontend
regression verification passed **34 tests**, typecheck, lint, and production build;
no frontend source changes were made.

For opt-in live HTTP verification against the dedicated development database,
run from `backend` with PostgreSQL available:

```powershell
.\.venv\Scripts\python.exe scripts\smoke_requests.py
```

This script checks that the configured local PostgreSQL database and
`current_database()` are both `healthcareassist_ai`, starts a temporary loopback
HTTP server on an available port, and exercises CRUD, pagination, search, filters,
400/404 responses, UTC timestamps, and dashboard deltas. No separately running
Flask server is required. It creates two uniquely labeled synthetic records,
deletes only records with this run's exact generated identities, and verifies
the original dashboard counts are restored. It never drops tables, runs
migrations, or resets any database. Live Step 3.1 verification passed with zero
baseline counts and restored all four counts to zero after cleanup.

## Run the backend

With the virtual environment active and your working directory set to `backend`:

```powershell
python run.py
```

The availability endpoint is available at <http://127.0.0.1:5000/api/health> and returns:

```json
{
  "status": "healthy",
  "service": "HealthCareAssist AI",
  "version": "1.0.0"
}
```

This endpoint verifies the Flask application is available; it does not test database connectivity.

## Run backend tests

From the repository root, use the backend virtual environment explicitly:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest -v
```

Alternatively, from the `backend` directory:

```powershell
.\.venv\Scripts\python.exe -m pytest -v
```

The root `pytest.ini` limits discovery to `backend/tests` and adds this project's
`backend` directory to the test import path so `app` resolves locally. Using the
explicit interpreter avoids accidentally running tests with a global Python.

Tests use isolated configuration, SQLite, or mocked connections; they never require PostgreSQL or modify the local development database. Dashboard tests apply the real migration to disposable SQLite files under Pytest's temporary directory. They cover empty and mixed-status summaries, database constraints and defaults, UTC ORM timestamps, and sanitized database failures. Real PostgreSQL verification is performed separately with `check-db` and migration checks.

Additional checks from `backend`:

```powershell
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -c "import app, flask_sqlalchemy, flask_migrate, psycopg"
.\.venv\Scripts\python.exe -m compileall -q app tests migrations run.py
```

## Knowledge Base backend (Step 4.1)

This section records the Step 4.1 baseline. The Step 4.2 section below supersedes
its processing/search scope, metadata shape, resource limits and migration head.
This original step provides PDF upload and metadata management only. Use **fictional
documents and synthetic data only**, never real patient documents. There is no
Knowledge Base frontend, binary download endpoint, PDF text extraction, document
search, retrieval, or AI integration. Existing React code is unchanged.

| Method and route | Response |
| --- | --- |
| `POST /api/documents` | Multipart upload; `201` with `{ "data": document }` |
| `GET /api/documents` | `200` with `{ "data": [], "page": 1, "page_size": 20, "total": 0, "total_pages": 0 }` |
| `GET /api/documents/:id` | `200` with `{ "data": document }`; `404` if missing or invalid ID |
| `DELETE /api/documents/:id` | Empty `204` after deletion; `404` if missing or invalid ID |

Every returned `document` has exactly `id`, `title`, `original_filename`,
`file_size` (bytes), `content_type` (`application/pdf`), and `created_at` (UTC ISO
8601 with `Z`). Neither internal filenames, absolute paths, nor binary contents
are returned. The database additionally stores `stored_filename`, a unique
random UUID identifier ending in `.pdf`. All fields are non-null. `title` is
limited to 200 characters; `original_filename` to 255. The PostgreSQL model uses
an integer primary key and a timezone-aware `created_at` defaulting to UTC.
Database constraints enforce nonblank titles, the title limit, a positive file
size of at most 5 MiB, and unique storage identifiers.

Uploads require one `file` part and accept one optional `title` form field.
When omitted, the title defaults to the original filename stem. Titles are
trimmed and must contain 1–200 characters with no internal ASCII control
characters. Explicitly blank titles are rejected. Unknown/duplicate fields,
extra files, missing/empty files, path-bearing filenames (POSIX or Windows),
drive/alternate-stream names, and control characters in filenames are rejected.
Original filenames are metadata only and never determine a storage path.
Duplicate original filenames are allowed and produce distinct storage names.

The file limit is **5 MiB (5,242,880 bytes)**, including any trailing bytes.
The multipart request limit is 5 MiB + 64 KiB, allowing normal headers/title
overhead; multipart decoding is also bounded to four parts and a 128 KiB
form/buffer memory limit. File size is measured from actual bounded reads rather
than trusting client length headers. These request limits apply only to uploads
and do not change support-request endpoint behavior.

Validation checks the case-insensitive `.pdf` extension, a PDF 1.0–1.7 or 2.0
header, terminal EOF marker, and basic catalog/page-tree structure using
[`pypdf` strict mode](https://pypdf.readthedocs.io/en/stable/user/robustness.html).
Encrypted and zero-page documents are rejected. Client MIME headers are advisory;
the stored content type is assigned only after validation. Validation runs in a
short-lived subprocess with a five-second timeout, discarded parser diagnostics,
and no shell. It does not extract page text, decompress page content for
extraction, or execute document scripts. This is **not malware scanning or
sanitization** and does not prove a PDF safe. Some viewer-tolerated malformed PDFs
will be rejected. The subprocess has no OS memory quota or full security sandbox;
hostile parser inputs and concurrent uploads can still consume resources.

Invalid input returns JSON `400` with
`{ "error": "Invalid input.", "details": { "field": "message" } }`.
Oversized files/requests or multipart parser limits return JSON `413`. Other
storage/database errors return a generic JSON `500`. Logs omit document content,
raw parser diagnostics, exception details, SQL parameters, and credentials.

Listing defaults to `page=1&page_size=20`, accepts positive integer pages and page
sizes of 1–100, and sorts by `created_at DESC, id DESC`. Duplicate or unknown query
parameters are rejected with `400`. Empty and out-of-range pages return an empty
`data` array with correct totals; empty collections have `total_pages=0`.

### Private upload configuration

`DOCUMENT_UPLOAD_DIR` defaults to `backend/instance/document_uploads`, outside
frontend assets and Flask static files. Relative values resolve against
`backend/`, independently of the shell's working directory. Example in
`backend/.env` (restart Flask after changing it):

```dotenv
DOCUMENT_UPLOAD_DIR=instance/document_uploads
```

The directory is created lazily on the first valid upload and ignored by Git.
Custom locations must also be ignored/backed up appropriately. Existing files
are not moved when configuration changes: migrate storage manually before
changing the setting. The application rejects storage under the frontend tree
or Flask static directory. No upload URL/static route is registered. Keep this
directory private to the application OS account; Windows ACLs are inherited
from its parent. Generated filenames and exclusive creation prevent overwrites.
Deletion validates stored identifiers, rejects symlinks/nonregular files and
resolved paths outside storage, and never uses a client-provided filesystem path.
Storage assumes a trusted application-owned directory without hostile local
filesystem writers; these checks are not a defense against privileged local races.

Example requests from PowerShell, with fictional PDF content only:

```powershell
curl.exe -X POST http://127.0.0.1:5053/api/documents -F "file=@fictional-policy.pdf;type=application/pdf" -F "title=Fictional policy"
curl.exe "http://127.0.0.1:5053/api/documents?page=1&page_size=20"
curl.exe http://127.0.0.1:5053/api/documents/1
curl.exe -X DELETE http://127.0.0.1:5053/api/documents/1
```

### Document migration

The single additive revision `7b21d4a90c6f` follows `3db23834e8ac` and creates
only `documents`; it never modifies support-request rows. Before applying,
verify the configured URL and `SELECT current_database()` identify
`healthcareassist_ai` on the intended local PostgreSQL server (this setup:
localhost:7498), inspect the existing revision and support-request data, and
review both the migration source and generated SQL. From `backend`:

```powershell
.\.venv\Scripts\python.exe -m flask --app app db current
.\.venv\Scripts\python.exe -m flask --app app db heads
.\.venv\Scripts\python.exe -m flask --app app db upgrade --sql 3db23834e8ac:7b21d4a90c6f
# Only after confirming identity and reviewing SQL:
.\.venv\Scripts\python.exe -m flask --app app db upgrade 7b21d4a90c6f
.\.venv\Scripts\python.exe -m flask --app app db current
.\.venv\Scripts\python.exe -m flask --app app db check
```

Do not reset/recreate the database or stamp a revision. Existing installations
already at `7b21d4a90c6f` need no upgrade. A fresh dedicated database requires both
additive revisions. Verify the resulting `documents` table and unchanged support
requests after applying. Downgrade drops document metadata; it is destructive
and does not remove files, so it is not a cleanup procedure.

### Failure handling and crash recovery

An upload writes only a newly allocated file. Failed writes and known database
rollbacks remove only that file, preserving existing documents. Metadata is
serialized before commit to avoid deleting a committed file after a failed
post-commit metadata refresh. If a COMMIT acknowledgement is lost, the handler
checks the row before cleanup; when the commit outcome cannot be verified, it
keeps the file and logs a reconciliation message instead of risking data loss.

Deletion locks the PostgreSQL row, moves the file into a newly created private
`.delete-<id>-<random>` subdirectory on the same filesystem, then commits the row
deletion. A known database failure restores the file; a missing file allows stale
metadata deletion. A lost commit acknowledgement is checked before restoring.
After a successful commit the staged file and directory are purged. If final
purge fails, the API still returns `204` because deletion is committed, and logs
that the isolated staged copy needs manual removal. If restoration or rollback
cleanup itself fails, the remaining bytes are retained and reconciliation is
logged. These exceptional paths can leave private orphan/staged files.

PostgreSQL and the filesystem **do not share an atomic transaction**. A process
crash between write/rename, commit, and purge, an unavailable database during an
ambiguous commit, or a persistent filesystem failure requires manual recovery.
With application writes stopped, inspect exact document IDs and
`stored_filename` values: restore a staged file only when the matching metadata
still exists and its original destination is absent; purge a staged copy only
after confirming its matching metadata is gone. For root-level UUID orphans,
confirm no metadata references that exact identifier before removal. Preserve
backups and never bulk-delete storage based only on age, a prefix, or an error.
There is no automatic recovery job, authentication, rate limiting, malware
scanning, encryption-at-rest feature, or production access-control deployment.
Keep the service local and use synthetic documents only.

### Step 4.1 verification

From the repository root, the automated suite uses generated blank fictional
PDFs, isolated SQLite databases upgraded through Alembic, and temporary upload
directories. It never writes test PDFs to development storage:

```powershell
.\backend\.venv\Scripts\python.exe -m compileall -q backend/app backend/tests backend/migrations backend/scripts backend/run.py
.\backend\.venv\Scripts\python.exe -c "import sys; sys.path.insert(0, 'backend'); import app, pypdf, psycopg"
.\backend\.venv\Scripts\python.exe -m pytest -q
cd frontend
npm test -- --maxWorkers=1
npm run typecheck
npm run lint
npm run build
```

The opt-in live check **does** temporarily create fictional records/files in the
dedicated development database/storage. From `backend`, after migration:

```powershell
.\.venv\Scripts\python.exe scripts/smoke_documents.py
```

It refuses other database identities/ports, starts a fresh Flask server on an
ephemeral loopback port, exercises upload/list/pagination/details/deletion and
400/404 responses, and checks duplicate original filenames and unique storage
identifiers. Cleanup uses only this run's exact unique title/filename identities,
including recovery after a lost POST response. It compares complete baseline row
fingerprints and file hashes afterward and verifies dashboard counts remain
unchanged. Do not run it alongside other database/storage writers. Smoke records
are deleted, but PostgreSQL sequence values may advance normally.

Verified on 23 October 2026: **271 backend tests passed** (182 existing plus 89
document tests), **130 frontend tests passed**, Python syntax/imports and
dependency checks passed, and TypeScript, Oxlint, and the frontend production
build passed. Revision `7b21d4a90c6f` was applied only to the verified local
`healthcareassist_ai` database; `db check` reported no new upgrade operations.
Live fictional PDF upload/list/pagination/details/delete and 400/404 checks
passed. Exact cleanup restored zero document rows and zero stored files; the
support-request row fingerprint and dashboard counts remained unchanged.

## PDF extraction and PostgreSQL search (Step 4.2)

This is the current Knowledge Base backend. Use **fictional healthcare policies
and synthetic documents only**. It extracts selectable text using
`PyMuPDF>=1.27.2,<2` (verified with 1.28.2), retaining the existing `pypdf` structural
validation and private file-storage safeguards. No React code, chat endpoint,
LLM, embeddings, semantic/vector retrieval, OCR, external queue, background
worker service, or authentication was added.

### Upload processing and outcomes

`POST /api/documents` still accepts multipart `file` plus optional `title` and
returns `201` with `{ "data": document }`. Processing runs synchronously inside
the upload transaction after the stored PDF is written. Safe document metadata
now has **seven** fields: `id`, `title`, `original_filename`, `file_size`,
`content_type`, `created_at`, and the new `processing_status`. List and details
use the same metadata shape; they do not return chunks or complete extracted text.

| `processing_status` | Meaning |
| --- | --- |
| `UNPROCESSED` | Existing document awaiting explicit processing; not searchable |
| `INDEXED` | Complete extraction and chunk persistence committed; searchable |
| `NO_TEXT` | Valid PDF with no selectable text; manageable but not searchable |
| `FAILED` | Unreadable PDF, extraction/resource limit, or processing failure; manageable but not searchable |

Blank/image-only documents return `201` with `NO_TEXT` and zero chunks. Scanned
PDFs require OCR, which is outside this milestone. Encrypted/malformed uploads
continue to be rejected by upload validation with `400`; if an already stored
document is unreadable/encrypted, or extraction otherwise fails, processing marks
it `FAILED` with no partial searchable index. A failed PDF is retained for normal
details/deletion and explicit processing retry. Nothing fabricates text.

The migration leaves existing document files and metadata values untouched and
sets their new status to `UNPROCESSED`; it does not automatically process them.
To process an existing or failed fictional document, run from `backend`:

```powershell
.\.venv\Scripts\python.exe -m flask --app app process-document 123
```

The command locks the document row and commits status/chunks together. Repeating
processing for `INDEXED` or `NO_TEXT` documents is a no-op that preserves chunk
IDs. Failed/unprocessed documents can retry; any old incomplete chunks are
replaced in the same transaction. There is no public processing endpoint, forced
reindex operation, polling status workflow, or background job. After an uncertain
commit outcome, inspect the document status before retrying.
Processing retries refer to the same document ID; uploading the same PDF again
still creates a separate document, preserving Step 4.1 duplicate-filename behavior.

### Extraction, chunking and limits

The reusable `extract_chunks()` service opens the stored PDF through PyMuPDF in
a short-lived synchronous subprocess. It uses `page.get_text("text", sort=True)`
page by page, replaces null/low ASCII controls with spaces, collapses repeated
whitespace, and trims it. It never runs embedded actions or requests OCR.

Chunks stay within one page, have at most **1,200 characters**, and use up to
**150 characters of overlap**, adjusted to word boundaries when available.
Ordering is deterministic: ascending one-based PDF page numbers and a zero-based
`chunk_index` across the whole document. Blank pages create no chunks while later
pages retain their original page numbers for citations. This simple character
strategy uses no tokenizer and does not reconstruct tables or infer semantics.

Hard processing limits are:

- Existing file maximum: **5 MiB** (5,242,880 bytes).
- Maximum **100 pages**.
- Maximum **100,000 raw extracted characters per page**, **1,000,000 per document**.
- Maximum **2,000 chunks** and **16 MiB** of parser-result JSON.
- Extraction subprocess: **10 seconds wall time**, **8 seconds CPU time**, and
  **512 MiB** per-process memory allocation limit. Validation keeps its existing
  five-second wall timeout and now also uses the hard CPU/memory limits.

Windows uses a Job Object limiting committed process memory, CPU time, and child
process creation; POSIX uses address-space/CPU resource limits. If limits cannot
be installed, processing fails closed. Parser stdout is used only for bounded
JSON through a private temporary file; diagnostic stderr is discarded. The
temporary file is closed/deleted after the call. Extracted text and raw parser
exceptions are never logged. Resource caps apply per parser process; aggregate
request concurrency still depends on the WSGI server's configured worker/thread
limits. These controls are not a complete security sandbox or malware scan.

### DocumentChunk model and persistence

`document_chunks` stores only:

| Field | Contract |
| --- | --- |
| `id` | Integer primary key |
| `document_id` | Required FK to `documents.id`, `ON DELETE CASCADE` |
| `page_number` | Required positive integer; one-based PDF page reference |
| `chunk_index` | Required nonnegative integer; unique ordering within document |
| `content` | Required nonblank extracted text, at most 1,200 characters |
| `created_at` | Required timezone-aware UTC timestamp |

`UNIQUE(document_id, chunk_index)` prevents duplicate positions and supplies a
B-tree index whose document-ID prefix supports cascade/deletion lookups.
SQLAlchemy also cascades document deletion to its chunks for isolated SQLite
tests. PostgreSQL enforces the actual foreign key, check constraints, and cascade.

Extraction finishes completely before any chunks are persisted. Metadata, chunks,
and final status commit together; database failure rolls them back and invokes
the existing new-file cleanup strategy. Search joins only `INDEXED` documents,
so unprocessed, failed, or no-text documents cannot leak incomplete indexes into
results. Document deletion retains the Step 4.1 row lock/staged-file/rollback
strategy while removing chunks in the same database transaction. Failed deletion
restores the file and retains metadata/chunks; successful deletion removes search
visibility immediately. Existing filesystem/database crash-recovery limitations
and manual reconciliation procedures still apply.

### Search API and ranking

```http
GET /api/documents/search?q=annual%20coverage&limit=10
```

Parameters:

- `q`: required trimmed query, **1–200 characters**, without internal ASCII
  control characters; missing/blank/overlong input returns JSON `400`.
- `limit`: optional integer, default **10**, range **1–20**; invalid values,
  duplicate parameters and unknown parameters return JSON `400`.

Successful responses return `200` with `{ "query": trimmedQuery, "results": [...] }`.
Every result contains exactly `document_id`, `document_title`, `chunk_id`,
`page_number`, `text` (one bounded matching chunk), and numeric `score`.
Illustrative contract example, with synthetic values:

```json
{
  "query": "annual coverage",
  "results": [
    {
      "document_id": 1,
      "document_title": "Fictional Healthcare Policy",
      "chunk_id": 5,
      "page_number": 2,
      "text": "Fictional annual coverage includes an illustrative checkup benefit.",
      "score": 0.08
    }
  ]
}
```

No matches, punctuation-only input, or queries reduced entirely to English stop
words return `results: []`. Responses contain no stored filenames, filesystem
paths, binary PDF data, or AI-generated answers. Search failures use the existing
sanitized JSON `500` response.

The implementation uses PostgreSQL `to_tsvector('english'::regconfig, content)`,
`plainto_tsquery('english'::regconfig, :query)`, the `@@` match operator, and
`ts_rank_cd(..., 32)`. Queries are parameter-bound through SQLAlchemy. The text
configuration is a fixed server-controlled SQL expression shared by the query
and GIN expression index `ix_document_chunks_search`; no untrusted SQL is built.
The index updates transactionally when chunks change, with no stored vector
column or external index service.

Multiple non-stopword terms combine with AND inside a chunk; PostgreSQL English
stemming and punctuation rules apply. Input is treated as plain text, not SQL,
tsquery operators, or a quoted-phrase language. Ranking uses PostgreSQL cover
density with normalization 32; higher scores sort first. Ties sort by document ID
ascending, chunk index ascending, then chunk ID ascending. Scores are relevance
values, not answer confidence. Overlapping chunks can produce similar passages;
there is no semantic matching, synonym inference, cross-page matching, or
document-level deduplication. See PostgreSQL's
[query/ranking controls](https://www.postgresql.org/docs/current/textsearch-controls.html)
and [GIN index guidance](https://www.postgresql.org/docs/current/textsearch-indexes.html).

### Step 4.2 migration

Revision **`9d82b6f31a04`**, parent **`7b21d4a90c6f`**, adds the processing-status
column/constraint, the chunk table/constraints, and the PostgreSQL GIN expression
index. It does not alter support requests, rewrite document fields, extract
existing PDFs, reset sequences or recreate a database.

Before applying, verify the configured URL and `SELECT current_database()` identify
`healthcareassist_ai` on the intended local PostgreSQL server (this setup:
localhost:7498), confirm the current revision, snapshot existing records/files,
and review the revision source and rendered SQL. From `backend`:

```powershell
.\.venv\Scripts\python.exe -m flask --app app db current
.\.venv\Scripts\python.exe -m flask --app app db heads
.\.venv\Scripts\python.exe -m flask --app app db upgrade --sql 7b21d4a90c6f:9d82b6f31a04
# Only against the confirmed database after review:
.\.venv\Scripts\python.exe -m flask --app app db upgrade 9d82b6f31a04
.\.venv\Scripts\python.exe -m flask --app app db current
.\.venv\Scripts\python.exe -m flask --app app db check
```

The expected head is `9d82b6f31a04`, with no new upgrade operations detected.
Verify the FK cascade, timezone-aware chunk timestamp and GIN expression on real
PostgreSQL. SQLite supports isolated metadata/persistence tests but cannot run
PostgreSQL ranking or reflect its expression index. Downgrade removes extracted
chunks/status and is destructive; it is not a cleanup or retry procedure.

### Step 4.2 tests and live checks

From the repository root:

```powershell
.\backend\.venv\Scripts\python.exe -m compileall -q backend/app backend/tests backend/migrations backend/scripts backend/run.py
.\backend\.venv\Scripts\python.exe -m pytest -q
cd frontend
npm test -- --maxWorkers=1
npm run typecheck
npm run lint
npm run build
```

Automated tests use generated synthetic PDFs, temporary uploads, isolated SQLite
databases and subprocesses. SQL compilation tests inspect parameterized PostgreSQL
ranking and ordering; API mapping tests isolate database-specific execution. No
SQLite search approximation is substituted for PostgreSQL. Tests cover extraction,
citations, deterministic chunks, image-only/encrypted/malformed documents, resource
limits, persistence, idempotency, failure recovery, query validation and cascades.

Opt-in live checks from `backend`, after the migration:

```powershell
.\.venv\Scripts\python.exe scripts/smoke_document_search.py
.\.venv\Scripts\python.exe scripts/smoke_documents.py
```

These checks temporarily create fictional documents in the dedicated database
and effective development storage. Do not run alongside other writers. The
search check verifies actual extraction, chunk storage, citation pages, multi-term
search, ranking/ties, limits, nonindexed/deleted exclusion, unrelated/stopword
queries, parameterized injection-like input, idempotent retries and GIN usability
via `EXPLAIN`. Cleanup targets only exact identities created by that run and
compares all baseline document/chunk/support rows and file hashes afterward.
No unrelated records/files are removed; sequence values can advance normally.

Verified on **23 October 2026**: **325 backend tests passed** (271 baseline plus
54 new), with two expected SQLite expression-index reflection warnings. Actual
PostgreSQL schema parity and GIN checks passed separately. All **130 frontend
tests**, TypeScript, Oxlint, production build, Python syntax/imports and dependency
checks passed. Both live scripts passed and restored **zero documents, zero
chunks and zero stored files**; support-request fingerprints and dashboard counts
were unchanged. No commit, push, deployment, frontend implementation or AI
integration was performed. Step 4.2 ends here.

## Knowledge Base frontend (Step 4.3)

Open **`/knowledge-base`** or select **Knowledge Base** in the existing sidebar.
Document details are available at **`/knowledge-base/:id`**. Both routes use the
existing AppLayout, deep-teal theme, breadcrumbs, skip link and mobile navigation.
Dashboard and Support Requests remain available; AI Assistant stays **Coming soon**.
Production hosting must serve `index.html` for these frontend routes on direct
navigation and reload, and forward `/api` to Flask.

### Local development

Use the existing PostgreSQL database at migration head `9d82b6f31a04` and install
the documented backend dependencies. This frontend milestone adds no schema,
migration, Flask business logic, dependency or environment-setting change.
Restart Flask from this checkout so it imports the current document routes:

```powershell
# Terminal 1, from the repository root:
cd backend
.\.venv\Scripts\python.exe -m flask --app app run --host 127.0.0.1 --port 5053 --no-reload

# Terminal 2, from the repository root:
cd frontend
npm run dev
```

Open Vite's printed URL followed by `/knowledge-base`. Leave
`VITE_API_BASE_URL` empty to use the existing proxy to `127.0.0.1:5053`.
For a separate backend origin, use the existing public `VITE_API_BASE_URL`
configuration and configure the backend's CORS separately. The checked-in Vite
proxy was not changed. The health endpoint alone does not prove document routes
or database connectivity; confirm `GET /api/documents` also returns `200`.

### Library, upload and processing outcomes

The library displays server-ordered PDF titles, original filenames, file sizes,
localized upload dates (with original UTC timestamps in `time` elements),
processing badges, details links and deletion actions. Desktop uses a table;
mobile uses cards. Pagination is server-side with **20 documents per page**,
newest first. Empty results display **No documents yet** and disabled pagination.
If deletion removes the last record on a page, the page recovers to the last
available page and refreshes its data.

Choose one PDF and optionally enter a title, then select **Upload PDF**. Blank
titles are omitted so the backend uses the filename stem. The form checks the
PDF extension, MIME hint, nonzero file size and **5 MiB (5,242,880 byte)** limit,
plus a title limit of 200 Unicode characters. Empty/unspecified MIME hints and
generic binary MIME are permitted with a `.pdf` extension; the backend remains
authoritative for actual contents and structure.

Uploads use native `FormData` with a browser-generated multipart boundary.
The shared API client keeps its existing JSON behavior and ten-second timeout
for other requests, with a **30-second upload timeout** to allow the backend's
synchronous validation/extraction. While uploading, controls are disabled and a
synchronous guard prevents duplicate submissions. There is **no automatic POST
retry**. An uncertain response asks the user to inspect the refreshed list before
trying again, because a lost response can follow a successful database commit.
Known validation/size errors receive safe field guidance without server paths or
raw error text. Successful uploads clear the file/title fields, refresh document
collections and announce the actual processing outcome:

| Backend value | UI label | Meaning |
| --- | --- | --- |
| `UNPROCESSED` | Not processed | Existing PDF is not indexed for search |
| `INDEXED` | Searchable | Selectable text is indexed |
| `NO_TEXT` | No selectable text | Blank/image-only PDF has no searchable text |
| `FAILED` | Processing failed | Extraction failed/exceeded a limit; metadata/deletion still work |

Details display exactly the safe metadata returned by the backend: ID, title,
original filename, byte size, `application/pdf` content type, UTC upload timestamp
rendered locally, and processing outcome. There is no embedded PDF reader,
download button, public reprocessing API, or fabricated extraction status.
Scanned PDFs require OCR, which is outside this project milestone. The existing
backend's encryption, structural-validation, page/text/resource limits and
fictional/synthetic-document restrictions still apply.

### Content search

**Search PDF content** searches extracted passages, rather than filtering the
library by title. Nonblank input is debounced by **350 ms**. The frontend uses
the actual `q` and `limit` parameters, validates at most 200 characters without
internal ASCII controls, and lets users choose **5, 10 or 20 passages** (default
10). Empty input returns to library browsing without issuing an empty search.
**All documents** clears content search and returns to the full library.

Search displays actual passage text as plain React text, the document title,
original PDF page number, and a link to document details. It preserves the
backend's relevance order; no confidence percentage or AI answer is invented.
Only `INDEXED` documents can match. Multiple terms must match within a chunk,
using PostgreSQL English stemming/stopword rules. Empty/no-match, loading,
debouncing, overlong-query and failure states are distinct; failures have an
explicit retry. Previous passages disappear while a different query is being
prepared, and requests forward cancellation signals. There is no semantic,
conversational, vector or OCR search.

### Deletion and cache behavior

Select **Delete** in the library or **Delete document** on details to open a
native modal identifying the document ID/title. It explains that deletion removes
the stored PDF and indexed text. **Cancel** receives initial focus; keyboard focus
stays inside the dialog, Escape dismisses before submission, and cancellation
restores the trigger's focus. Deletion requires explicit confirmation. Pending
deletion disables controls, blocks duplicate submissions and keeps the dialog
open. Errors remain in the dialog for manual retry or cancellation. A `404`
explains that the document was already deleted and offers a safe way to close.
Success announces deletion, refreshes the library, and navigates safely from
details back to `/knowledge-base`.

TanStack Query uses stable keys under `['documents', 'list', parameters]`,
`['documents', 'search', { q, limit }]`, and `['documents', 'detail', id]`.
Mutations cancel older document requests, reset cached lists/searches, and update
or remove affected details. Resetting also clears stale inactive passages, so a
deleted excerpt cannot reappear after navigation or a failed refetch. Dashboard
and request caches are not invalidated. Existing 60-second caching and disabled
automatic query retries/focus/reconnection refetches apply; mutations explicitly
disable automatic retry. No polling or background loop is added.

### Exact backend contracts used

| Endpoint | Contract |
| --- | --- |
| `GET /api/documents?page=1&page_size=20` | `{ data, page, page_size, total, total_pages }`, including empty/out-of-range pages |
| `POST /api/documents` | Multipart `file` plus optional `title`; `201` with `{ data: document }` |
| `GET /api/documents/:id` | `{ data: document }`, or JSON `404` |
| `DELETE /api/documents/:id` | Empty `204`, or JSON `404`/sanitized failure |
| `GET /api/documents/search?q=coverage&limit=10` | `{ query, results }`; each result has `document_id`, `document_title`, `chunk_id`, `page_number`, `text`, `score` |

`document` has exactly `id`, `title`, `original_filename`, `file_size`,
`content_type`, `created_at`, `processing_status`. The typed service validates
response envelopes, pagination consistency, timestamps, statuses and passage
bounds; it projects safe fields and drops unexpected storage fields. Invalid
responses produce error states rather than fabricated data. Raw server errors
and untrusted validation messages are replaced with safe user-facing guidance.

### Verification

```powershell
# From frontend:
npm test -- --maxWorkers=1
npm run typecheck
npm run lint
npm run build

# From the repository root:
.\backend\.venv\Scripts\python.exe -m pytest -q
```

Verified on **23 October 2026**: **200 frontend tests passed** (130 baseline plus
70 new) and **325 backend tests passed**. The backend emitted its two expected
SQLite warnings about reflecting the PostgreSQL expression index. TypeScript,
Oxlint (no warnings) and the production build passed. All frontend unit tests
mock APIs and never write development documents.

The built-in browser runtime failed to initialize; an isolated headless Chrome
audit verified the real Flask checkout on **5056** with a temporary Vite proxy on
**5176**, leaving the checked-in proxy unchanged. It uploaded a generated fictional
two-page policy, confirmed its searchable outcome and list entry, searched its
unique text, verified its title and **Page 2** citation, opened details, cancelled
and then confirmed deletion, and verified the passage disappeared. It also
checked invalid file selection, safe error/retry handling, a missing document,
keyboard focus and mobile navigation. **32 layout checks** across **1440, 1024,
390 and 320px** passed with no horizontal overflow or application exceptions.
Screenshots were reviewed; sampled help, filename, badge and placeholder contrast
met 4.5:1. Exact cleanup restored **zero documents, chunks and stored files**;
support-request fingerprints, migration head and backend source hashes remained
unchanged. Temporary servers/browser were stopped after verification.

Step 4.3 is complete. No Flask business logic, database schema, authentication,
AI Assistant, OCR, embeddings or dependency was added; nothing was committed,
pushed or deployed.

## Gemini AI Assistant backend (Step 5.1)

This is a demonstration using fictional healthcare policies, **not a clinical
decision-support application**. It must not be used for medical diagnoses or
treatment recommendations. Step 5.1 adds only `POST /api/ai/ask`; the React AI chat
interface remains out of scope. There are no schema migrations, new tables,
authentication changes, conversation storage, embeddings, or vector services.

### Gemini setup and free-tier checks

Install backend requirements with the existing virtual environment:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

The official [Google Gen AI Python SDK](https://googleapis.github.io/python-genai/)
is pinned to **google-genai 2.33.0**. Obtain a key from the official
[Google AI Studio API key page](https://aistudio.google.com/apikey). Keep it only
in the ignored `backend/.env` or a private backend process environment; never
place it in frontend code, `VITE_*` settings, request bodies, or logs.
Existing process environment values take precedence over `.env`.

```dotenv
GEMINI_API_KEY=YOUR_PRIVATE_GEMINI_API_KEY
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_TIMEOUT_SECONDS=20
GEMINI_MAX_OUTPUT_TOKENS=1024
```

The checked-in `.env.example` intentionally leaves the key empty. Timeout must
be an integer from 1 to 60 seconds; output tokens must be 128 to 2048. Invalid
settings produce a sanitized configuration error when generation is needed;
other APIs and no-results answers remain usable. SDK initialization is lazy.

Before **any live generation**, check the selected project's **Free** tier and
the selected model's available quota in AI Studio. Google's
[pricing page](https://ai.google.dev/gemini-api/docs/pricing) lists free input and
output for `gemini-3.5-flash-lite` as checked on **2026-10-23**. This public listing
does not establish a particular project's tier or quota. Review its
[active rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) in AI Studio;
model metadata alone does not establish free-tier eligibility. Do not enable
billing or upgrade the project. If access is unavailable, report that blocker.
The service uses exactly the configured model with no automatic fallback or
plan changes. A billing-enabled project may charge even for a model that also
offers a free tier; the API key does not communicate billing status to this app.

### Endpoint contract

Send `Content-Type: application/json`:

```http
POST /api/ai/ask

{"question":"What claim documents are required?"}
```

The body must contain only `question`, a nonblank string of at most 1000
characters before trimming. Invalid JSON, duplicate fields, unsupported fields
(including API keys), invalid control characters, and invalid Unicode are
rejected. The request body is limited to 16 KiB. Newlines and tabs in questions
are accepted. No conversation history is stored or accepted.

Success is a top-level JSON object (no `data` wrapper). This example is
illustrative; runtime titles, IDs and page numbers always come from retrieval:

```json
{
  "answer": "The uploaded fictional policies state:\n\n\"Claim documents required: a completed claim form and itemized receipt.\" [1]",
  "sources": [
    {
      "document_id": 1,
      "document_title": "Fictional Claims Policy",
      "page_number": 2,
      "chunk_id": 5
    }
  ],
  "grounded": true
}
```

With no matching passages, or when Gemini reports insufficient support, HTTP
200 contains:

```json
{
  "answer": "I couldn't find this information in the uploaded documents.",
  "sources": [],
  "grounded": false
}
```

No retrieval results means no Gemini initialization or generation, even when
the API key is missing. A database failure is an error, never an empty result.

### Retrieval, prompts, and citation meaning

The validated question goes to the existing PostgreSQL `execute_search` service
with a limit of **five**. Its English `plainto_tsquery`, ranking, parameter binding,
and `INDEXED` processing-status filter remain unchanged. Only chunks of indexed
documents participate. The existing public document search endpoint retains its
200-character limit; the AI service calls the internal query directly with its
own 1000-character limit. There is no query rewriting or SQLite search fallback.
Lexical search uses AND semantics for non-stopword terms: paraphrases, unrelated
extra words, or vocabulary absent from a document can yield no matches even when
the information exists. An empty result is not proof that every document lacks
the answer.

At most five existing 1200-character chunks plus their metadata are sent to
Gemini. The system instruction requires fictional-policy-only answers and
abstention for unsupported or clinical requests. The question, titles and text
are JSON-encoded as untrusted data in a separate user content payload. Embedded
commands and role changes must be ignored. No external search or tools are
enabled; automatic function calling is disabled.

For conservative grounded generation, Gemini returns structured JSON containing
`supported` and selected verbatim excerpts with chunk IDs. The server checks
the shape, matches every ID against retrieved records, and checks each quote
against the corresponding chunk. It returns only validated excerpts, with a
server-written introduction and numbered references. Arbitrary generated prose,
invented source IDs, wrong-chunk quotations and unsupported additions cannot
be passed through as answers. Any mismatching excerpt discards the entire answer
and returns the insufficient-information response. At most five excerpts totaling
2400 characters are accepted. Duplicate source chunks are cited once; reference
numbers are built from their first appearance in the answer, and all document
titles, IDs and page numbers come from database records.

**`grounded: true` means quote provenance was validated, not that every statement
was independently verified.** The model still chooses relevance, boundaries and
whether to abstain. Verbatim text can be misleading, incomplete, malicious, or
incorrect. Prompt isolation and exact matching reduce risk but cannot guarantee
resistance to every prompt injection or clinical request. Inspect the original
fictional policy and surrounding qualifications; do not use this for clinical
decisions. Any future UI must render answers and source titles as untrusted text,
not executable HTML.

### Errors, limits, and privacy

Validation returns `{"error":"Invalid input.","details":{"question":"..."}}`
(or a `body` detail). Provider errors return a server-owned `error` plus a stable
`code`; neither provider exception text nor credentials are returned or logged.

| HTTP | Condition / code |
| --- | --- |
| 400 | Invalid question, JSON, or unsupported fields |
| 413 | Request exceeds 16 KiB |
| 429 | `ai_rate_limited`: provider rate limit or quota exhausted |
| 500 | Database/retrieval or unexpected application failure |
| 502 | `ai_empty_response`, `ai_invalid_response`, or `ai_provider_error` |
| 503 | `ai_not_configured`, `ai_configuration_error`, `ai_credentials_rejected`, `ai_model_unavailable`, or `ai_unavailable` |
| 504 | `ai_timeout` |

There is one provider attempt and no automatic retry. On 429, wait and review
the project's quota; do not retry rapidly or switch to a paid model. A timeout
does not guarantee the provider did not process the request. Free-tier quotas
and availability can change; no fixed requests-per-minute allowance is assumed.
Output limits apply to provider tokens as well as the final validated excerpts.
Truncated responses are rejected instead of presented as complete answers.

The service sends the question and retrieved passages (including titles and
source metadata) to Google. Google lists free-tier content as usable to improve
its products; review the current [Gemini API terms](https://ai.google.dev/gemini-api/terms)
before use. Use generated fictional policies only: no patient information,
personal health records, or confidential documents. The application does not
persist chat messages or log prompts, document contents, keys, or SDK exceptions.
This step does not add authentication or an application rate limiter; keep the
demonstration local rather than exposing an unauthenticated quota-consuming API.

### Testing and optional live verification

From the repository root:

```powershell
.\backend\.venv\Scripts\python.exe -m compileall -q backend/app backend/tests
.\backend\.venv\Scripts\python.exe -m pytest -q
cd frontend
npm test -- --maxWorkers=1
npm run typecheck
npm run lint
npm run build
```

All AI tests mock the SDK, and factory test configuration ignores `.env` keys.
The suite consumes no Gemini quota. Tests cover validation, bounded retrieval,
correct pages and reordered sources, unsupported additions, prompt injection,
empty answers, malformed responses, missing configuration, invalid credentials,
provider failures, timeouts, quota errors, database failures and existing APIs.

Optional live verification requires a configured key **and confirmed project
free-tier eligibility**. First check exact model availability with the SDK's
`client.models.get(model="gemini-3.5-flash-lite")` and confirm `generateContent`
support. Do not substitute another model if unavailable. Use the existing PDF
upload endpoint with one generated, uniquely titled fictional claims policy;
record its returned ID. Ask one relevant question using the policy's vocabulary,
verify the returned ID/title/page against that PDF, then ask one unrelated
question and confirm abstention. Keep generation calls to those checks only.
Delete only that test-created document through the existing delete endpoint,
which removes its chunks and stored file. Preserve all preexisting records.

For this Step 5.1 run, no Gemini API key was present in `backend/.env` or the
process environment. Live model/project access and generation verification are
therefore **pending**; no live calls or test documents were created. Billing was
not enabled. Step 5.2 and all frontend AI work remain out of scope.

Step 5.1 verification completed on **2026-10-24**: **429 backend tests passed**
(325 existing plus 104 AI tests), including SDK serialization through a mocked
HTTP transport and verification that resource-limited PDF workers do not import
the Gemini SDK. The two existing SQLite expression-index reflection warnings
remain. Python syntax compilation and `pip check` passed. All **200 frontend
tests**, TypeScript checking, Oxlint and the production build passed. Hash checks
confirmed all 70 checked frontend and migration files were unchanged, with no
added files in those trees. No commit, push, or deployment was performed.
