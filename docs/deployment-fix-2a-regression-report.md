# Deployment Fix 2A — intermittent PDF regression investigation

Date: 28 October 2026. Verdict: **STORAGE REGRESSION NOT VERIFIED**.

One complete backend run passed, but the immediate sequential confirmation run
failed three existing local-upload tests. No application, fixture, assertion,
timeout, dependency, migration, or frontend correction was justified or applied.
The failures remain a regression-stability blocker.

## A. Root cause and evidence

### Historical failures supplied with this task

The existing [storage report](persistent-pdf-storage.md) and
[deployment preparation report](render-deployment-preparation.md) identify:

| Historical run | Test in `backend/tests/test_documents.py` | Expected | Reported actual |
| --- | --- | --- | --- |
| 548 passed / 1 failed, first | `test_duplicate_original_names_have_unique_internal_names` | Two HTTP 201 uploads; unique stored names | HTTP 400 with the five-second structure-validation timeout response |
| 548 passed / 1 failed, second | `test_exact_size_limit_with_multipart_allowance` | HTTP 201 at 5 MiB, HTTP 413 above the limits | HTTP 400 for the exact-size upload; inner rejection reason not captured |

The original two runs' raw XML/log reports were not located in the project,
its sibling verification directory, or the temporary locations searched. The
root failure cache was empty when read. Their original tracebacks, actual order,
per-test timing and total execution times therefore cannot be recovered from
the available evidence. A location request received no answer. These are
secondary report findings, not newly inspected historical tracebacks. The
originals reportedly had two existing SQLite/Alembic warnings. No common cause
for **both** historical failures can be confirmed from those summaries alone.

### New complete-run evidence

Both fresh runs collected the same 549 tests in the same order. The two historical
failures passed in both, at positions 288 and 291. The second fresh run failed:

| Position | Test in `backend/tests/test_documents.py` | Actual traceback / expected behavior | Call / total test seconds |
| --- | --- | --- | --- |
| 331 | `test_partial_write_is_cleaned_up` | Line 398: `AssertionError: assert 400 == 500`; valid upload rejected before expected partial-write error response | 7.01 / 9.157 |
| 334 | `test_storage_failure_preserves_existing_document[delete]` | Line 413 → helper line 63: `assert 400 == 201`; initial upload explicitly returned structure-validation timeout | 5.27 / 10.534 |
| 335 | `test_failed_final_purge_keeps_isolated_recoverable_file` | Line 430 → helper line 63: `assert 400 == 201`; initial upload explicitly returned structure-validation timeout | 5.40 / 7.850 |

The two confirmed timeout responses were:

```json
{"error":"Invalid input.","details":{"file":"The PDF structure could not be validated within the time limit."}}
```

`app/documents.py` maps `subprocess.TimeoutExpired` from its unchanged five-second
`app.pdf_validation` call to this response. Those failures precede storage and
extraction. The partial-write test did not assert the response JSON, so its
specific HTTP 400 cause remains unconfirmed; its timing alone does not prove a
timeout. Its disk-failure mock is not evidence of a real disk failure.

The raw [second-run XML](../.verification-artifacts/deployment-fix-2a/full-second.xml)
retains complete failure tracebacks and captured setup output.
[test-summary.json](../.verification-artifacts/deployment-fix-2a/test-summary.json)
retains ordinal positions, adjacent test names, durations and tracebacks. Position
331 followed `test_unverifiable_delete_commit_preserves_backup`; position 334
followed `test_storage_failure_preserves_existing_document[upload]`; position 335
followed position 334. Supabase test execution comes later in the full suite.

### Startup, parsing, isolation and host findings

- The prior Step 5.1A defect involved eager web/ORM imports before worker limits.
  Its lazy factory/configuration correction remains present. Supabase configuration
  validation is inside `create_app()`, never package startup. HTTPX is imported
  only inside the adapter's network method. Disposable workers do not import it.
