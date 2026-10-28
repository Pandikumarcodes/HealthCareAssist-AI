# Deployment Fix 2B — PDF validation timing investigation

Date: 28 October 2026. Final verdict: **PDF ROOT CAUSE UNRESOLVED**.

Two newly observed HTTP 400 timeouts occurred **before PDF opening**, during
interpreter/module startup and `pypdf` import. The slow run also had measured
memory, paging, CPU and disk pressure. This is substantially stronger evidence
than elapsed test durations alone, but does not identify the exact blocking
operation or retroactively establish the cause of every historical rejection.
The three originally affected tests passed in every valid new comparison.

No production code, existing test, timeout, dependency, migration, storage
adapter or API contract was changed. No minimal application fix is justified.
PDF behavior is **not demonstrably stable** under the observed host conditions.

## A. Evidence reviewed and measurement method

Reviewed `deployment-fix-2a-regression-report.md`, `render-deployment-preparation.md`,
`persistent-pdf-storage.md`, the 2A XML/JSON evidence and diagnostic scripts,
`app/documents.py`, document routes, both PDF workers, resource limits, application
startup and the relevant upload/auth/database fixtures.

Historical evidence, not new runs:

| 2A full run | Result | Duration |
| --- | --- | --- |
| First | 549 passed | 122.62 s |
| Second | 546 passed, 3 failed | 433.76 s |

The second run's failures were at collection positions 331, 334 and 335.
`test_partial_write_is_cleaned_up` took 7.01 s in call / 9.157 s overall and
asserted 400 versus 500 without recording the response body. The delete variant
of `test_storage_failure_preserves_existing_document` took 5.27 / 10.534 s;
`test_failed_final_purge_keeps_isolated_recoverable_file` took 5.40 / 7.850 s.
The latter two explicitly reported the five-second structure-validation timeout
on their initial upload. The preceding test was
`test_unverifiable_delete_commit_preserves_backup`; Supabase tests came later.
The 2A evidence also shows slowdown outside PDF tests, but lacks resource samples
at those historical failures.

New artifacts are in
[`.verification-artifacts/deployment-fix-2b`](../.verification-artifacts/deployment-fix-2b/).
`diagnose.py` is an explicitly invoked pytest observer, never a production import
or automatically loaded fixture. It measures with `time.perf_counter()`:

- Route validation, storage and indexing entry/exit, exception category and total
  Flask test-client request time. Success metadata and request bodies are omitted.
- Original `Popen` launch, `communicate`, timeout, kill and final context cleanup;
  PID, exit status and original timeout values are retained.
- In detailed mode, `worker_trace.py` invokes the unchanged worker `main()` and
  original resource protection, with timestamps around worker-module import,
  limit installation, parser import and PDF opening. Its sidecars contain only
  stage names, clock values and PIDs. `--native` leaves the worker command intact.
- A nominal 0.5-second Windows API sampling thread measures system CPU deltas,
  available memory, parent working set/page-fault counts, process count, direct
  children and instrumented active workers. Sampling gaps increased under load;
  timestamps, rather than the intended frequency, define the actual coverage.

Detailed mode changes `python -m app.pdf_validation` to an artifact bootstrap
which imports that same worker and calls `main()`. It restores the backend
module search path, preserves input/output handling and `timeout=5`, and does
not preload the parser before limits. **It is not timing-identical to production**:
extra imports and timestamp writes may add delay, especially during disk pressure.
The parent observer/sampler and per-test JSON writes also have an observer cost.
No bootstrap-overhead subtraction or claim of negligible overhead is made.

The first detailed grouped attempt omitted the backend search path. Its five
immediate worker exits / five HTTP 400 assertion failures are **harness failures**,
not evidence of an application defect. `together.xml/json` retain this invalid
attempt. `together-corrected.*` retain the corrected seven-pass comparison.

### Validation-stage measurements

All durations below are seconds, shown as minimum / median / maximum. Combined
run measurements include intentionally invalid fixtures; counts differ because
two workers timed out before completing their imports.

