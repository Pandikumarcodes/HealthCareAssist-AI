import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { resetApiSession } from "./services/api";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const session = () => ({
  user: { id: "demo", display_name: "Demo User" },
  csrf_token: "synthetic-session-csrf",
  expires_at: Date.now() / 1000 + 28800,
});
let authenticated: boolean;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
const clients: QueryClient[] = [];
function start(path = "/") {
  window.history.replaceState({}, "", path);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(<App client={client} />);
}
beforeEach(() => {
  authenticated = false;
  resetApiSession();
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url).split("?")[0];
    if (path === "/api/auth/me")
      return authenticated
        ? response(session())
        : response({ csrf_token: "synthetic-guest-csrf" }, 401);
    if (path === "/api/auth/login") {
      authenticated = true;
      return response(session());
    }
    if (path === "/api/auth/logout") {
      authenticated = false;
      return response({});
    }
    if (path === "/api/dashboard/summary")
      return response({
        total_requests: 0,
        open_requests: 0,
        in_progress_requests: 0,
        resolved_requests: 0,
      });
    if (path === "/api/requests" || path === "/api/documents")
      return response({
        data: [],
        page: 1,
        page_size: 20,
        total: 0,
        total_pages: 0,
      });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  resetApiSession();
  vi.unstubAllGlobals();
});

describe("workspace entry routing", () => {
  it("redirects guests from root to the existing login and removes the welcome UI", async () => {
    start();
    await screen.findByRole("heading", { name: "Welcome back" });
    expect(window.location.pathname).toBe("/login");
    expect(
      screen.queryByText(
        /Your workspace starts here|Backend availability|Backend connected|View connection status|Check connection|GET \/api\/health|A foundation for simpler/,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Open dashboard/ }),
    ).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/auth/me"]);
  });
  it("redirects a restored authenticated root session to the existing dashboard", async () => {
    authenticated = true;
    start();
    await screen.findByText("Summary loaded");
    expect(window.location.pathname).toBe("/dashboard");
    expect(
      screen.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "Demo sign in" }),
    ).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/health")).toBe(
      false,
    );
  });
  it.each([false, true])(
    "waits for root session bootstrap before choosing the destination (authenticated %s)",
    async (signedIn) => {
      let resolve!: (value: Response) => void;
      fetchMock.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      start();
      expect(window.location.pathname).toBe("/");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Checking your session",
      );
      expect(screen.queryByRole("form")).not.toBeInTheDocument();
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
      await act(async () =>
        resolve(
          signedIn
            ? response(session())
            : response({ csrf_token: "synthetic-guest-csrf" }, 401),
        ),
      );
      await waitFor(() =>
        expect(window.location.pathname).toBe(
          signedIn ? "/dashboard" : "/login",
        ),
      );
    },
  );
  it("keeps session errors at root until explicit recovery", async () => {
    fetchMock.mockResolvedValueOnce(response({}, 503));
    start();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to verify your session",
    );
    expect(window.location.pathname).toBe("/");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("form", { name: "Demo sign in" });
    expect(window.location.pathname).toBe("/login");
  });
  it("preserves a safe deep link including its query string and hash through login", async () => {
    start("/requests?status=OPEN#results");
    const form = await screen.findByRole("form", { name: "Demo sign in" });
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "fictional-reviewer" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "synthetic-input-only" },
    });
    fireEvent.submit(form);
    await screen.findByRole("heading", { name: "Support Requests", level: 1 });
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/requests?status=OPEN#results");
  });
  it.each([false, true])(
    "preserves public 404 without a bootstrap or redirect (authenticated %s)",
    async (signedIn) => {
      authenticated = signedIn;
      start("/missing-page");
      expect(
        screen.getByRole("heading", { name: "Page not found" }),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("link", { name: "Return to workspace" }),
      );
      await waitFor(() =>
        expect(window.location.pathname).toBe(
          signedIn ? "/dashboard" : "/login",
        ),
      );
    },
  );
});
