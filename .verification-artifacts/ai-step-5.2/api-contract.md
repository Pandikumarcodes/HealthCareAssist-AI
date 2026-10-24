# Verified before frontend implementation

Read `backend/app/routes/ai.py`, `backend/app/ai_assistant.py`, `backend/app/gemini.py`, and `backend/tests/test_ai.py` on 2026-10-24.

- POST `/api/ai/ask`, JSON `{ "question": string }`. No optional fields; extra fields are rejected.
- Nonblank after trimming; Python length at most 1000 before backend trimming; allows LF, CR and tab, rejects other ASCII controls, DEL, and lone Unicode surrogates. Body at most 16 KiB. Frontend trims before sending and counts Unicode code points in that transmitted string.
- HTTP 200: `{ "answer": string, "sources": Source[], "grounded": boolean }`.
- Source: `{ "document_id": positive integer, "document_title": nonblank string (at most 200 code points), "page_number": positive integer, "chunk_id": positive integer }`. Ordered by first occurrence in answer; at most five distinct chunks.
- No supported context: HTTP 200, `{ "answer": "I couldn't find this information in the uploaded documents.", "sources": [], "grounded": false }`. May also represent provider abstention or rejected evidence; do not assert the library is empty.
- Validation: 400 `{ "error": "Invalid input.", "details": { "question"?: string, "body"?: string } }`; malformed JSON/content type also 400. Oversized body: 413 `{ "error": "AI requests must be at most 16 KiB." }`.
- Provider failures: `{ "error": server-owned string, "code": string }`.
  - 429 `ai_rate_limited`
  - 504 `ai_timeout`
  - 503 `ai_not_configured`, `ai_configuration_error`, `ai_credentials_rejected`, `ai_model_unavailable`, `ai_unavailable`
  - 502 `ai_provider_error`, `ai_invalid_response`, `ai_empty_response`
- Unexpected backend/database failure: 500 `{ "error": "AI assistant operation failed. Please try again." }`.
- Existing shared client uses configured VITE_API_BASE_URL and fetch, AbortSignal, ApiError status/details; extend normalized errors with code only, never display raw error payloads.
- Existing Knowledge Base destination `/knowledge-base/:id` displays metadata/processing outcome. Link to these details; no PDF/page preview endpoint exists.
- Existing TanStack Query mutation convention supports `retry: false`. Use this explicitly. Backend provider timeout is configurable through 60 seconds; allow 75 seconds for this request instead of shared 10-second default.
- No history fields, streaming, sessions, authentication, or additional endpoints. All integration checks must mock HTTP, with no live Gemini calls or database changes.