| Stage | Corrected grouped run | Combined run |
| --- | --- | --- |
| A. Validation entry to spawn | .000714 / .000875 / .016768 (5) | .000677 / .002506 / .065834 (61) |
| B. `Popen` construction | .011420 / .014766 / .016697 (5) | .011170 / .025233 / .287343 (61) |
| C1. Spawn entry to first child Python timestamp | .060555 / .062067 / .081795 (5) | .049567 / .134682 / 3.710589 (61) |
| C2. Worker-module import, completed | .007378 / .007913 / .012090 (5) | .007446 / .023637 / .158270 (60) |
| Resource-limit installation, completed | .012057 / .015367 / .016287 (5) | .010510 / .034291 / .232271 (60) |
| C3. `pypdf` import, completed | .220269 / .235188 / .282583 (5) | .241435 / .698067 / 2.734728 (59) |
| D. `PdfReader` opening/initial parsing | .000256 / .000441 / .273401 (5) | .000183 / .000672 / .643896 (59) |
| E. Remaining structure checks/close, after open | .000335 / .000616 / .000866 (5) | .000070 / .000847 / .050069 (59) |
| F. Initial validation `communicate` wait | See per-PID events | .328464 / .968987 / 5.060344 (61) |
| G. Final process-context cleanup, after communicate | .000009 / .000010 / .000011 (5) | .000009 / .000019 / .000323 (61) |
| Total validator invocation, including failure cleanup | .360898 / .385225 / .607451 (5) | .339670 / .998893 / 6.051776 (61) |
| H. Upload request total, including deliberate rejected requests | .009103 / .676658 / .998967 (7) | .001658 / .895910 / 7.771928 (95) |

These intervals **overlap and must not be summed**. F encloses child startup,
imports and parsing. C1 includes B, the virtual-environment launcher, interpreter
initialization and scheduling; those components cannot be separated by the
available user-space timestamps. D includes initial parsing, not just OS file
opening: structure validation reads stdin into memory and uses `BytesIO`.
E excludes that initial parsing and includes normal reader cleanup. H includes
multipart construction/parsing, authentication/CSRF hooks and downstream work;
it is not a production HTTP-server latency benchmark.

Native isolated validator totals were .646935 s (partial write), .564212 s
(delete variant) and .551942 s (purge). Their upload request totals were .748648,
1.406122 and 1.288343 s. In the final two-case native comparison, five validators
completed in .318170–.389883 s, median .343097 s.

### Exact timeout windows

`failure-windows.json` joins same-run resource samples and worker events.
Parent PIDs are Windows venv launcher PIDs; child sidecar PIDs identify the real
Python interpreters. Different PIDs are expected and were investigated separately.

| New failing test | Duplicate-original-names test | Newest-first-pagination test |
| --- | --- | --- |
| Launcher / interpreter PID | 17604 / 6900 | 26928 / 13376 |
| Pre-spawn validation | .008686 s | .003104 s |
| Launch call | .082825 s | .287343 s |
| Spawn to first Python timestamp | .355316 s | 3.710589 s |
| Completed worker-module import | .158270 s | Not completed |
| Completed resource-limit setup | .212115 s | Not reached |
| Last recorded stage | `pypdf_import_start` | `module_import_start` |
| Initial wait / exception | 5.042363 s / `TimeoutExpired` | 5.060344 s / `TimeoutExpired` |
| Kill API duration | .017855 s | .027181 s |
| Post-kill communicate/reap | .707525 s | .118666 s |
| Launcher exit | 1 | 1 |
| Total validator / request | 6.051776 / 6.216551 s | 5.494137 / 5.569212 s |

The first was still importing `pypdf` at the deadline, at least 4.375 s after
its import-start timestamp. The second spent most of the budget before the
first Python timestamp, then entered worker-module import about 1.620 s before
the timeout. Neither logged `pdf_open_start`; neither reached storage or
extraction for that rejected upload. The precise import dependency, filesystem
read, paging wait or scheduling operation responsible is unavailable.

