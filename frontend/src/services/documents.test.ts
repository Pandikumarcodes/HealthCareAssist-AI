import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteDocument,
  getDocument,
  getDocuments,
  searchDocuments,
  uploadDocument,
} from "./documents";

const item = {
  id: 42,
  title: "Fictional policy",
  original_filename: "fictional.pdf",
  file_size: 2048,
  content_type: "application/pdf",
  created_at: "2026-10-23T10:00:00Z",
  processing_status: "INDEXED",
};
function mock(body: unknown, status = 200) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(status === 204 ? null : JSON.stringify(body), { status }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("document API contracts", () => {
  it("loads pagination and projects only safe metadata", async () => {
    const fetchMock = mock({
      data: [
        { ...item, stored_filename: "private.pdf", path: "/private/storage" },
      ],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });
    await expect(getDocuments({ page: 1, page_size: 20 })).resolves.toEqual({
      data: [item],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/documents?page=1&page_size=20",
    );
  });
  it("accepts empty and out-of-range pages", async () => {
    mock({ data: [], page: 4, page_size: 20, total: 0, total_pages: 0 });
    await expect(
      getDocuments({ page: 4, page_size: 20 }),
    ).resolves.toMatchObject({ data: [], total: 0 });
  });
  it.each([
    null,
    {},
    { data: [] },
    { data: { ...item, processing_status: "PROCESSING" } },
    { data: { ...item, created_at: "invalid" } },
    { data: { ...item, id: 0 } },
    { data: { ...item, file_size: 0 } },
    { data: { ...item, file_size: 5242881 } },
    { data: { ...item, content_type: "text/plain" } },
    { data: { ...item, title: "" } },
  ])("rejects invalid metadata %j", async (body) => {
    mock(body);
    await expect(getDocument("42")).rejects.toThrow(
      "Unexpected document API response",
    );
  });
  it.each(["UNPROCESSED", "INDEXED", "NO_TEXT", "FAILED"])(
    "accepts the actual %s outcome",
    async (processing_status) => {
      mock({ data: { ...item, processing_status } });
      await expect(getDocument("42")).resolves.toMatchObject({
        processing_status,
      });
    },
  );
  it("encodes IDs and forwards cancellation", async () => {
    const fetchMock = mock({ data: item });
    const controller = new AbortController();
    await getDocument("../health", controller.signal);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/documents/..%2Fhealth");
    controller.abort();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("uploads FormData without a manually supplied Content-Type and allows processing time", async () => {
    const fetchMock = mock({ data: item }, 201);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const file = new File(["fictional"], "fictional.pdf", {
      type: "application/pdf",
    });
    await expect(
      uploadDocument({ file, title: "  Fictional policy  " }),
    ).resolves.toEqual(item);
    const [path, options] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/documents");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get("file")).toBe(file);
    expect(options.body.get("title")).toBe("Fictional policy");
    expect(options.headers).toEqual({ Accept: "application/json" });
    expect(timeout).toHaveBeenCalledWith(30000);
  });
  it("omits a blank optional title to preserve the backend filename default", async () => {
    const fetchMock = mock({ data: item }, 201);
    await uploadDocument({
      file: new File(["fictional"], "fictional.pdf"),
      title: "   ",
    });
    expect(fetchMock.mock.calls[0][1].body.has("title")).toBe(false);
  });
  it("accepts empty 204 deletion without parsing JSON", async () => {
    const fetchMock = mock(null, 204);
    await expect(deleteDocument("42")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
  });
  it("keeps typed error statuses and hides raw server error text", async () => {
    mock(
      {
        error: "Secret /storage/path",
        details: { file: "Invalid PDF", other: null },
      },
      400,
    );
    await expect(
      uploadDocument({ file: new File(["fictional"], "fictional.pdf") }),
    ).rejects.toMatchObject({
      status: 400,
      details: { file: "Invalid PDF" },
      message: "API request failed (400)",
    });
  });
  it.each([{ total_pages: 2 }, { page: 2 }, { data: [] }, { page_size: 10 }])(
    "rejects inconsistent pagination %j",
    async (changes) => {
      mock({
        data: [item],
        page: 1,
        page_size: 20,
        total: 1,
        total_pages: 1,
        ...changes,
      });
      await expect(getDocuments({ page: 1, page_size: 20 })).rejects.toThrow(
        "Unexpected document API response",
      );
    },
  );
  it("encodes multi-term search, projects passages, preserves rank and forwards cancellation", async () => {
    const result = {
      document_id: 42,
      document_title: item.title,
      chunk_id: 5,
      page_number: 2,
      text: "Fictional coverage passage.",
      score: 0.4,
    };
    const fetchMock = mock({
      query: "annual & coverage",
      results: [{ ...result, path: "private" }],
    });
    const controller = new AbortController();
    await expect(
      searchDocuments(" annual & coverage ", 10, controller.signal),
    ).resolves.toEqual({ query: "annual & coverage", results: [result] });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/documents/search?q=annual+%26+coverage&limit=10",
    );
    controller.abort();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it.each([
    { query: "wrong", results: [] },
    { query: "coverage", results: [{}] },
    {
      query: "coverage",
      results: [
        {
          document_id: 1,
          document_title: "Fictional",
          chunk_id: 1,
          page_number: 0,
          text: "text",
          score: 0.2,
        },
      ],
    },
  ])("rejects malformed search responses %j", async (body) => {
    mock(body);
    await expect(searchDocuments("coverage", 10)).rejects.toThrow(
      "Unexpected document API response",
    );
  });
});
