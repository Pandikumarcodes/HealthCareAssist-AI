import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiErrorFixture,
  answerFixture,
} from "../features/ai-assistant/test-fixtures";
import {
  aiErrorMessage,
  askAssistant,
  questionError,
  questionLength,
} from "./ai";
import { ApiError } from "./api";

function mock(body: unknown, status = 200) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AI HTTP contract", () => {
  it("posts only a trimmed question, preserves source order and drops extra fields", async () => {
    const fetchMock = mock({ ...answerFixture, internal: "private" });
    await expect(
      askAssistant({ question: "  Fictional claims?\n " }),
    ).resolves.toEqual(answerFixture);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ai/ask");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ question: "Fictional claims?" }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  });
  it("forwards cancellation and allows the backend maximum provider timeout", async () => {
    const fetchMock = mock(answerFixture);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const controller = new AbortController();
    await askAssistant({ question: "Fictional policy?" }, controller.signal);
    expect(timeout).toHaveBeenCalledWith(75000);
    controller.abort();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("accepts no-context and empty source arrays", async () => {
    const empty = {
      answer: "I couldn't find this information in the uploaded documents.",
      sources: [],
      grounded: false,
    };
    mock(empty);
    await expect(askAssistant({ question: "?" })).resolves.toEqual(empty);
    mock({ ...answerFixture, sources: [] });
    await expect(askAssistant({ question: "?" })).resolves.toMatchObject({
      sources: [],
    });
  });
  it.each([
    null,
    {},
    { ...answerFixture, answer: "" },
    { ...answerFixture, answer: 3 },
    { ...answerFixture, grounded: "true" },
    { ...answerFixture, sources: null },
    { ...answerFixture, sources: [{}] },
    { ...answerFixture, grounded: false },
    {
      ...answerFixture,
      sources: [answerFixture.sources[0], answerFixture.sources[0]],
    },
    {
      ...answerFixture,
      sources: Array.from({ length: 6 }, (_, i) => ({
        ...answerFixture.sources[0],
        chunk_id: i + 1,
      })),
    },
    ...["document_id", "chunk_id", "page_number"].map((key) => ({
      ...answerFixture,
      sources: [{ ...answerFixture.sources[0], [key]: 0 }],
    })),
    {
      ...answerFixture,
      sources: [{ ...answerFixture.sources[0], document_title: "" }],
    },
    {
      ...answerFixture,
      sources: [
        { ...answerFixture.sources[0], document_title: "x".repeat(201) },
      ],
    },
  ])("rejects malformed success bodies %j", async (body) => {
    mock(body);
    await expect(
      askAssistant({ question: "Fictional policy?" }),
    ).rejects.toThrow("Unexpected AI API response");
  });
  it.each(AiErrorFixture)(
    "normalizes HTTP $status / $code without retaining raw provider messages",
    async ({ status, code, expected }) => {
      mock({ error: "SECRET provider diagnostic", code }, status);
      const error = await askAssistant({ question: "Fictional policy?" }).catch(
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status, code });
      expect(aiErrorMessage(error)).toContain(expected);
      expect(JSON.stringify(error)).not.toContain("SECRET");
    },
  );
  it("distinguishes unknown 429 responses from the verified quota code", () => {
    expect(aiErrorMessage(new ApiError(429))).not.toContain("quota");
    expect(aiErrorMessage(new ApiError(400, {}, "ai_rate_limited"))).toContain(
      "Check the text",
    );
    expect(aiErrorMessage(new ApiError(500, {}, "ai_timeout"))).not.toContain(
      "timed out",
    );
  });
  it("handles non-JSON errors, malformed JSON successes and network failures safely", async () => {
    const fetchMock = mock(null);
    fetchMock.mockResolvedValueOnce(
      new Response("upstream PRIVATE", { status: 503 }),
    );
    await expect(askAssistant({ question: "?" })).rejects.toMatchObject({
      status: 503,
      code: undefined,
    });
    fetchMock.mockResolvedValueOnce(new Response("PRIVATE"));
    await expect(askAssistant({ question: "?" })).rejects.toThrow();
    fetchMock.mockRejectedValueOnce(new TypeError("PRIVATE"));
    const error = await askAssistant({ question: "?" }).catch(
      (failure: unknown) => failure,
    );
    expect(aiErrorMessage(error)).toContain("Check your connection");
    expect(
      aiErrorMessage(new DOMException("PRIVATE", "TimeoutError")),
    ).toContain("request timed out");
  });
});

describe("backend-compatible transmitted question validation", () => {
  it.each([
    "",
    " \n\t ",
    "x".repeat(1001),
    "bad\x00input",
    "bad\x7finput",
    "bad\ud800input",
  ])("rejects invalid input before HTTP %j", async (question) => {
    const fetchMock = mock(answerFixture);
    expect(questionError(question)).not.toBe("");
    await expect(askAssistant({ question })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("counts Unicode code points as Python does, permits newline/tab and trims before transmission", async () => {
    expect(questionLength(" 🩺 ")).toBe(1);
    expect(questionError("🩺".repeat(1000))).toBe("");
    expect(questionError("🩺".repeat(1001))).toBe(
      "Use at most 1000 characters.",
    );
    expect(questionError("a\nb\r\tc")).toBe("");
    const fetchMock = mock(answerFixture);
    await askAssistant({ question: "  " + "x".repeat(1000) + "  " });
    expect(
      JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).question,
    ).toHaveLength(1000);
  });
});