Five seconds is the unchanged `communicate` timeout, not an exact five-second
total request guarantee: process creation precedes it, and termination/reaping
follows it. Slower reaping contributes to total elapsed time but is not evidence
that parsing exceeded the bound. No cleanup retry was added.

### PyMuPDF, temporary files and lifecycle

Structure validation uses **pypdf**, not PyMuPDF. In the 49 observed extraction
workers, PyMuPDF import took .114759 / .352960 / 3.564797 s; opening took
.001913 / .009276 / .138204 s; total child calls took .281110 / .836348 /
6.514386 s, within the existing ten-second extraction timeout. Expected
extraction rejections remain distinct from upload structure-validation timeouts.

Local validation passes bounded bytes through stdin, before creating the stored
PDF. Multipart spooling is bounded by Werkzeug's existing limits. Extraction
closes/flushed storage writes before worker startup, uses its existing temporary
output file, and remote retrieval closes the temporary input before extraction
and removes its temporary directory afterward. The 54 processing and 40 storage
tests passed, including temporary-file cleanup assertions. No stale-file or
stream-position cause was reproduced.

`lifecycle_probe.py` created one bounded synthetic sleeping child and tested
termination of its own launcher. Launcher 19920 started interpreter 26172;
after launcher termination the interpreter was no longer active. Probe elapsed
.137293 s. This found **no surviving-child defect** in the exercised venv-launcher
path. It does not claim exhaustive lifecycle coverage. No unrelated process was
terminated. Production worker import-isolation tests also passed, 2/2.

## B. HTTP 400 versus 500 and failure classification

`validate_upload()` first checks multipart shape, filename/title, bounded byte
read and signature/EOF, then runs the structure validator. A
`DocumentValidationError` becomes sanitized HTTP 400. A `TimeoutExpired` is
converted to that validation error. Nonzero worker status other than 2 returns
the existing malformed/encrypted PDF 400; resource protection status 2 and
startup/storage `OSError` use the existing sanitized HTTP 500 handler.
`write_upload()` is called **only after** validation returns successfully.

| Historical failure | Classification and confirmed evidence | Remaining uncertainty |
| --- | --- | --- |
| `test_partial_write_is_cleaned_up` | **6 — Unresolved.** All valid new runs reached `write_upload`, recorded its injected `OSError`, returned 500 and passed cleanup/no-metadata assertions. | The historical 400 body was not captured. Multipart, signature, timeout, worker rejection or another validation condition cannot be distinguished retroactively. Timing alone is insufficient. |
| `test_storage_failure_preserves_existing_document[delete]` | **6 — Unresolved root cause; confirmed validation-timeout mechanism.** Historical initial upload returned the explicit timeout 400, before storage. New isolated/grouped/combined initial uploads returned 201 and the delete-failure assertions passed. | No historical inner-worker timing/resource samples exist. New startup/import delays are supporting context, not proof of that request's precise cause. |
| `test_failed_final_purge_keeps_isolated_recoverable_file` | **6 — Unresolved root cause; confirmed validation-timeout mechanism.** Historical initial upload timed out before storage. New initial uploads returned 201 and the recoverable-tombstone assertions passed. | Same historical measurement gap; no purge/storage regression established. |

The two new detailed-run failures establish **startup/import deadline exhaustion**.
Classification 4, environment-dependent scheduling/I/O delay, is a supported
working explanation, not an exclusive confirmed root cause. Actual PDF parsing
did not begin. Concurrent host memory pressure was measured, rather than inferred
from Windows or test duration. The native comparison later passed under lighter
load, but load was not experimentally held constant and bootstrap overhead was
not independently calibrated. No application defect, fixture contamination,
worker lifecycle defect or storage adapter regression was confirmed.

The partial-write test's `Path.open` fault injection is in the test process;
it is not inherited by a fresh worker interpreter. Its newly observed requests
show successful validation followed by storage `OSError`. This establishes that
the test can reach the intended 500 path and that a speculative 400-to-500
conversion or assertion change would be unjustified. Existing expectations stay.

