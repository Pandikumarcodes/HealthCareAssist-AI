import { ApiError, apiRequest } from "./api";

export interface AiQuestion {
  question: string;
}
export interface AiSource {
  document_id: number;
  document_title: string;
  page_number: number;
  chunk_id: number;
}
export interface AiAnswer {
  answer: string;
  sources: AiSource[];
  grounded: boolean;
}
export const MAX_QUESTION_CHARACTERS = 1000;
export const questionLength = (value: string) =>
  Array.from(value.trim()).length;

export function questionError(value: string): string {
  const question = value.trim();
  if (!question) return "Enter a question about your uploaded documents.";
  if (questionLength(question) > MAX_QUESTION_CHARACTERS)
    return "Use at most 1000 characters.";
  if (
    Array.from(question).some((char) => {
      const code = char.codePointAt(0)!;
      return (
        (code < 32 && !"\n\r\t".includes(char)) ||
        code === 127 ||
        (code >= 0xd800 && code <= 0xdfff)
      );
    })
  )
    return "Remove invalid control or Unicode characters from your question.";
  return "";
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
const text = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim();
const invalid = (): never => {
  throw new Error("Unexpected AI API response");
};

export async function askAssistant(
  input: AiQuestion,
  signal?: AbortSignal,
): Promise<AiAnswer> {
  const validation = questionError(input.question);
  if (validation) throw new Error(validation);
  const body = await apiRequest("/api/ai/ask", {
    method: "POST",
    body: { question: input.question.trim() },
    signal,
    timeoutMs: 75000,
  });
  if (
    !object(body) ||
    !text(body.answer) ||
    typeof body.grounded !== "boolean" ||
    !Array.isArray(body.sources) ||
    body.sources.length > 5 ||
    (!body.grounded && body.sources.length > 0)
  )
    return invalid();
  const sources = body.sources.map((source: unknown): AiSource => {
    if (
      !object(source) ||
      !positive(source.document_id) ||
      !text(source.document_title) ||
      Array.from(source.document_title).length > 200 ||
      !positive(source.page_number) ||
      !positive(source.chunk_id)
    )
      return invalid();
    return {
      document_id: source.document_id,
      document_title: source.document_title,
      page_number: source.page_number,
      chunk_id: source.chunk_id,
    };
  });
  if (new Set(sources.map((source) => source.chunk_id)).size !== sources.length)
    return invalid();
  return { answer: body.answer, sources, grounded: body.grounded };
}

// Match both status and code; raw backend messages/details are never displayed.
export function aiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400)
      return "The question could not be accepted. Check the text and use at most 1000 characters, then send again.";
    if (error.status === 413)
      return "The question is too large. Shorten it and send again.";
    if (error.status === 429 && error.code === "ai_rate_limited")
      return "The AI service quota or rate limit was reached. Please try again later.";
    if (error.status === 504 && error.code === "ai_timeout")
      return "The AI service timed out. Please send your question again when you are ready.";
    if (error.status === 503) {
      if (
        [
          "ai_not_configured",
          "ai_configuration_error",
          "ai_credentials_rejected",
        ].includes(error.code ?? "")
      )
        return "The AI assistant is unavailable because its service configuration needs attention. Contact your workspace administrator.";
      if (error.code === "ai_model_unavailable")
        return "The configured AI model is unavailable. Please try again later.";
      if (error.code === "ai_unavailable")
        return "The AI service is temporarily unavailable. Please try again later.";
    }
    if (
      error.status === 502 &&
      ["ai_invalid_response", "ai_empty_response"].includes(error.code ?? "")
    )
      return "The AI service could not provide a usable answer. Please send your question again.";
    return "Unable to get an answer. Please try again later.";
  }
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "The request timed out. Please send your question again when you are ready.";
  return "Unable to get an answer. Check your connection and try again.";
}
