import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../app/authenticated-test-app";
import type {
  RequestListParameters,
  RequestListResponse,
  SupportRequest,
} from "../../services/requests";

const item: SupportRequest = {
  id: 42,
  title: "Coverage clarification",
  description: "Private description must stay hidden",
  category: "COVERAGE",
  status: "OPEN",
  created_at: "2026-10-23T10:00:00Z",
  updated_at: "2026-10-23T11:00:00Z",
};
const empty: RequestListResponse = {
  data: [],
  page: 1,
  page_size: 20,
  total: 0,
  total_pages: 0,
};
const populated: RequestListResponse = {
  ...empty,
  data: [item],
  total: 1,
  total_pages: 1,
};
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function response(body: unknown) {
  return new Response(JSON.stringify(body));
}
function requestParameters(index = fetchMock.mock.calls.length - 1) {
  return Object.fromEntries(
    new URL(String(fetchMock.mock.calls[index][0]), "http://localhost")
      .searchParams,
  );
}
function mockList(
  handler: (parameters: RequestListParameters) => RequestListResponse,
) {
  fetchMock.mockImplementation(async (input) => {
    const query = new URL(String(input), "http://localhost").searchParams;
    return response(
      handler({
        page: Number(query.get("page")),
        page_size: Number(query.get("page_size")),
        status: query.get("status") as RequestListParameters["status"],
        category: query.get("category") as RequestListParameters["category"],
        q: query.get("q") ?? undefined,
      }),
    );
  });
}
async function loaded() {
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(/loaded/),
  );
}
function table() {
  return screen.getByRole("table");
}

