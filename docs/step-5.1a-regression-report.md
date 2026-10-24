# Step 5.1A implementation report

Verified 24 October 2026. Scope: PDF regression diagnosis and repair, backend regression testing, and read-only Gemini eligibility assessment. Step 5.2 was not started.

## A. Root cause and evidence

The confirmed production defect was unnecessary application startup in disposable PDF workers. Running `python -m app.pdf_validation` or `app.pdf_extraction` first executes `app/__init__.py`. Although Gemini was already lazy-loaded, this initializer still imported Flask, SQLAlchemy, Flask-Migrate/Alembic, routes, models, and document services. The extraction worker also imports `app.config` for `BACKEND_DIRECTORY`; configuration previously imported SQLAlchemy and dotenv eagerly. These imports consumed the existing worker deadlines before PDF parsing and before worker resource protection was installed.

The initial PDF-only reproduction produced **19 failures, 124 passes, two warnings in 286.32 seconds**. Eighteen failures involved valid uploads returning HTTP 400 before storage/transaction behavior could be exercised. Helper assertions captured this response:

```json
{
  "error": "Invalid input.",
  "details": {
    "file": "The PDF structure could not be validated within the time limit."
  }
}
```

The upload validator maps `subprocess.TimeoutExpired` at its five-second deadline to that response. Tests expecting HTTP 201 therefore failed with `AssertionError`; fault-injection tests expecting HTTP 500 were intercepted by validation and received 400. A deletion test raised `KeyError: 'data'` after trying to use the failed upload response. One extraction retry remained `FAILED` instead of `INDEXED`; its 11.75-second call and sanitized processing warnings support deadline exhaustion, but the underlying extraction exception was not retained, so its precise inner exception is unconfirmed.

The exact historical **15** test IDs could not be recovered: the supplied historical report contained counts, the available previous verification JSON recorded 429 passes, and the accessible backend pytest cache was empty. They must not be equated with a newly observed failure set. All **19 reproduced IDs** are recorded in [reproduced-failures.json](../.verification-artifacts/ai-step-5.1a/reproduced-failures.json), and all subsequently passed.

The failures were timing-sensitive rather than deterministic PDF rejection. Three previously failing tests passed in a pre-fix traced rerun. Five standalone pre-fix probes measured **0.903–1.170 seconds** importing the application, versus **0.135–0.305 seconds** performing validation, including parser import. Import traces identify the unused web/ORM/migration stack. After the fix, equivalent imports took **0.0040–0.0055 seconds** and whole validation subprocesses took **0.334–0.438 seconds**.

A first post-fix full run still had nine validation timeouts (422 passes, 293.67 seconds). Its fixture setup also occasionally took 5–11 seconds. Those nine tests then passed in isolation in 8.85 seconds, with traced workers taking approximately 0.27–0.35 seconds. Two subsequent uninstrumented full runs passed consecutively. This establishes a substantial startup improvement and passing final regressions; it does **not** prove the exact operating-system cause of the earlier transient delays or guarantee immunity to host contention. No timeout was increased to conceal them.

There was no evidence requiring changes to stream consumption, signatures, MIME handling, PDF parsing rules, exception contracts, chunking, database transactions, or dependency versions.

## B. Files changed

Production and regression-test files:

