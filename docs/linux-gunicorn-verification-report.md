# Deployment Fix 3 — Linux/Gunicorn runtime and PDF timing verification

Date: 2026-10-28. Scope: verification only. **Final verdict: LINUX/GUNICORN NOT VERIFIED.**

The existing WSL2 registration exposed a Linux kernel briefly, but no usable
Linux Python/application runtime was established. A subsequent approved probe
failed during WSL VM creation. Gunicorn startup, Linux PDF timing, HTTP serving
and Linux regression checks therefore remain blocked. Source inspection and
existing Windows evidence do not establish Linux compatibility. No application
fix or PDF deadline change is justified by this milestone.

## A. Linux environment

| Check | Observation |
| --- | --- |
| Host | Windows, PowerShell, project `D:\HealthAssit\HealthCareAssist-AI` |
| WSL inventory, before and after probing | Only `docker-desktop`, WSL version 2, state `Stopped`; no general-purpose development distribution listed |
| First approved Linux probe | Reported x86_64 Linux, kernel `6.18.33.2-microsoft-standard-WSL2`, build dated 2026-06-18 |
| OS metadata | Only `PRETTY_NAME="Docker Desktop"`; no distribution release version reported |
| Python / Gunicorn / PostgreSQL | No executable path returned by the first probe for `python3.11`, `python3`, `python`, `pip`, `gunicorn`, `psql`, `pg_ctl` or `docker` |
| Existing Linux virtual environments | None established; the fuller inventory did not execute successfully |
| Docker on Windows | Not found on PATH or at the checked standard Docker executable/Desktop paths; no Docker Desktop/backend/daemon process observed |
| Native Linux | The execution host is Windows; no native Linux application runner was identified |
| Linux resource sampling | Not obtained; the probe requesting `/proc/meminfo` and `/proc/loadavg` failed |

The initial sandboxed WSL execution failed with `Wsl/Service/E_ACCESSDENIED`.
It was retried through approved execution outside the sandbox. That first
approved shell reported the kernel/OS information above, returned exit code 1,
and did not establish an interpreter or application runtime. The absence of
executable paths is a limited PATH/known-location observation, not proof that
no Python binary exists anywhere in that internal distribution.

The fuller approved inventory returned exit code 1 and:

```text
This operation returned because the timeout period expired.
Wsl/Service/CreateInstance/CreateVm/0x800705b4
```

The final approved `wsl.exe -l -v` again listed only stopped `docker-desktop`.
This is an environment/VM-availability failure, not a Gunicorn failure or a PDF
timeout. The internal Docker environment was not repurposed, repaired or supplied
with packages. No Docker daemon, container or general-purpose distribution was
started for application testing. No WSL/Docker installation, Windows setting
change, image pull, system package installation or cloud resource creation occurred.

Minimal manual prerequisite: make a user-managed Linux development environment
available with Python 3.11, `venv` and pip, independently of the internal
`docker-desktop` registration. Then use an isolated Linux virtual environment
and the existing `backend/requirements.txt`, without dependency upgrades beyond
its declared constraints. Use a sanitized project copy that excludes `.env`,
local credentials, application databases and real uploads. Re-run this milestone
with disposable SQLite, network guards and synthetic authentication. No system
setup was performed by this task.

Sanitized probe evidence:
[`fix3-environment.json`](../.verification-artifacts/deployment-fix-3/fix3-environment.json).

## B. Gunicorn and production configuration

Inspected the existing factory, configuration, authentication, database and PDF
storage code, Dockerfile, Gunicorn configuration, compiled frontend, production
tests, and deployment/storage documentation. No new entry point was introduced.

The actual documented production command, confirmed against the Dockerfile,
uses working directory `/app/backend` in the image, or `backend/` in a checkout:

```sh
gunicorn --config gunicorn.conf.py 'app:create_app()'
```

`backend/run.py` starts Flask's development server when executed directly; it
was not used as runtime evidence. `backend/gunicorn.conf.py` specifies one
worker, two threads, a 120-second server timeout, binding to `0.0.0.0:$PORT`
(default 10000), with forwarded-header interpretation disabled. The server
timeout is separate from the unchanged five-second PDF validation deadline.

A future local runtime verification must override the bind to
`127.0.0.1:<unused-test-port>` and retain the same factory. It must supply
explicit synthetic/test configuration, secure authentication settings and a
disposable database, preventing real database or cloud access before startup.
Neither production startup nor this loopback variant was executed here.