beforeEach(() => {
  window.history.replaceState({}, "", "/requests");
  fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(populated));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("support requests list", () => {
  it("renders the direct route in the existing layout with the active navigation", async () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Support Requests", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Support Requests" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: "Knowledge Base" }),
    ).toHaveAttribute("href", "/knowledge-base");
    expect(screen.getByRole("link", { name: "AI Assistant" })).toHaveAttribute(
      "href",
      "/ai-assistant",
    );
    await loaded();
    expect(requestParameters()).toEqual({ page: "1", page_size: "20" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps fields, preserves server order and timestamps, and omits descriptions", async () => {
    fetchMock.mockResolvedValue(
      response({
        ...populated,
        data: [
          item,
          {
            ...item,
            id: 7,
            title: "Older request",
            category: "GENERAL",
            status: "RESOLVED",
          },
        ],
        total: 2,
      }),
    );
    render(<App />);
    await loaded();
    const rows = within(table()).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("#42Coverage clarificationCoverageOpen");
    expect(rows[2]).toHaveTextContent("#7Older requestGeneralResolved");
    const times = rows[1].querySelectorAll("time");
    expect(times[0]).toHaveAttribute("datetime", item.created_at);
    expect(times[1]).toHaveAttribute("datetime", item.updated_at);
    expect(times[0]).toHaveTextContent(
      new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(item.created_at)),
    );
    expect(screen.queryByText(item.description)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /create|edit|delete|change status/i,
      }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["OPEN", "Open"],
    ["IN_PROGRESS", "In Progress"],
    ["RESOLVED", "Resolved"],
  ] as const)(
    "displays the %s badge in both table and cards",
    async (status, label) => {
      fetchMock.mockResolvedValue(
        response({ ...populated, data: [{ ...item, status }] }),
      );
      render(<App />);
      await loaded();
      expect(within(table()).getByText(label)).toHaveClass(
        `status-${status.toLowerCase()}`,
      );
      expect(
        within(
          screen.getByRole("list", { name: /Healthcare support requests/ }),
        ).getByText(label),
      ).toBeInTheDocument();
    },
  );

  it("distinguishes an empty database and disables both pagination boundaries", async () => {
    fetchMock.mockResolvedValue(response(empty));
    render(<App />);
    expect(
      await screen.findByText("No support requests yet."),
    ).toBeInTheDocument();
    expect(screen.getByText("0 total requests")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Clear all filters" }),
    ).not.toBeInTheDocument();
  });

  it("announces initial loading without false empty or zero data", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading support requests",
    );
    expect(
      screen.getByRole("region", { name: "Support request results" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.queryByText("No support requests yet."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/0 total requests/)).not.toBeInTheDocument();
  });

  it.each([400, 500, 503])(
    "handles HTTP %s and retries explicitly without exposing error details",
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "Secret internal details" }), {
            status,
          }),
        )
        .mockResolvedValue(response(populated));
      render(<App />);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Unable to load support requests",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByText(
          /Secret internal details|0 total requests|No support requests yet/,
        ),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await loaded();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("handles a backend network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check your connection",
    );
    expect(
      screen.queryByText("No support requests yet."),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["Status", "IN_PROGRESS", "status"],
    ["Category", "APPOINTMENT", "category"],
  ])(
    "applies the %s filter using backend enum values",
    async (label, value, parameter) => {
      mockList(() => empty);
      render(<App />);
      await loaded();
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      await waitFor(() => expect(requestParameters()[parameter]).toBe(value));
      expect(
        await screen.findByText("No requests match your filters."),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("No support requests yet."),
      ).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Clear all filters" }),
      );
      expect(
        await screen.findByText("No support requests yet."),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(label)).toHaveValue("");
    },
  );

  it("combines status, category, and debounced search, then clears search independently", async () => {
    mockList(() => empty);
    render(<App />);
    await loaded();
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "OPEN" },
    });
    await loaded();
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "CLAIMS" },
    });
    await loaded();
    fireEvent.change(screen.getByLabelText("Search requests"), {
      target: { value: "  policy  " },
    });
    await waitFor(() =>
      expect(requestParameters()).toEqual({
        page: "1",
        page_size: "20",
        status: "OPEN",
        category: "CLAIMS",
        q: "policy",
      }),
    );
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() =>
      expect(requestParameters()).toEqual({
        page: "1",
        page_size: "20",
        status: "OPEN",
        category: "CLAIMS",
      }),
    );
    expect(screen.getByLabelText("Search requests")).toHaveValue("");
  });

  it("debounces rapid typing and cancels an outdated in-flight query", async () => {
    render(<App />);
    await loaded();
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("Search requests"), {
      target: { value: "pol" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    fireEvent.change(screen.getByLabelText("Search requests"), {
      target: { value: "policy" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(349);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const oldSignal = fetchMock.mock.calls[1][1]?.signal;
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "COVERAGE" },
    });
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(requestParameters()).toMatchObject({
      q: "policy",
      category: "COVERAGE",
    });
  });

  it("keeps prior rows during pagination, disables controls while fetching, and honors boundaries", async () => {
    let resolveNext!: (value: Response) => void;
    fetchMock
      .mockResolvedValueOnce(
        response({
          ...populated,
          data: Array.from({ length: 20 }, (_, index) => ({
            ...item,
            id: 100 - index,
            title: `Request ${index}`,
          })),
          total: 21,
          total_pages: 2,
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNext = resolve;
          }),
      );
    render(<App />);
    await loaded();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("status")).toHaveTextContent("Updating requests");
    expect(within(table()).getByText("Request 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await waitFor(() => expect(requestParameters().page).toBe("2"));
    resolveNext(response({ ...populated, page: 2, total: 21, total_pages: 2 }));
    await loaded();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("21 total requests")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await loaded();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["Status", "Category", "Search requests"])(
    "resets page to 1 when %s changes on page 2",
    async (label) => {
      mockList((parameters) => ({
        ...empty,
        page: parameters.page,
        data: Array.from(
          { length: parameters.page === 1 ? 20 : 1 },
          (_, index) => ({ ...item, id: 100 - index }),
        ),
        total: 21,
        total_pages: 2,
      }));
      render(<App />);
      await loaded();
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await loaded();
      expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(label), {
        target: {
          value:
            label === "Status"
              ? "RESOLVED"
              : label === "Category"
                ? "GENERAL"
                : "policy",
        },
      });
      await waitFor(() => expect(requestParameters().page).toBe("1"));
      await loaded();
      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
      expect(
        fetchMock.mock.calls.map((_, index) => requestParameters(index).page),
      ).toEqual(["1", "2", "1"]);
    },
  );

  it("recovers when the server reports that the requested page no longer exists", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          ...populated,
          data: Array.from({ length: 20 }, (_, index) => ({
            ...item,
            id: 100 - index,
          })),
          total: 21,
          total_pages: 2,
        }),
      )
      .mockResolvedValueOnce(response({ ...populated, page: 2, data: [] }))
      .mockResolvedValueOnce(response(populated));
    render(<App />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await loaded();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    expect(
      screen.queryByText("No support requests yet."),
    ).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.map((_, index) => requestParameters(index).page),
    ).toEqual(["1", "2", "1"]);
  });

  it("replaces retained pagination data with an error if loading the next page fails", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          ...populated,
          data: Array.from({ length: 20 }, (_, index) => ({
            ...item,
            id: index + 1,
          })),
          total: 21,
          total_pages: 2,
        }),
      )
      .mockRejectedValueOnce(new Error("Offline"));
    render(<App />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("21 total requests")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No support requests yet."),
    ).not.toBeInTheDocument();
  });

  it("navigates from Dashboard through the mobile menu and closes navigation", async () => {
    window.history.replaceState({}, "", "/dashboard");
    fetchMock.mockImplementation(async (url) =>
      response(
        String(url).includes("/dashboard/")
          ? {
              total_requests: 0,
              open_requests: 0,
              in_progress_requests: 0,
              resolved_requests: 0,
            }
          : populated,
      ),
    );
    render(<App />);
    await screen.findByText("Summary loaded");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("link", { name: "Support Requests" }));
    await loaded();
    expect(
      screen.getByRole("heading", { name: "Support Requests", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("workspace-navigation")).not.toHaveClass(
      "is-open",
    );
  });
});
