import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../../app/authenticated-test-app";

beforeEach(() => {
  window.history.replaceState({}, "", "/dashboard");
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockImplementation(
        async (url) =>
          new Response(
            JSON.stringify(
              String(url).includes("/dashboard/")
                ? {
                    total_requests: 0,
                    open_requests: 0,
                    in_progress_requests: 0,
                    resolved_requests: 0,
                  }
                : {
                    data: [],
                    page: 1,
                    page_size: 20,
                    total: 0,
                    total_pages: 0,
                  },
            ),
          ),
      ),
  );
});
afterEach(() => vi.unstubAllGlobals());

it("places focus in main on entry and after navigation, without stealing form focus on updates", async () => {
  render(<App />);
  expect(screen.getByRole("main")).toHaveFocus();
  const link = screen.getByRole("link", { name: "Support Requests" });
  link.focus();
  fireEvent.click(link);
  await screen.findByRole("heading", { level: 1, name: "Support Requests" });
  expect(screen.getByRole("main")).toHaveFocus();
  const search = screen.getByRole("searchbox");
  search.focus();
  fireEvent.change(search, { target: { value: "fictional" } });
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "0 matching requests loaded.",
    ),
  );
  expect(search).toHaveFocus();
});

it("closes expanded navigation with Escape and restores focus to its toggle", () => {
  render(<App />);
  const menu = screen.getByRole("button", { name: "Open navigation" });
  fireEvent.click(menu);
  const link = screen.getByRole("link", { name: "Knowledge Base" });
  link.focus();
  fireEvent.keyDown(link, { key: "Escape" });
  expect(menu).toHaveAttribute("aria-expanded", "false");
  expect(menu).toHaveFocus();
  expect(document.getElementById("workspace-navigation")).not.toHaveClass(
    "is-open",
  );
});