| Component | Confirmed by inspection | Linux runtime result |
| --- | --- | --- |
| Factory | `app:create_app()` initializes extensions, API blueprints, authentication and optional compiled frontend serving | Not run |
| Environment loading | Normal factory calls `local_configuration()`, which loads `backend/.env` without overriding existing environment values; explicit `test_config` uses `TestingConfig` and avoids that loader | Not run; normal factory was deliberately not invoked |
| Database | PostgreSQL URLs select psycopg 3; Render mode requires encrypted `sslmode`; ORM engine initialization is separate from explicit `check-db`; health handler performs no DB query | Driver import, TLS handshake and PostgreSQL behavior unverified on Linux |
| Authentication | Strong Werkzeug password hash, signed session, credential-version/expiry checks, no testing authentication bypass | Synthetic login and protected-route 401 unverified on Linux |
| Cookies/CSRF | Secure default, HttpOnly, SameSite=Lax, `/api` cookie path, Origin and token CSRF checks; Render enforces secure cookies and exact trusted host | HTTP response headers and CSRF behavior unverified on Linux |
| Proxy boundary | Render mode fixes WSGI scheme to HTTPS; untrusted forwarded scheme/host headers are not used | Unverified on Linux |
| PDF storage | Local default; Supabase mode validates HTTPS hosted origin, private bucket settings and server key format; no fallback on invalid configuration | Filesystem/remote adapter runtime unverified on Linux |
| Startup/shutdown | No application server was started | No Gunicorn lifecycle or graceful shutdown verification; no task-created application server to clean up |

### Declared Linux dependencies

These are declarations, not Linux-installed versions or successful imports:

| Component | Existing declaration |
| --- | --- |
| Python target | Dockerfile `python:3.11-slim-bookworm`; no exact Linux patch version measured |
| Flask | `>=3.1,<4` |
| Gunicorn | `>=23,<24` |
| SQLAlchemy integration | `Flask-SQLAlchemy>=3.1,<4`, `Flask-Migrate>=4.1,<5`; SQLAlchemy installed transitively |
| PostgreSQL driver | `psycopg[binary]>=3.2,<4` |
| Structure parser | `pypdf>=6.21.2,<7` |
| PyMuPDF | `>=1.27.2,<2` |
| HTTPX | `>=0.28.1,<1` |
| Gemini SDK | `google-genai==2.33.0` |

Python 3.11 compatibility and imports of Flask, Gunicorn, SQLAlchemy, psycopg,
pypdf, PyMuPDF, HTTPX and the Gemini SDK were not executable in Linux. No package
compatibility error was measured; environment availability blocked that stage.
The existing Windows Python 3.11.9 evidence is not Linux verification.

## C. PDF timing and Windows comparison

Structure validation runs `python -m app.pdf_validation` with **pypdf**, bounded
stdin and the existing **five-second** subprocess timeout. Extraction runs
`python -m app.pdf_extraction` with **PyMuPDF**, the existing **ten-second**
timeout and bounded output. Linux resource protection uses `RLIMIT_AS` (512 MiB)
and `RLIMIT_CPU` (eight seconds). These paths were inspected but not exercised
on Linux. No resource limit, deadline, assertion or worker behavior was changed.

The following Windows measurements are historical, from the
[Deployment Fix 2B report](deployment-fix-2b-pdf-timing-report.md) and its
`summary.json`, `combined.xml` and `failure-windows.json`. Durations are seconds;
triples are minimum / median / maximum.

| Stage | Windows corrected grouped run | Windows combined run | Linux |
| --- | --- | --- | --- |
| Worker launch (`Popen`) | .011420 / .014766 / .016697 | .011170 / .025233 / .287343 | Not measured |
| Spawn entry to first child Python timestamp | .060555 / .062067 / .081795 | .049567 / .134682 / 3.710589 | Not measured |
| Completed worker-module import | .007378 / .007913 / .012090 | .007446 / .023637 / .158270 | Not measured |
| Completed pypdf import | .220269 / .235188 / .282583 | .241435 / .698067 / 2.734728 | Not measured |
| PDF open / initial parsing | .000256 / .000441 / .273401 | .000183 / .000672 / .643896 | Not measured |
| Remaining structure checks / close | .000335 / .000616 / .000866 | .000070 / .000847 / .050069 | Not measured |
| Initial validation communication wait | Per-PID historical events | .328464 / .968987 / 5.060344 | Not measured |
| Final context cleanup after communication | .000009 / .000010 / .000011 | .000009 / .000019 / .000323 | Not measured |
| Total validator including failure cleanup | .360898 / .385225 / .607451 | .339670 / .998893 / 6.051776 | Not measured |
| Upload request, including deliberately rejected fixtures | .009103 / .676658 / .998967 | .001658 / .895910 / 7.771928 | Not measured |
| PyMuPDF import, extraction workers | Not separately tabulated | .114759 / .352960 / 3.564797 | Not measured |