| Path                                       | Reason                                                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/app/__init__.py`                  | Import Flask and application dependencies inside `create_app()`; postpone type-annotation evaluation so workers can import the package without Flask.       |
| `backend/app/config.py`                    | Import dotenv and SQLAlchemy's URL helper only when `local_configuration()` is called.                                                                      |
| `backend/tests/test_pdf_worker_startup.py` | Add one fresh-process import-boundary regression test for each PDF worker. An audit hook rejects transitive web, ORM, migration, dotenv, or Google imports. |
| `docs/step-5.1a-regression-report.md`      | This report.                                                                                                                                                |

Verification artifacts are under `.verification-artifacts/ai-step-5.1a/`:

- `diagnose_workers.py`, `trace_pdf_tests.py`, `verify_local.py`: offline diagnostic and preservation scripts.
- `preservation-before.json`, `local-verification.json`, `reproduced-failures.json`: hashes, secret-safe checks, and reproduced test IDs.
- `worker-timings-before.json`, `worker-timings-after.json`, `validation-importtime.txt`, `pytest-worker-timings.json`, `worker-import-0.txt` through `worker-import-6.txt`: baseline probes and traces.
- `trace-after/pytest-worker-timings.json`, `trace-after/worker-import-0.txt` through `worker-import-20.txt`: diagnostic rerun of the nine intermediate failures.
- `pdf-tests.xml`, `traced-failures.xml`, `backend-tests-first.xml`, `backend-tests.xml`, `backend-tests-confirmation.xml`: test reports, including the intermediate failure rather than only passing runs.

No frontend, migration, dependency, environment, parser, storage, retrieval, or AI implementation file changed.

## C. Fix details and preserved behavior

The factory still loads the same configuration, initializes the same extension instances, registers the same blueprints and CLI commands, and returns the same Flask application. The change removes those imports from worker initialization. Configuration values and environment precedence are unchanged.

The five-second validation deadline, ten-second extraction deadline, 512 MiB memory quota, eight-second CPU quota, Windows active-process limit, five-MiB upload limit, multipart limits, malformed/encrypted/pageless PDF rejection, extraction bounds, chunk bounds, private storage, and transaction/cleanup behavior remain unchanged. Both workers still install resource protection before importing their PDF parser. The new tests check the import dependency boundary rather than asserting a fragile performance threshold.

## D. Test results

The existing Python 3.11.9 virtual environment was used. The sandbox could not access its base interpreter, so execution used approved access outside the sandbox; the environment was not rebuilt. Installed PyMuPDF is 1.28.2, pypdf 6.21.2, pytest 9.1.1, and google-genai 2.33.0. No packages changed.

| Run                                   |             Collected/run | Passed | Failed | Skipped | Warnings |     Time |
| ------------------------------------- | ------------------------: | -----: | -----: | ------: | -------: | -------: |
| Initial PDF reproduction              |                       143 |    124 |     19 |       0 |        2 | 286.32 s |
| PDF tests plus new startup checks     |                       145 |    145 |      0 |       0 |        2 | 130.84 s |
| First post-fix full backend run       |                       431 |    422 |      9 |       0 |        2 | 293.67 s |
| Isolated traced rerun of those nine   | 9 selected; 80 deselected |      9 |      0 |       0 |        0 |   8.85 s |
| Final uninstrumented full backend run |                       431 |    431 |      0 |       0 |        2 |  47.29 s |
| Uninstrumented confirmation run       |                       431 |    431 |      0 |       0 |        2 |  47.66 s |

Both final full runs include **104 passing AI tests**. The total increased from 429 to 431 because of the two worker startup cases. No tests were skipped, removed, weakened, or marked expected failures. Existing PDF timeout, malicious/invalid input, size-limit, extraction, chunking, search-contract, migration, retry, transaction, and cleanup tests passed.

Commands used the established `python -m pytest -q` suite, with JUnit output and optional diagnostic verbosity/duration flags. `python -m compileall -q backend/app backend/tests`, `python -m pip check`, and the final `git diff --check` passed. No backend lint/type tool is configured, and none was introduced. Frontend tests were not rerun because frontend files and contracts did not change.

Both warnings are the existing Alembic/SQLAlchemy SQLite reflection limitation for PostgreSQL expression index `ix_document_chunks_search`, emitted by the two migration/model-comparison tests. SQLite cannot reflect that PostgreSQL expression index, so autogeneration does not compare it. They do not require changing production index behavior or suppressing warnings in this milestone. PostgreSQL SQL compilation, parameter binding, ranking, indexed-status filters, and API result mapping are tested; **live PostgreSQL search integration was not rerun**, because no configured disposable PostgreSQL test database was established.

## E. Gemini access

| Check                                                                      | Result                           |
| -------------------------------------------------------------------------- | -------------------------------- |
| Exact configured model `gemini-3.5-flash-lite`                             | YES                              |
| SDK installed as google-genai 2.33.0                                       | YES                              |
| SDK construction/serialization and mocked errors                           | YES, covered by passing AI tests |
| Key loaded on backend; configured key absent from inspected frontend files | YES                              |
| Specific key-owning project's Free Tier                                    | UNVERIFIED                       |
| Paid billing disabled for that project                                     | UNVERIFIED                       |
| Exact model available to that project                                      | UNVERIFIED                       |
| Nonzero active model rate limits                                           | UNVERIFIED                       |
| Remaining quota for one minimal request                                    | UNVERIFIED                       |
| Live Gemini requests                                                       | **NO — zero**                    |

The local check emitted only booleans and the SDK version; no key or database credentials were printed. The normal test factory ignores local keys. AI tests replace the SDK boundary; real SDK serialization cases use an in-memory mock HTTP transport. Client configuration uses the exact configured model, `vertexai=False`, explicit backend credentials, a bounded timeout/output limit, one attempt, disabled automatic function calling, and no tools or fallback model. Provider errors are sanitized.

Official documentation identifies the exact [model code](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite). The [pricing page](https://ai.google.dev/gemini-api/docs/pricing) lists free input/output for it, but this does not prove this project's eligibility. [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) are project-specific and must be checked in AI Studio. The [billing documentation](https://ai.google.dev/gemini-api/docs/billing) distinguishes the Free Tier from projects linked to paid billing.

Read-only account inspection was unavailable: browser inventory failed twice, and the native helper could not initialize (`CreateProcessWithLogonW failed: 2`). No authentication, project, billing, or key changes were attempted.

Next manual action:

1. Open [AI Studio](https://aistudio.google.com/) in the account owning the existing key. Identify the existing key privately using its masked identifier and select its associated project. Do not reveal or copy the key into chat.
2. Confirm that exact project displays Free Tier and has no active paid billing linkage. If paid billing is enabled, stop; do not upgrade, switch keys, or change billing as part of this task.
3. Inspect that project's model list and active limits for `gemini-3.5-flash-lite`. Confirm availability, nonzero RPM/TPM/daily limits, and enough unused allowance for one short request across every applicable quota.
4. Record those results without credentials. Model metadata or the existence of a key alone is insufficient.

Only after all checks and a later explicit authorization, the proposed smoke test is one direct SDK generation request: model `gemini-3.5-flash-lite`, synthetic prompt `Reply with the word FICTIONAL.`, maximum 128 output tokens, a ten-second timeout, one attempt, no tools/grounding/function calls, and no model fallback. Stop on any provider error. It must not use upload endpoints, retrieval, or PostgreSQL writes. This procedure was **not executed** and is separately gated.

## F. Safety and preservation

- Initial Git status was clean. A 1,570-file SHA-256 snapshot (tracked files plus `backend/.env`) verifies that only the two intended production files changed among those existing files; none went missing. New test/report/artifacts are separately listed above.
- All mutating database fixtures use temporary SQLite files; other test apps use in-memory SQLite. PostgreSQL configuration tests inspect URLs/compile SQL or mock connections. No application or unrelated PostgreSQL database was accessed or modified, and no database reset or destructive PostgreSQL command ran.
- No application document was created. Synthetic PDFs and disposable test storage were used exclusively.
- `backend/.env` is unchanged; credentials were never printed, copied to artifacts, or sent to a provider. No dependencies were added or updated.
- Frontend and migrations retain their baseline hashes. AI endpoint code and public contracts are unchanged.
- HEAD remains `2267fe92d27e206685951c2faa86dfc0f7033d41`. No commit, push, deployment, reset, clean, or discard occurred.

## G. Final verdict

**READY FOR STEP 5.2**, based on two consecutive complete passing backend runs and healthy AI mock tests. The earlier intermediate timeout failures are retained as a timing caveat; the exact host-level delay was not proven. Live Gemini project access, billing status, and remaining model quota remain **UNVERIFIED** and separately gated. This is not a production-readiness claim. Step 5.2 was not implemented.
