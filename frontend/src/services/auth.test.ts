import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, onUnauthorized, resetApiSession } from "./api";
import { getSession, login } from "./auth";

const session = {
  user: { id: "demo", display_name: "Demo User" },
  csrf_token: "synthetic-private-csrf",
  expires_at: Date.now() / 1000 + 28800,
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
afterEach(() => {
  resetApiSession();
  vi.unstubAllGlobals();
});

describe("auth HTTP and shared CSRF integration", () => {
  it("bootstraps guest CSRF and rotates it on login for every mutation including multipart", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ csrf_token: "synthetic-guest-csrf" }, 401),
      )
      .mockResolvedValueOnce(response(session))
      .mockImplementation(async () => response({}));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getSession()).toBeNull();
    await login("fictional-reviewer", "synthetic-input-only");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      credentials: "same-origin",
      headers: { "X-CSRF-Token": "synthetic-guest-csrf" },
    });
    for (const method of ["POST", "PATCH", "DELETE"] as const)
      await apiRequest("/api/requests/1", { method, body: {} });
    const body = new FormData();
    body.append(
      "file",
      new File(["synthetic"], "fictional.pdf", { type: "application/pdf" }),
    );
    await apiRequest("/api/documents", { method: "POST", body });
    for (const [, options] of fetchMock.mock.calls.slice(2))
      expect(options).toMatchObject({
        credentials: "same-origin",
        headers: { "X-CSRF-Token": session.csrf_token },
      });
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).not.toHaveProperty(
      "Content-Type",
    );
    expect(fetchMock.mock.calls.at(-1)?.[1]?.body).toBe(body);
  });
  it("notifies for private 401 and logout 401, while preserving 403 and invalid-login behavior", async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => response({}, 401)),
    );
    await getSession();
    await login("fictional", "synthetic").catch(() => {});
    expect(listener).not.toHaveBeenCalled();
    await apiRequest("/api/documents").catch(() => {});
    expect(listener).toHaveBeenCalledTimes(1);
    await apiRequest("/api/auth/logout", { method: "POST" }).catch(() => {});
    expect(listener).toHaveBeenCalledTimes(2);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => response({}, 403)),
    );
    await apiRequest("/api/documents").catch(() => {});
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
  it("aborts in-flight private operations and rejects late responses after session reset", async () => {
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = apiRequest("/api/documents");
    resetApiSession();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    resolve(response({ data: "Prior private data" }));
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
  it.each([
    {},
    { ...session, user: {} },
    { ...session, csrf_token: "" },
    { ...session, expires_at: "later" },
  ])("rejects invalid server session %j", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body)));
    await expect(getSession()).rejects.toThrow("Invalid session response");
  });
});