Intervals overlap and must not be summed. First-child timing includes process
creation, interpreter initialization, scheduling and the diagnostic bootstrap;
it does not isolate interpreter time. The instrumented historical bootstrap
adds imports/timestamp writes and is not timing-identical to native production.
Upload measurements use Flask's test client, not network/Gunicorn HTTP latency.
Successful native Windows validator comparisons later took .318170–.389883 s
(median .343097 s); this did not resolve the preceding instability.

### Exact two newly failing tests, verified from diagnostic artifacts

1. `backend/tests/test_documents.py::test_duplicate_original_names_have_unique_internal_names`
   failed during one of its two initial uploads. The timed-out worker last logged
   `pypdf_import_start`, never `pdf_open_start`. Initial communication wait was
   5.042363 s; validator total 6.051776 s; failed request 6.216551 s.
2. `backend/tests/test_documents.py::test_newest_first_pagination_and_id_tie_break`
   failed during its initial sequence of uploads, before pagination assertions.
   Spawn-to-first-Python took 3.710589 s; the last stage was
   `module_import_start`, before parser import/PDF opening. Initial wait was
   5.060344 s; validator total 5.494137 s; failed request 5.569212 s.

Those failures occurred before storage/extraction for the rejected uploads.
The first test checks distinct private filenames for equal original names; the
second checks newest-first ordering and ID tie-breaking. Neither failure
established a filename, ordering or storage defect. Both passed in the later
historical two-case native comparison (2 passed, 5.32 s), not in a new run here.

Historical combined-run host observations: available memory 266–1,318 MiB
(median 778 MiB), CPU 19.3–97.8% (median 68.6%). The two timeout windows recorded
91% and up to 96% memory load. Paging/disk/processor-queue observations support
resource contention but do not identify the exact blocking operation.

**Comparison classification: C — Linux tests blocked by environment or
dependency availability.** No Linux timing distribution or PDF timeout result
exists. The WSL VM-creation timeout is not a reproduction of the PDF timeout.
Different hardware, filesystem placement and host/VM load would also constrain
any later comparison. Even a future stable Linux pass would not prove the
Windows timing issue fixed. Its root cause remains unresolved.

## D. Regression

No new pytest run was launched: targeted Linux tests and the full Linux backend
suite were blocked before dependency verification. No failing test was removed,
skipped, weakened or rerun until green. No Windows full suite was substituted.

| Execution | Collected/run | Passed | Failed | Warnings | Runtime |
| --- | --- | --- | --- | --- | --- |
| This milestone: Linux targeted PDF/storage | Not run | N/A | N/A | N/A | N/A |
| This milestone: Linux full backend | Not run | N/A | N/A | N/A | N/A |
| Historical 2B combined targeted diagnostic run | 204 | 202 | 2 | 2 | 334.07 s pytest; 334.035 s JUnit suite |
| Historical 2B native comparison of the two new failures | 2 | 2 | 0 | None reported | 5.32 s |

The historical combined breakdown was 87 passed / 2 failed for document tests,
54 processing passed, 40 storage passed, 2 worker-import tests passed and 19
database tests passed. JUnit recorded zero errors and zero skipped. The two
warnings concerned SQLite/Alembic reflection of the expression-based
`ix_document_chunks_search` index. Those counts and warnings are historical,
not new Linux results. The supplied full-backend baseline of 549 collected and
frontend baseline of 324 passed were not rerun.

All five required regression cases were inspected in the existing source:

| Case in `backend/tests/test_documents.py` | Existing assertion/coverage | Linux status |
| --- | --- | --- |
| `test_partial_write_is_cleaned_up` | Injected partial local write returns 500, removes partial file, leaves no metadata | Blocked |
| `test_storage_failure_preserves_existing_document[delete]` | Injected rename failure returns sanitized 500 and preserves existing PDF/metadata | Blocked |
| `test_failed_final_purge_keeps_isolated_recoverable_file` | Injected final purge failure preserves isolated recoverable tombstone and expected 204/metadata deletion | Blocked |
| `test_duplicate_original_names_have_unique_internal_names` | Distinct private files for identical supplied names | Blocked |
| `test_newest_first_pagination_and_id_tie_break` | Newest-first ordering, pagination and ID tie-breaking | Blocked |

The first three passed in the prior slow combined run. The first historical
partial-write 400 remains unexplained because its response body was not
captured; the original delete/purge failures reported validation timeouts.
No change to those contracts is supported.

Existing test coverage for a future Linux run includes valid, corrupted, empty,
encrypted and pageless PDFs; invalid names/types; exact 5 MiB upload boundary
and multipart allowance; sanitized timeout/startup errors; processing failures;
rollback, local cleanup and mocked Supabase retrieval cleanup. The targeted
suite remains `test_documents.py`, `test_document_processing.py`,
`test_pdf_storage.py`, `test_pdf_worker_startup.py` and `test_database.py`, plus
production-serving checks. Existing fixtures guard against non-SQLite DB
connections; Supabase tests use HTTPX MockTransport and block real HTTP/Gemini.
These guards were inspected, not executed here. A future full backend run
should occur once after targeted checks pass and host stability is established.