## C. Host observations and isolation limits

Windows API samples and two read-only CIM snapshots were collected without
installing an agent or changing system settings.

| Observation | Passing grouped run | Slow combined run |
| --- | --- | --- |
| Available memory | 741–824 MiB | 266–1,318 MiB; median 778 MiB |
| System CPU | 19.9–49.2%; median 28.4% | 19.3–97.8%; median 68.6% |
| Parent working set | 70–122 MiB | 37–170 MiB |
| System process count | 372–374 | 372–402 |
| Tracked direct children / PDF workers | At most 1 / 1 | At most 1 / 1 |

During the first timeout, sampled available memory was 640–678 MiB, CPU
51–69%, and memory load 91%. During the second, available memory fell to
**266 MiB**, load reached **96%**, and sampled CPU was 55–72%. The parent working
set fell from approximately 71 MiB to 53 MiB in that window. Parent page-fault
counts rose across the run from 18,923 to 1,842,539; these include soft faults and
are not a measurement of hard faults or a unique diagnosis of paging.

The earlier CIM snapshot at 11:11:46 UTC reported 863 MiB available,
1,097 pages/s, 331 page reads/s, physical-disk queue 0 and processor queue 1.
The slow-run snapshot at 11:15:57 UTC reported **753 MiB available, 19,603 pages/s,
1,035 page reads/s, physical-disk queue 5, about 35.5 MB/s disk traffic and
processor queue 40**. Both C: and D: appeared on physical disk 0. Raw
`PercentDiskTime` was 586 in that snapshot; it is retained as a Windows counter,
not interpreted as literal 586% device utilization. These snapshots are not
continuous counters and were not taken at the exact timeout instants.

Together these observations support real resource contention during the slow
run. They do not identify a competing process, antivirus activity, a specific
contended file, per-worker CPU use or an exact scheduler wait. No filesystem
contention tracing or global census of unrelated PDF workers was available.
Only this diagnostic runner's workers were counted; no concurrent backend suite
was launched. Nothing was killed to make tests pass.

Codex sandbox execution could not access the base interpreter referenced by
`backend/.venv/pyvenv.cfg`: it reported `No Python at ...`; a direct existence
check returned access denied. Sandbox workspace-directory creation and CIM reads
also returned access denied. Explicitly approved execution outside isolation
successfully used the **same existing Python 3.11.9 environment** and CIM APIs.
All new executable measurements used that approved context. There is no measured
successful sandbox-versus-interactive-PowerShell timing comparison, so isolation
is not established as the historical timeout cause. No environment was rebuilt.

## D. Changes and new test results

Only this report and `.verification-artifacts/deployment-fix-2b/` were added.
Artifacts include the optional observer/bootstrap, lifecycle probe, preservation
and check scripts, summary/window builders, sanitized XML/JSON, stage-only
sidecars and host snapshots. No application or existing test file changed.
No regression test was added because no corrective defect was established.

Security is preserved: 5 MiB byte limit, strict signatures/structure, encryption
rejection, five-second validation deadline, ten-second extraction deadline,
512 MiB / eight CPU-second process protection, page/text/output limits,
authentication/CSRF and existing HTTP contracts remain unchanged. No retries,
skips, assertion changes, Pytest-timeout increases or parser prewarming were added.

### Exact new execution results

| Run/artifact stem | Result | Pytest duration |
| --- | --- | --- |
| `isolated-partial` — native | 1 passed | 4.19 s |
| `isolated-delete` — native | 1 passed | 3.81 s |
| `isolated-purge` — native | 1 passed | 5.54 s |
| `together` — invalid bootstrap, retained separately | 5 harness failures, 2 passed | 3.42 s |
| `together-corrected` — original three, valid-upload and exact-size fixtures, startup tests | 7 passed | 5.88 s |
| `combined` — normal order within each original test module | **202 passed, 2 failed**, 2 warnings | **334.07 s** |
| `native-comparison` — two new failing cases, once | 2 passed | 5.32 s |

