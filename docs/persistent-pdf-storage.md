# Persistent private PDF storage

Status: adapter implemented and verified offline; **cloud verification pending**.
No Supabase project/bucket was created or contacted. No deployment, live Gemini
request, real database mutation, credential changes, commit or push occurred.

## Architecture and schema

`PDF_STORAGE_BACKEND=local` is the default. Existing local filesystem upload,
exclusive creation, private-directory checks, rollback and staged deletion remain
in `app/documents.py`. `DOCUMENT_UPLOAD_DIR` still resolves relative paths against
`backend/`. Development startup scripts and frontend contracts are unchanged.

`PDF_STORAGE_BACKEND=supabase` uses a small REST adapter in `app/pdf_storage.py`.
The existing HTTPX client (already used directly by `app/gemini.py` and installed
through google-genai) is reused, with its compatible version range now explicitly
declared. No Supabase database/auth SDK or new installed library is required.

The existing 36-character `Document.stored_filename` holds a backend-generated
32-character lowercase UUID hex plus `.pdf`. This is also the exact object key;
original filenames never form storage paths. No model or migration changes.
Metadata, chunks, PostgreSQL full-text search and AI citation IDs remain in the
application database. APIs return existing metadata only, never storage URLs.

Storage selection is global, not per record. Existing documents must have their
PDFs copied privately to the selected backend under the **same keys**, with byte
integrity verified, before switching an existing database. Changing the mode or
bucket does not migrate files. Such transfer requires a separately authorized
operation; no transfer tool or record changes are included here. An unavailable
Supabase object never falls back to local disk.

## Required environment variables

| Variable | Local | Supabase |
| --- | --- | --- |
| `PDF_STORAGE_BACKEND` | `local` (default) | `supabase` |
| `DOCUMENT_UPLOAD_DIR` | Private local PDF directory | Not the authoritative store |
| `SUPABASE_URL` | Unused | Hosted HTTPS project origin, `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | Unused | Current server-side `sb_secret_…` key |
| `SUPABASE_STORAGE_BUCKET` | Unused | Exact private bucket ID using lowercase letters, digits, `_` or `-` |

Unknown modes, missing credentials, publishable/legacy keys, unsafe bucket names,
non-HTTPS URLs, arbitrary domains and URLs containing paths/userinfo fail at app
creation. Custom domains/self-hosted Supabase are deliberately unsupported by
this focused adapter. The actual `backend/.env` was not edited. Example settings
contain empty placeholders only.

Server secret keys authenticate through the `apikey` header. They never enter
Vite, browser requests, API payloads or application logs. No bearer user session,
public URL, signed URL or browser Supabase client is created.

## Manual private bucket setup (later, after authorization)

1. In the intended Supabase project, manually create a Storage bucket with a safe
   bucket ID. Keep the **Public bucket** option disabled. Limit files to
   `application/pdf` and at most 5 MiB. Check the project's storage/egress quotas.
2. Do not add anonymous/publishable upload or download policies. No browser access
   is required. Do not expose this bucket through any separate public file host.
3. Obtain a current server secret key privately from the project API-key settings;
   keep it in a server secret store. Never paste it into the repository. A secret
   key bypasses RLS and has broad project access: use a dedicated project where
   practical and restrict who can access its keys. The adapter rejects publishable
   keys and legacy JWT keys rather than guessing their roles.
4. Later, set the four Supabase-mode variables in Render's private environment
   settings. Keep existing Neon/authentication/Gemini settings unchanged. Do not
   set any `VITE_SUPABASE_*` variables. Ensure existing PDF objects have been
   transferred and verified before switching an existing database.
5. With separate authorization, test a synthetic PDF upload, indexing, retry,
   search/citations and deletion; restart/redeploy the service and confirm the
   PDF remains retrievable. Also confirm unauthenticated bucket access fails.
   Those live checks have **not** been performed.

Every adapter operation reads bucket metadata and rejects public buckets before
accessing an object. This detects configuration mistakes, but cannot prevent an
administrator changing the bucket to public afterward. Keep bucket permissions
private operationally; application checks cannot revoke already published data.

## Upload and processing lifecycle

The existing Flask authentication and CSRF hooks run before multipart handling.
Filename, multipart, byte-size, PDF structure and subprocess validation are
unchanged. Only validated bytes are uploaded. New UUID keys use POST with
`x-upsert=false`, so collisions never overwrite existing objects. There is no
automatic retry. An unconfirmed upload fails the request before metadata is
created, and its key is logged for reconciliation because a lost acknowledgement
may still mean the provider persisted it. A rejected collision is never deleted.

After saving, normal metadata creation and indexing continue. Supabase retrieval
uses the authenticated object endpoint, bounds decompressed content to 5 MiB and
rejects empty/failed/redirect responses. A private temporary directory holds the
downloaded PDF only while the existing extraction subprocess runs. The file is
closed before worker startup for Windows compatibility. Context cleanup runs on
success and failure. The object remains the authoritative copy; no persistent
local cache is used.

The existing parser's memory/CPU/page/text/output limits, chunking, worker imports
and deadlines are unchanged. The adapter and HTTPX are not imported by disposable
parser workers. Extraction failures retain the durable PDF and the existing
`FAILED` status/retry contract. Storage retrieval failures propagate instead of
being mistaken for parser failures: upload metadata/chunks roll back and cleanup
is attempted. A later CLI processing retry also leaves the previous DB state
intact on storage failure.

Definite database upload failures compensate by deleting only the new key.
Existing lost-commit-acknowledgement checks preserve objects when persistence is
confirmed or uncertain. Failed compensation returns an error and logs the key;
it may leave an orphan requiring reconciliation. Process termination between
save and DB commit can also leave an orphan. No background reconciler is included.

## Deletion and transaction limits

Local staged-file deletion is unchanged. For Supabase, validate the exact stored
UUID key, delete metadata and related chunks in the existing database transaction,
then remove that single object. A failed DB commit preserves the object. If the
commit acknowledgement is lost, verify metadata absence before deleting; if that
verification fails, preserve the object and report failure.

Successful remote deletion returns the existing HTTP 204. Supabase's remove API
also succeeds for already absent objects. Remote errors never become successful
responses. If remote removal fails **after** DB commit, return the existing
sanitized HTTP 500 and log the UUID for reconciliation. Metadata/chunks have
already been removed in this case; repeating the document DELETE can return 404.
This deliberately favors retaining a recoverable PDF over deleting it before a
possibly failed database transaction. There is no distributed transaction or
durable deletion queue in this milestone.

For reconciliation, a trusted operator must compare logged keys and private bucket
objects against `documents.stored_filename` in the correct database. Allow for
in-flight uploads/transactions; never bulk-delete solely by object age. Confirm
DB non-persistence before removing an orphan through the private Storage API.
Do not log document bytes, original filenames, titles, connection URLs or keys.
The key in reconciliation logs is an internal storage identifier, not a secret
credential or a public download URL.

## Network and security boundaries

HTTPX verifies TLS, ignores environment proxies, disables redirects, and uses
5-second connect and 10-second read/write/pool timeouts. Streamed responses are
size bounded (16 KiB bucket metadata, 5 MiB PDF), with a 20-second streaming
deadline checked between chunks. Timeouts are per network operation; they are
not a hard process-level deadline for DNS or the entire multi-request workflow.
No unbounded retry loop exists. Provider response bodies/errors and credential
headers are never included in API errors or application diagnostics. External
HTTP debug logging and process-level secret dumps must stay disabled.

Authentication, CSRF, Origin enforcement, API error envelopes and Gemini model
configuration are unchanged. Supabase credentials have elevated privileges, so
server compromise remains a risk even with a private bucket. Temporary data can
survive an abrupt process termination until the host clears temporary storage;
it is not an authoritative copy. Use fictional portfolio documents only.

## Offline verification

From repository root with backend dependencies available:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest -q backend/tests/test_pdf_storage.py
.\backend\.venv\Scripts\python.exe -m pytest -q
.\backend\.venv\Scripts\python.exe -m compileall -q backend/app backend/tests
.\backend\.venv\Scripts\python.exe -m pip check
```