## E. Production static serving and readiness

The existing `frontend/dist/index.html` and five build files were present.
Its referenced `/assets/index-HMUa8z-1.js` and
`/assets/index-BQ_Wfctg.css` both exist. The factory serves compiled files
directly, supplies `index.html` for extensionless UI routes, rejects missing
assets, and excludes `/api` and `/api/*` from SPA fallback. React source declares
`/login` and protected `/dashboard` routes. Docker builds the frontend and copies
dist into `/app/frontend/dist`; no Vite development server is part of its CMD.

| Required live check | Source/build observation | New Linux/Gunicorn result |
| --- | --- | --- |
| Root React page | Existing index and factory root handler | Blocked |
| `/login` | Extensionless SPA fallback and React login route | Blocked |
| `/dashboard` deep link | Same fallback and protected React route | Blocked |
| `/api/health` JSON 200 | Handler explicitly returns JSON/status 200 without querying DB | Blocked |
| Protected API 401 | Authentication hook enforces configured session | Blocked |
| API error responses | Existing route-level JSON error handlers remain | Blocked |
| Unknown API route | Factory explicitly aborts 404 rather than serving SPA | Blocked; JSON format for an unmatched route is not established |
| Compiled assets and paths | Both HTML-referenced asset files exist | File check passed; HTTP delivery blocked |
| No development server | Production CMD runs Gunicorn only | Configuration confirmed; runtime blocked |

Read-only checks across all five dist files found zero matches for Google API
key, Supabase secret, GitHub token, private-key header, PostgreSQL URL and
Werkzeug credential-hash patterns; no Vite dev-client/port-5173 reference matched.
Four eligible sensitive values from local `.env` (selected names, nonempty,
at least eight characters) were compared privately against built files; none
matched. Values were not printed or saved. This bounded scan is not proof
against arbitrary unknown secret formats. The build was not regenerated.
See [`fix3-static-audit.json`](../.verification-artifacts/deployment-fix-3/fix3-static-audit.json).

Confirmed preparation consists of the declared factory/command, dependency
manifest, Linux-oriented Dockerfile, preserved security configuration and
existing compiled assets. **No application component is newly confirmed
Linux-compatible by execution.** Remaining Linux work is dependency imports,
Gunicorn startup/shutdown, real loopback HTTP/auth/static checks, native and
instrumented worker timing, targeted PDF/storage tests and one stable full run.

Remaining cloud integration requirements from existing documentation are
separate: authorized staging PostgreSQL/TLS/migration validation, private
Supabase upload/retrieval/deletion and restart-persistence checks, intended
hosting/proxy configuration, and any separately authorized Gemini integration
validation. None was attempted. This milestone does not authorize publication,
Render deployment or cloud changes.

## F. Safety and preservation

- No application factory, Gunicorn server, Flask development server or PDF
  worker was started. Both approved WSL probe processes exited; no task-created
  application server/worker remains. The registered WSL distribution ended stopped.
- No real/application database connection, query, migration or mutation occurred.
  No Supabase request or Gemini request occurred. No dependency or system package
  installation occurred.
- `backend/.env` was not edited. Only its hash and private, nonprinting bundle
  comparisons were used. No credential value was logged or placed in artifacts.
- Authentication, CSRF, PDF validation/extraction deadlines, resource limits,
  source, existing tests, dependencies and compiled frontend were unchanged.
- The exact Git index and existing unstaged patch were fingerprinted before
  additions. All **1,462 staged backup-environment deletions** remain preserved.
  The preexisting untracked files, including the already present Fix 3
  `baseline.json`, and compiled assets were included in preservation checks.
  Final comparison passed: identical index and unstaged patch, unchanged
  `backend/.env`, all 183 preexisting untracked files unchanged, all five dist
  files unchanged, and no unexpected additions. `git diff --check` passed.
- Only this report and new `fix3-*` evidence files under the existing
  `.verification-artifacts/deployment-fix-3/` directory were added. No existing
  artifact was overwritten. Final comparison is recorded in
  [`fix3-preservation-final.json`](../.verification-artifacts/deployment-fix-3/fix3-preservation-final.json).
- No Git reset/clean, staging, commit, push, publication, deployment, cloud
  resource creation or unrelated-project modification occurred.

**Final verdict: LINUX/GUNICORN NOT VERIFIED.** Environment availability blocked
essential runtime checks. No PDF deadline modification or application fix was
made. Work stops at this verification report.
