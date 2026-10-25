import type { AiAnswer } from "../../services/ai";

// Synthetic document data only. Shared by HTTP and rendered interaction tests.
export const answerFixture: AiAnswer = {
  answer:
    'The uploaded fictional policies state:\n\n"Include an itemized receipt." [1]\n\n"Keep a copy of the claim form." [2]',
  sources: [
    {
      document_id: 42,
      document_title: "Fictional Receipt Policy",
      page_number: 7,
      chunk_id: 9,
    },
    {
      document_id: 12,
      document_title: "Fictional Claims Policy",
      page_number: 4,
      chunk_id: 5,
    },
  ],
  grounded: true,
};
export const AiErrorFixture = [
  { status: 400, code: undefined, expected: "Check the text" },
  { status: 413, code: undefined, expected: "too large" },
  { status: 429, code: "ai_rate_limited", expected: "quota or rate limit" },
  { status: 504, code: "ai_timeout", expected: "timed out" },
  {
    status: 503,
    code: "ai_not_configured",
    expected: "configuration needs attention",
  },
  {
    status: 503,
    code: "ai_configuration_error",
    expected: "configuration needs attention",
  },
  {
    status: 503,
    code: "ai_credentials_rejected",
    expected: "configuration needs attention",
  },
  {
    status: 503,
    code: "ai_model_unavailable",
    expected: "model is unavailable",
  },
  { status: 503, code: "ai_unavailable", expected: "temporarily unavailable" },
  {
    status: 502,
    code: "ai_provider_error",
    expected: "Unable to get an answer",
  },
  { status: 502, code: "ai_invalid_response", expected: "usable answer" },
  { status: 502, code: "ai_empty_response", expected: "usable answer" },
  { status: 500, code: undefined, expected: "Unable to get an answer" },
] as const;
