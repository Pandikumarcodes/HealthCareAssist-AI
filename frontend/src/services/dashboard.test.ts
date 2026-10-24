import { afterEach, describe, expect, it, vi } from "vitest";
import { getDashboardSummary } from "./dashboard";

const summary = {
  total_requests: 10,
  open_requests: 4,
  in_progress_requests: 5,
  resolved_requests: 1,
};
afterEach(() => vi.unstubAllGlobals());

function mockResponse(body: unknown) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("dashboard API service", () => {
  it("uses the shared client, correct endpoint, and supplied abort signal", async () => {
    const fetchMock = mockResponse(summary);
    const controller = new AbortController();
    await expect(getDashboardSummary(controller.signal)).resolves.toEqual(
      summary,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/summary",
      expect.objectContaining({
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
    const requestSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    controller.abort();
    expect(requestSignal.aborted).toBe(true);
  });

  it("accepts a valid all-zero response", async () => {
    const empty = {
      total_requests: 0,
      open_requests: 0,
      in_progress_requests: 0,
      resolved_requests: 0,
    };
    mockResponse(empty);
    await expect(getDashboardSummary()).resolves.toEqual(empty);
  });

  it.each([
    null,
    {},
    { ...summary, total_requests: "10" },
    { ...summary, open_requests: -1 },
    { ...summary, in_progress_requests: 1.5 },
    { total_requests: 10, open_requests: 4, in_progress_requests: 5 },
    { ...summary, total_requests: 11 },
    { ...summary, total_requests: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects malformed or inconsistent summary %j", async (body) => {
    mockResponse(body);
    await expect(getDashboardSummary()).rejects.toThrow(
      "Unexpected dashboard response",
    );
  });

  it("rejects an HTTP failure rather than returning zeros", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 503 })),
    );
    await expect(getDashboardSummary()).rejects.toThrow("503");
  });

  it("propagates a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(getDashboardSummary()).rejects.toThrow("Failed to fetch");
  });

  it("rejects invalid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invalid")));
    await expect(getDashboardSummary()).rejects.toThrow();
  });
});