Supabase HTTP traffic uses HTTPX MockTransport in the new tests; unmocked HTTP and
Gemini client creation are forbidden there. Existing test fixtures reject all
non-SQLite connections and create only disposable databases. Coverage includes
configuration, local default, auth/CSRF, valid/invalid PDFs, private buckets,
unique keys/collisions, safe paths, network failure, bounded retrieval/tempfile
cleanup, actual PDF extraction, compensation, ambiguous commits, deletion and AI
citation compatibility. Existing tests have not been weakened.

Offline results: all 40 new storage tests passed in both full-suite runs; the
final combined storage/worker/production/database-configuration check passed
67 tests. Existing PDF upload/deletion tests passed 89/89 in isolation, and
PDF-processing tests passed 54/54 in isolation. Compilation and `pip check`
passed; existing HTTPX 0.28.1 satisfies the explicit requirement.

Each of two full backend runs ended with 548 passed and one different existing
local PDF-upload failure. The first explicitly hit the unchanged five-second
validation deadline; the second exact-size test returned HTTP 400 without a
diagnostic assertion. Both passed in the isolated 89-test run. No PDF limit or
existing test was changed. A clean single full-suite run remains a release
verification blocker; rerun on an idle host. Full details are recorded in
[the Render preparation report](render-deployment-preparation.md).
Frontend checks are not rerun because frontend files and shared API contracts
are unchanged. Real cloud persistence and Linux/Gunicorn verification remain
separate, pending milestones.

## Official references consulted

- [Storage bucket access models](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Current server secret keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Upload](https://supabase.com/docs/reference/python/storage-from-upload),
  [download](https://supabase.com/docs/reference/python/storage-from-download), and
  [remove](https://supabase.com/docs/reference/python/storage-from-remove) operation contracts
- Supabase Storage REST route definitions for
  [upload](https://github.com/supabase/storage/blob/master/src/http/routes/object/createObject.ts),
  [authenticated download](https://github.com/supabase/storage/blob/master/src/http/routes/object/getObject.ts), and
  [exact-key removal](https://github.com/supabase/storage/blob/master/src/http/routes/object/deleteObjects.ts)