- Twelve synthetic fresh-process probes passed with the existing five-second
  validation and ten-second extraction deadlines and actual resource protection.
  Validation wall time was **0.304–0.725 s**, including three 5 MiB inputs;
  extraction was **0.261–0.359 s**. Validation module import took
  **0.0039–0.0076 s**; extraction module import took **0.0353–0.0432 s**.
  Parser/resource-limit work and child CPU times are recorded separately in
  [worker-probes.json](../.verification-artifacts/deployment-fix-2a/worker-probes.json).
  No Flask, ORM, migrations, dotenv, Google, HTTPX, HTTPCore, Supabase, or
  `app.pdf_storage` modules were loaded at the measured worker-import boundary.
- Structure validation uses **pypdf**. **PyMuPDF** loads inside the extraction
  worker after resource protection. The two confirmed HTTP 400 timeouts occur
  before PyMuPDF extraction, so PyMuPDF startup is not their failing operation.
- A full-suite pass took **122.62 s**; confirmation took **433.76 s**. Summed
  JUnit test times rose beyond PDF tests: AI **14.584 → 40.115 s**, support
  requests **28.928 → 84.839 s**, and auth **4.815 → 12.194 s**. PDF-upload tests
  rose **36.231 → 189.069 s**. Unrelated fixture setup reached **13.37 s**.
  This establishes broader slowdown, not a proven OS-level explanation.
- Before the failed run, a host snapshot recorded **373 processes**, about
  **0.83 GiB free / 7.69 GiB physical memory**, **34% CPU**, and processor queue
  length **0**. It did not show CPU saturation at that instant. No concurrent
  backend suites were launched. The attempted later counter capture was
  interrupted and produced no failure-time resource report. Paging, antivirus,
  disk contention and Windows scheduling cannot be identified as the cause.
- Fixtures create per-test SQLite databases/upload directories, remove sessions
  and dispose engines. Monkeypatch contexts restore filesystem/process mocks;
  the new storage adapter has no persistent worker or backend-selection cache.
  Remote retrieval closes its temporary file before extraction and uses a
  context-managed temporary directory. Existing cleanup tests passed.
- A diagnostic order reversal ran all 40 storage tests **before** the two
  historical failing cases, the three newly failing cases, the upload variant
  of the storage-failure case, and both startup tests. **48 passed**. Environment
  names changed after teardown: **none across all 48 tests**. Actual local
  validator subprocesses exited successfully in **0.739–1.668 s**, retaining
  `timeout=5`. Expected API assertions remained unchanged. This found no mock
  or environment leakage in the exercised sequence.
- The initial diagnostic observer assumed every subprocess used `-m`, causing
  two harness `ValueError` failures for startup tests that use `-c` (46 passed,
  2 harness failures, 45.71 s). The observer was corrected; application tests
  were untouched. Both the original diagnostic report and corrected 48-pass
  report are retained under separate names.

Confirmed failure mechanism: valid local uploads can exhaust the existing
validation deadline during a slow full run. Exact inner delay and common cause
of all historical/new rejections remain unresolved. Broad environmental slowdown
is supported; specific resource exhaustion or a storage-adapter defect is not
proven. The five-second limit is a legitimate fail-closed application bound;
these real endpoint failures cannot simply be dismissed as harmless test noise.

## B. Changes and preserved functionality

No production or existing test file changed in this task. No timeout was raised,
assertion weakened, test skipped/deleted, migration changed, or dependency added.
No new application regression test was added because no corrective application
change was established. Repeated green reruns are not used to erase the failure.

Added this report and `.verification-artifacts/deployment-fix-2a/`:

- `preservation.py`, `baseline.json`, `preservation.json`: hash/index comparison.
- `probe_workers.py`, `worker-probes.json`, `host-resources.json`: offline
  timing/import and host evidence.
- `trace_tests.py`, `traced-events.json`, `traced-rerun.xml`,
  `traced-final-events.json`, `traced-final.xml`: original/corrected observer
  evidence, without document contents, provider credentials or request headers.
- `targeted.xml`, `full-first.xml`, `full-second.xml`, `summarize_reports.py`,
  `test-summary.json`: actual test outcomes and retained failures/order/timing.
- `checks.py`, `checks.json`: compilation, dependencies and whitespace checks.