Combined breakdown: document upload/deletion **87 passed / 2 failed**;
processing **54 passed**; storage **40 passed**; worker startup **2 passed**;
database configuration **19 passed**. Zero skipped and zero collection/setup
errors. Both failures were the timeout cases documented above, not storage tests.
The original three cases passed within this same slow run.

The two existing warnings were SQLite/Alembic inability to reflect the
expression-based `ix_document_chunks_search` index in document and processing
migration-comparison tests. They were not new warnings or failed migrations.
Tests migrated only their own temporary SQLite files; migration source is unchanged.

No new full backend run was started: production and existing tests are unchanged,
the combined targeted checks did not pass, and the host was measurably unstable.
Running a full suite after that would not satisfy the requested prerequisite of
passing targeted checks. The historical 549/546 totals above are not represented
as new verification. No combined suite was repeatedly rerun until green.

Execution pattern from repository root:

```powershell
.\backend\.venv\Scripts\python.exe .verification-artifacts/deployment-fix-2b/diagnose.py LABEL [--native] TEST_NODE_OR_FILE ...
```

`combined` file order was `test_documents.py`, `test_document_processing.py`,
`test_pdf_storage.py`, `test_pdf_worker_startup.py`, `test_database.py` under
`backend/tests/`. Individual node IDs, request stages and timings are retained
in each run's JSON/XML. `summary.json` retains numeric aggregates;
`failure-windows.json` retains timeout-specific joins. JUnit suite time and
runner time differ from rounded terminal Pytest duration; runner time includes
observer/import setup and finalization.

Compilation of application/tests/diagnostic Python passed. `pip check` returned
`No broken requirements found.` Worker startup tests passed with their existing
five-second test timeout. Worktree and staged `git diff --check` passed.

## E. Deployment implications

The PDF pipeline cannot yet be called stable on this host. Measured new failures
are in startup/import work, not PDF opening, Supabase or PyMuPDF extraction.
Resource pressure is a supported contributor; a specific Windows scheduler,
antivirus, filesystem or application bug is not proven. The historical
partial-write 400 remains specifically unresolved.

Windows specificity is **not established**: there is no new Linux measurement.
A future controlled Linux comparison with the same synthetic fixtures and
unchanged security limits would help distinguish host conditions from portable
worker behavior; a controlled lower-load Windows comparison would also be useful.
Neither Linux/Gunicorn verification nor any next deployment milestone was started.
Changing the five-second design bound would require separate evidence and
approval; no such change is proposed here.

## F. Safety and preservation

- Every new pytest run installed a real-socket connect/connect-ex denial guard.
  Existing fixtures reject non-SQLite SQLAlchemy connections. Supabase uses
  existing mocked transport; Gemini calls remain mocked. No real Supabase,
  Gemini or application PostgreSQL request was made.
- Only disposable SQLite databases and synthetic PDF fixtures were used. No
  application database mutations, cloud resources or system security/power
  changes occurred. No monitoring package or dependency was installed.
- No credentials, sessions, CSRF tokens or real document contents were recorded.
  Initial default Pytest failure formatting echoed synthetic fixture byte
  representations; these were removed from saved failure XML, PDF-bearing test
  parameter labels were sanitized, and the observer now suppresses fixture
  representations in future failure formatting. Retained worker sidecars contain
  no PDF bytes. Protected-file preservation checks record hashes only.
- `backend/.env`, application/test/migration/frontend source, requirements and all
  pre-existing work were preserved. The staged index hash remained identical;
  all **1,462 staged removals** remain backup-environment removals. See
  `baseline.json` and `preservation.json` for verification.
- No reset, clean, commit, push, deploy, Linux/Gunicorn verification or cloud
  resource operation occurred.

**Final verdict: PDF ROOT CAUSE UNRESOLVED.** No application fix was applied.
