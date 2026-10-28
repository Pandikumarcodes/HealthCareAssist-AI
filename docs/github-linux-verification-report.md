# GitHub Linux verification workflow

Date: 2026-10-28.

**GITHUB LINUX WORKFLOW READY — HOSTED EXECUTION PENDING**

The workflow is prepared and locally validated. It has not run on GitHub.
Linux/Gunicorn compatibility, hosted test counts and hosted PDF timings remain
unverified. No application architecture, authentication, CSRF, PDF deadline or
existing test was changed.

## A. Workflow configuration

`.github/workflows/linux-verification.yml` has one job, `verify`, on
`ubuntu-24.04`, with a 30-minute job limit and **only** `workflow_dispatch`.
Repository permissions are `contents: read`; other token permissions are not
granted. There are no deployment jobs, service databases, cloud credentials,
repository-secret references, commits or publication steps. Checkout disables
credential persistence and Git clean/reset behavior.

Official action releases were checked against their published release pages and
input manifests: [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1),
[setup-python v7.1.0](https://github.com/actions/setup-python/releases/tag/v7.1.0),
[setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0), and
[upload-artifact v7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2).
The workflow uses these explicit release tags. No third-party action is used.

After a failed verification step, independent checks still run when their
dependencies succeeded. A failed check retains its failure status; there is no
`continue-on-error`, ignored exit status, automatic retry or test exclusion.
Backend/static smoke checks depend on a successful frontend build, so the
existing production-build integration test can execute instead of skipping for
missing assets. Evidence upload uses `always()` and seven-day retention.

## B. Files created/modified

| New file | Purpose |
| --- | --- |
| `.github/workflows/linux-verification.yml` | Single manual Linux verification job |
| `.github/scripts/linux_verify.py` | Imports/versions, full pytest observer, Gunicorn smoke, PDF probes, result summary |
| `.github/scripts/sitecustomize.py` | Opt-in CI-only Python network and local `.env` access guard, inherited by children |
| `.github/scripts/pdf_trace.py` | Optional parser import/open timestamps around unchanged worker `main()` |
| `docs/github-linux-verification-report.md` | This report |

Local-only validation evidence is under
[`.verification-artifacts/github-linux/`](../.verification-artifacts/github-linux/),
including `check_helpers.py`, the Windows-only `local-pdf/` measurements and
preservation/validation summaries. No preexisting file was intentionally edited.
The three helper files are CI tooling; no new production application entry point
or dependency was introduced.

## C. Linux runtime versions

Requested runner/runtime: Ubuntu 24.04, **Python 3.11.9**, **Node.js 24**.
Actual hosted OS, architecture, Python/Node patches and installed package
versions will be recorded in `runtime.json`; they have not yet been measured.

The workflow installs only existing backend requirements using
`python -m pip install -r backend/requirements.txt`, runs `pip check`, and uses
`npm ci --prefix frontend` with the existing lockfile. It does not upgrade the
manifests or install extra application packages. Backend dependencies retain
their existing ranges; the runner records what those ranges resolve to.

The import check covers Flask, Gunicorn, SQLAlchemy, psycopg, pypdf, PyMuPDF,
HTTPX and `google.genai`. It does not instantiate a live Gemini client or open
a PostgreSQL connection. Python's exact version is checked before declaring
the import step successful.

## D. Backend test configuration

From repository root, the helper invokes the existing complete suite once:

```sh
python .github/scripts/linux_verify.py backend
```

Its pytest arguments are `-ra --tb=short --durations=20`, JUnit output and
`backend/tests`. Existing `pytest.ini` still supplies `pythonpath = backend`
and `testpaths = backend/tests`. The expected baseline is approximately
**549 tests**, not a new hosted result. No collection filters or skip markers
were added, and the full suite is not rerun by this workflow.

Existing fixtures use ephemeral fictional authentication and disposable SQLite;
the existing SQLAlchemy guard rejects non-SQLite connections. Existing Gemini
tests mock the SDK/HTTP transport; Supabase tests use HTTPX MockTransport and
reject real HTTP. The additional Python audit guard rejects external DNS and
socket connections in the runner and Python children, including PDF workers.
The factory's real `.env` cannot be read. Checks reject a checkout containing
local backend/frontend environment files, apart from examples.

`backend.xml`, `backend-summary.json`, `backend-test-stages.json` and
`backend-run.json` retain passed/failed/skipped/error totals, exact failed node
IDs, setup/call/teardown durations, warning categories/count and wall time.
Pytest console/JUnit retain normal assertion diagnostics; local credentials are
never available to these runs. Per-test `backend-workers.json` observes native
worker launch, communication timeout, cleanup, exit status and total duration,
without replacing worker commands or changing their deadlines.

The full suite includes the three originally affected storage cases and the two
latest diagnostic failures:

- `test_partial_write_is_cleaned_up`
- `test_storage_failure_preserves_existing_document[delete]`
- `test_failed_final_purge_keeps_isolated_recoverable_file`
- `test_duplicate_original_names_have_unique_internal_names`
- `test_newest_first_pagination_and_id_tie_break`

## E. Frontend test configuration

The workflow runs the existing `npm run typecheck`, `npm run lint`,
`npm run test` and `npm run build` scripts from `frontend/`. Vitest uses default
console reporting plus JUnit output in the evidence directory; the existing
baseline is **324 tests**, pending hosted confirmation. No baseline is presented
as a new execution result. Multiple reporters and file output follow the
[official Vitest reporter interface](https://vitest.dev/guide/reporters.html).

`VITE_API_BASE_URL` is explicitly empty, preserving same-origin API requests.
No production key or Vite credential is supplied. The smoke helper checks HTML
asset references and scans dist files for recognizable credential/development
client patterns and its own ephemeral signing/password/hash values. HTTP asset
responses must match the compiled files. The scan is bounded pattern checking,
not a guarantee against every possible unknown credential format.

## F. Gunicorn smoke-test configuration

The existing production command, from `backend/`, remains:

```sh
gunicorn --config gunicorn.conf.py 'app:create_app()'
```

The CI helper starts the same application factory/configuration using
`python -m gunicorn`, overriding only the listening socket. It reserves an
unused `127.0.0.1` port and passes the listener via `--bind fd://<descriptor>`;
this avoids releasing the port between selection and server startup. Inherited
descriptor binding is part of [Gunicorn's documented bind interface](https://github.com/benoitc/gunicorn/blob/master/docs/content/reference/settings.md).

The signing key and fictional password are freshly generated in memory; the
password is hashed with existing Werkzeug functionality. Nothing is written to
`GITHUB_ENV`, command arguments, report output or artifacts containing those
credential values. Storage uses a temporary private local directory. Render
scheme handling, exact trusted host `ci.example.test` and secure cookies remain
enabled. A synthetic PostgreSQL URL points to loopback port 9 solely to satisfy
normal factory configuration. The smoke child also installs a SQLAlchemy
`do_connect` guard that rejects every DBAPI connection before libpq can open
C-level sockets, which are outside Python's socket audit boundary.
No PostgreSQL server/service or schema is created, and the selected routes do
not require database access.

The helper checks:

- Gunicorn remains alive; `/api/health` returns JSON 200 with `status=healthy`.
- `/api/auth/me`, `/api/documents`, `/api/requests` and
  `/api/dashboard/summary` return JSON 401 with `auth_required`. This also
  distinguishes valid authentication configuration from a 503 unavailable state.
- `/`, `/login`, `/dashboard`, `/knowledge-base` and `/requests/123` serve the
  compiled React HTML. Both referenced JS/CSS assets return their exact bytes.
- Unknown `/api/ci-missing` and a missing asset return 404 and never the SPA.
  The existing unmatched-route response format is preserved; global JSON 404
  behavior is not invented or claimed.

`gunicorn.json` explicitly records **`login_exercised: false`**. No real
authentication login is claimed by this smoke check. Existing full-suite login
and CSRF tests remain unchanged.

The helper uses bounded readiness polling, without restarting Gunicorn or
retrying failed assertions. It sends SIGTERM to the process group in `finally`,
waits/reaps, and uses SIGKILL only for failed cleanup. Forced shutdown/nonzero
exit fails the check. Logs are scanned for ephemeral credential values, redacted
before persistence, and credential leakage fails the check. No access-log
configuration or environment dump is enabled.

## G. PDF timing verification

The complete existing suite covers PDF upload validation, worker-import
isolation, invalid/corrupt/empty documents, upload limits, processing failures
and local/mocked remote cleanup. A separate synthetic probe step invokes:

1. Native `app.pdf_validation` once.
2. Traced `app.pdf_validation` once.
3. Traced `app.pdf_extraction` once for PyMuPDF loading/opening.

Validation keeps **five seconds** and extraction keeps **ten seconds**. Original
worker `main()`, memory/CPU protection and parsers are used. Structure validation
uses **pypdf**, while extraction uses **PyMuPDF**. No parser prewarming, deadline
increase, assertion weakening or arbitrary retry was added.

`pdf-timing.json` and stage sidecars record launch, spawn-to-first-Python,
worker-module import, parser import, initial opening/parsing, worker-main total,
communication/reaping, total elapsed, return code and timeout observations.
Stage sidecars are updated before imports, retaining the last stage if killed.
Load-average and Linux memory snapshots are captured before/after probes and
the full suite when observable; these are snapshots, not continuous profiling.

The summary includes the prior Windows combined-run min/median/max evidence:
spawn to first Python **.049567/.134682/3.710589 s**, completed pypdf import
**.241435/.698067/2.734728 s**, validator total
**.339670/.998893/6.051776 s**. See the
[Windows timing report](deployment-fix-2b-pdf-timing-report.md). Intervals overlap
and must not be summed. The traced bootstrap/audit guard add overhead; a single
probe is not a stability distribution, and host hardware/load/filesystem
conditions are not controlled. A hosted Linux pass would not establish that
the Windows timeout issue is fixed.

## H. Security and isolation

No cloud secrets or actual account credentials are requested. The job uses
synthetic DB configuration, temporary storage and existing mocked cloud tests.
Only the chosen loopback smoke port is permitted by the Python network guard
inside that smoke process; other workflow Python verification processes deny
all connections. This is a CI audit guard, not an OS-wide firewall. Dependency
downloads and GitHub artifact transport remain intentional workflow network use.

No backend `.env`, uploaded PDF, authentication file or database is uploaded.
Artifacts are limited to a new directory in `RUNNER_TEMP`: test results,
versions, timing/host measurements, summaries and sanitized Gunicorn logs.
Local source-copy PDF probes contained only source and synthetic files and did
not read the real `.env`. No application DB query/mutation, Gemini/Supabase
request, WSL repair, Docker installation, cloud change or deployment occurred.

## I. Local checks

| Check | Result |
| --- | --- |
| actionlint 1.7.12, YAML/Actions schema and expressions | Passed, exit 0; shellcheck/pyflakes integrations disabled because those tools were not installed |
| Ubuntu shell command syntax | All 10 run commands/blocks passed Git Bash `bash -n` |
| Python helper compilation | All three CI Python files passed |
| Focused local helper checks | **9 passed**, 0 failed, 0 skipped, 4.727 s in the final run |
| Native/traced PDF helper in isolated Windows source copy | **3 probes passed**, no timeout; original 5/10-second limits |
| Existing frontend CLI | Vitest 5.0.5 help confirms reporter output-file option |
| Existing paths/commands and official action inputs | Inspected and validated |
| Git whitespace validation | `git diff --check` passed |

The focused checks cover offline child guards, `.env` refusal, built assets and
credential detection, JUnit failure/skip/warning totals and node IDs, and mocked
Gunicorn success/failure shutdown plus credential-log rejection/redaction.
The final guard check also proved that a synthetic PostgreSQL connection is
rejected by SQLAlchemy before the DBAPI is called; no real connection occurred.
The local smoke checks mock Gunicorn/HTTP and **are not real runtime evidence**.

Windows-only helper totals were native validation **1.010513 s**, traced
validation **3.385456 s**, traced extraction **4.356914 s**. All returned 0.
These are one-time helper checks, not a new Linux comparison or a resolution of
Windows instability. Detailed values are under `local-pdf/`. No local full
backend/frontend suite or real Gunicorn server was run for this workflow-only
change. The official actionlint binary was downloaded to the temporary directory
and checked against its published SHA-256 list; it is not a CI/application
dependency.

## J. Hosted execution status

**Not run.** There is no hosted run URL, hosted test result, measured Linux
package version, Linux PDF timing or verified Gunicorn startup result yet.
The workflow has not been committed, pushed, published or dispatched. Once the
reviewed files are made available through a separately authorized publication,
the manual workflow can produce the evidence described here. That publication
and execution were not performed by this task.

## K. Remaining blockers and preservation

The remaining milestone is an actual Ubuntu-hosted execution and review of all
step outcomes, test counts/skips/warnings, shutdown logs and worker timing.
Hosted dependency resolution, Linux parser protections and inherited-socket
Gunicorn startup remain execution checks, not local guarantees. Cloud database
TLS/migrations, real Supabase durability and live Gemini integration remain
outside this offline workflow.

Preservation checks passed against the initial fingerprints: the exact index,
existing unstaged patch, `.env` and all **188 preexisting untracked files** are
unchanged. All **1,462 staged backup-environment removals** remain intact.
Final results are recorded in
[`local-validation.json`](../.verification-artifacts/github-linux/local-validation.json).
No Git reset/clean, staging, commit, push or deployment occurred.

**GITHUB LINUX WORKFLOW READY — HOSTED EXECUTION PENDING**
