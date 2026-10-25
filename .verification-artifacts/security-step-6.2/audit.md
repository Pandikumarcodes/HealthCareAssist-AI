# Pre-edit audit — Step 6.2

Baseline working tree clean. Inspected Step 6.1/authentication and Step 5.1a/5.2 reports; factory/config/auth, every registered API, storage/PDF/retrieval/provider code and existing tests; router, auth/HTTP client, all main pages, dialogs, lists, styles and frontend tests.

| Issue | Severity | Component | Evidence | Minimal fix | Regression risk |
| --- | --- | --- | --- | --- | --- |
| Malformed Unicode reaches UTF-8 credential encoding | MEDIUM | Login | Four regression cases reproduce UnicodeEncodeError | Reject lone surrogates before hashing/comparison; retain 400 envelope | Low; valid Unicode unchanged |
| Deeply nested JSON escapes validation | MEDIUM | Login | Regression case reproduces RecursionError with 2.2 KiB body | Catch parser recursion using current invalid-input response | Low |
| No route focus placement | MEDIUM | Shared layout | No route effect; mobile link disappears on close while focused | Focus main on pathname change; stable main handles asynchronous headings | Medium; avoid refocusing query updates |
| No Escape close/focus return for expanded navigation | MEDIUM | Mobile navigation | Only toggle and link click close it | Escape closes disclosure and returns focus to toggle | Low; preserve nonmodal disclosure behavior |
| Search error not described by invalid field | MEDIUM | Knowledge Base | aria-describedby references help alone | Conditional error ID association | Low |
| Backend upload field errors do not receive focus | MEDIUM | PDF upload form | Catch sets errors while fieldset disabled, with no post-render focus | Focus first invalid field after pending ends | Low |
| Low contrast sidebar text | MEDIUM | Sidebar note | Computed 4.15:1 on #f0f6f3 | Existing #5b706d yields 4.82:1 | Low; retain palette |
| Low contrast form boundaries | MEDIUM | Login, filters, forms, secondary buttons | #bdcfc6/#cbdad4 on white measure 1.63:1/1.45:1 | #7d948b yields 3.24:1 | Low |
| Clipped content with 200% text | MEDIUM | Login, AI actions and sidebar brand | At 320px login card extends left and AI buttons extend right; enlarged desktop brand overlaps workspace | Flexible grid track, brand/button wrapping; minimum input heights | Low |
| Short standalone link targets | LOW | Back links, sidebar welcome, KB details, AI KB link | Browser bounds below 24px high | 24px minimum height within existing components | Low |
| API lacks explicit nosniff/referrer headers | LOW | API response hook | Only Cache-Control/Vary set | Add compatibility-safe API headers; document SPA hosting responsibility | Low |
| No shared throttling/per-session revocation | MEDIUM architectural limitation | Demo auth | Signed-cookie sessions; no limiter/store | Document production gate; no new auth architecture | None |
| Hosts/TLS/proxy/CSP/frame policy unverified | MEDIUM deployment requirement | Hosting | No verified deployment architecture/hostname | Document required verification; do not guess config | None |

No discovered authorization bypass, SQL injection, unsafe HTML rendering, citation fabrication bypass, credential exposure or PDF path traversal. Existing tests cover authentication/expiry/CSRF, transactions/path validation, parser deadlines, bound SQL and AI output validation. No code changes justified in those areas.