Local/Supabase storage, PDF limits and validation, subprocess resource protection,
auth/CSRF, metadata/error contracts, indexing/search and citation handling remain
unchanged. The pre-existing storage/deployment work remains intact.

## C. Targeted tests

Using `backend/.venv/Scripts/python.exe`, from repository root:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest -q backend/tests/test_documents.py backend/tests/test_document_processing.py backend/tests/test_pdf_storage.py backend/tests/test_pdf_worker_startup.py backend/tests/test_database.py --junitxml=.verification-artifacts/deployment-fix-2a/targeted.xml --durations=15
```

| Area | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| PDF upload/deletion, including both historical failures | 89 | 0 | 0 |
| PDF processing / Knowledge Base | 54 | 0 | 0 |
| Local/Supabase storage, storage configuration and citation compatibility | 40 | 0 | 0 |
| Worker import/startup | 2 | 0 | 0 |
| Database configuration | 19 | 0 | 0 |
| Combined | **204** | **0** | **0** |

Combined duration: **124.81 s**, two existing warnings. Corrected diagnostic
order-reversal run: **48 passed, 0 failed, 0 skipped**, **48.05 s**, no warnings.
Passing focused runs do not establish full-suite stability.

## D. Full regression and additional checks

The documented `python -m pytest -q` command ran twice sequentially using the
required backend interpreter, unchanged discovery/settings and no worker-count
option. Only `--junitxml` and `--durations=15` added report output.

| Run | Collected | Passed | Failed | Skipped | Warnings | Pytest elapsed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| First complete run | 549 | **549** | 0 | 0 | 2 | **122.62 s** |
| Second complete run | 549 | **546** | **3** | 0 | 2 | **433.76 s** |

XML suite durations are 122.185 s and 432.814 s respectively; they exclude some
pytest reporting overhead. Each run passed all 40 storage, 54 processing, 104 AI,
59 auth and 2 startup tests. Both historical failing upload tests passed twice.

The two warnings concern SQLite/SQLAlchemy's inability to reflect PostgreSQL
expression index `ix_document_chunks_search` during Alembic metadata comparison,
in `test_additive_chunk_migration_preserves_existing_metadata` and
`test_document_migration_is_additive_and_matches_model`. They were not suppressed.

Python compilation of `backend/app` and `backend/tests`: **passed**.
`python -m pip check`: **passed**, no broken requirements.
`git diff --check` and `git diff --cached --check`: **passed**.
Frontend tests were not rerun; frontend source is unchanged.

## E. Safety and preservation

The baseline records hashes, not credential contents. Final comparison confirms:

- Supabase adapter, every existing backend application/test file, dependencies,
  existing documentation, migrations and frontend source are byte-identical to
  the start of this task. The only additional file in the compared source/docs
  trees is this new report.
- `backend/.env` and its example are byte-identical. No secrets were printed or
  introduced into source; artifacts use synthetic inputs and sanitized outputs.
- All **1,462 staged backup-environment removals** remain unchanged, with the
  same staged-diff hash. No staging, reset, clean, commit or push was performed.
- Tests permitted only disposable SQLite connections through the existing
  SQLAlchemy guard. No application PostgreSQL connection or mutation occurred.
- Supabase storage tests used HTTPX MockTransport and forbidden unmocked HTTP;
  Gemini boundaries were mocked. No real Supabase or Gemini calls occurred.
- Passing offline tests cover local upload/delete, remote temp-file cleanup,
  Knowledge Base processing, search/citation contracts, authentication and CSRF.
  They do not establish live PostgreSQL retrieval or cloud behavior.
- No cloud resources, deployment, Linux/Gunicorn verification, or unrelated
  frontend work was undertaken.

## F. Remaining blockers

Two consecutive full backend passes were **not** achieved. Preserve the failed
run and investigate a recurrence with worker-stage and host scheduling/paging/I/O
telemetry captured at the same instant. The original two raw failure reports are
also missing, limiting historical causal diagnosis. No blind deadline increase
or unrelated code change is justified by this evidence.

## G. Final verdict

**STORAGE REGRESSION NOT VERIFIED**.

The focused storage/processing checks pass, but the complete-suite confirmation
failed. No claim of regression stability or proven application correction is made.
