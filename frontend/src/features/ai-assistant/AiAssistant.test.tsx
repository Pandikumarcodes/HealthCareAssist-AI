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
import { AiErrorFixture, answerFixture } from "./test-fixtures";

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}
function renderPage() {
  window.history.replaceState({}, "", "/ai-assistant");
  return render(<App />);
}
function input() {
  return screen.getByRole("textbox", { name: "Your question" });
}
function type(value = "What does the fictional claims policy require?") {
  fireEvent.change(input(), { target: { value } });
}
function send() {
  fireEvent.submit(screen.getByRole("form", { name: "Ask the AI Assistant" }));
}
async function answered() {
  await screen.findByText(answerFixture.answer, {
    normalizer: (value) => value,
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Send question" }),
    ).toBeDisabled(),
  );
}
beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(answerFixture));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AI Assistant chat interactions with mocked HTTP", () => {
  it("renders direct navigation, empty guidance and accessible controls without making a request", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: "AI Assistant", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "AI Assistant" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("heading", { name: "What would you like to find?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Each question is independent/),
    ).toBeInTheDocument();
    expect(input()).toHaveAccessibleDescription(/Enter to send/);
    expect(
      screen.getByRole("button", { name: "Send question" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear chat" })).toBeDisabled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(
      screen.getByRole("region", { name: "Conversation" }),
    ).not.toHaveAttribute("aria-live");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("opens from workspace navigation and closes the mobile menu", () => {
    window.history.replaceState({}, "", "/requests/new");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("link", { name: "AI Assistant" }));
    expect(window.location.pathname).toBe("/ai-assistant");
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("heading", { name: "AI Assistant", level: 1 }),
    ).toBeInTheDocument();
  });
  it.each(["", " \n\t ", "x".repeat(1001), "invalid\x00question"])(
    "blocks invalid questions and describes the error %j",
    (value) => {
      renderPage();
      type(value);
      send();
      expect(
        screen.getByRole("button", { name: "Send question" }),
      ).toBeDisabled();
      expect(input()).toHaveAttribute("aria-invalid", "true");
      expect(input()).toHaveAttribute(
        "aria-describedby",
        "ai-question-help ai-question-error",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it("submits the trimmed payload, renders the answer and ordered citations, clears the composer and keeps focus", async () => {
    renderPage();
    type("  Fictional claims? \n");
    send();
    await answered();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ai/ask");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ question: "Fictional claims?" }),
    );
    expect(
      screen.getByRole("article", { name: "Your question" }),
    ).toHaveTextContent("Fictional claims?");
    const sources = screen.getByRole("region", { name: "Answer sources" });
    expect(
      within(sources)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(answerFixture.sources.map((source) => source.document_title));
    expect(
      within(sources).getByRole("link", { name: "Fictional Receipt Policy" }),
    ).toHaveAttribute("href", "/knowledge-base/42");
    expect(within(sources).getByText("Page 7")).toBeInTheDocument();
    expect(within(sources).getByText("Page 4")).toBeInTheDocument();
    expect(input()).toHaveValue("");
    expect(input()).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Answer ready. 2 sources available.",
    );
  });
  it("shows loading, prevents same-tick duplicate submissions and keeps the composer focused", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderPage();
    type();
    act(() => {
      send();
      send();
      fireEvent.keyDown(input(), { key: "Enter" });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(
      screen.getByText("Preparing an answer from your documents..."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Preparing an answer");
    expect(
      screen.getByRole("button", { name: "Preparing answer..." }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear chat" })).toBeDisabled();
    expect(input()).toHaveAttribute("readonly");
    expect(input()).toHaveFocus();
    resolve(response(answerFixture));
    await answered();
    expect(
      screen.getAllByRole("article", { name: "Assistant response" }),
    ).toHaveLength(1);
  });
  it("keeps sequential questions paired, preserves prior answers and sends no history", async () => {
    renderPage();
    type("First fictional question?");
    send();
    await answered();
    fetchMock.mockResolvedValueOnce(
      response({ ...answerFixture, answer: "Second fictional answer." }),
    );
    type("Second fictional question?");
    send();
    expect(
      await screen.findByText("Second fictional answer."),
    ).toBeInTheDocument();
    const questions = screen.getAllByRole("article", { name: "Your question" });
    expect(questions.map((question) => question.textContent)).toEqual([
      "YouFirst fictional question?",
      "YouSecond fictional question?",
    ]);
    expect(
      screen.getByText(answerFixture.answer, { normalizer: (value) => value }),
    ).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      question: "Second fictional question?",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("preserves local history during rerenders", async () => {
    const view = renderPage();
    type();
    send();
    await answered();
    view.rerender(<App />);
    expect(
      screen.getByText(answerFixture.answer, { normalizer: (value) => value }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("uses Enter to submit and Shift+Enter permits a newline", async () => {
    renderPage();
    type("Fictional first line");
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(input(), event);
    expect(event.defaultPrevented).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    type("Fictional first line\nFictional second line");
    fireEvent.keyDown(input(), { key: "Enter" });
    await answered();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      question: "Fictional first line\nFictional second line",
    });
  });
  it("does not submit an IME composition Enter", () => {
    renderPage();
    type();
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("renders the actual no-context answer with Knowledge Base guidance", async () => {
    const answer =
      "I couldn't find this information in the uploaded documents.";
    fetchMock.mockResolvedValueOnce(
      response({ answer, sources: [], grounded: false }),
    );
    renderPage();
    type();
    send();
    expect(await screen.findByText(answer)).toBeInTheDocument();
    expect(screen.getByText("No supported answer")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Answer sources" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Review or upload relevant fictional documents/),
    ).toBeInTheDocument();
  });
  it("renders a valid answer with no citations without inventing sources", async () => {
    fetchMock.mockResolvedValueOnce(
      response({ ...answerFixture, sources: [] }),
    );
    renderPage();
    type();
    send();
    await answered();
    expect(
      screen.queryByRole("region", { name: "Answer sources" }),
    ).not.toBeInTheDocument();
  });
  it.each(AiErrorFixture)(
    "renders sanitized HTTP $status / $code errors, retaining the question for correction",
    async ({ status, code, expected }) => {
      fetchMock.mockResolvedValueOnce(
        response(
          {
            error: "SECRET diagnostics",
            details: { question: "SECRET validation" },
            code,
          },
          status,
        ),
      );
      renderPage();
      type();
      send();
      expect(await screen.findByRole("alert")).toHaveTextContent(expected);
      expect(
        screen.getByRole("article", { name: "Request failed" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(answerFixture.answer, {
          normalizer: (value) => value,
        }),
      ).not.toBeInTheDocument();
      expect(document.body).not.toHaveTextContent("SECRET");
      expect(input()).toHaveValue(
        "What does the fictional claims policy require?",
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Send question" }),
        ).toBeEnabled(),
      );
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );
  it("allows correction and resubmission after failure without automatic retries", async () => {
    fetchMock.mockRejectedValueOnce(
      new TypeError("SECRET network information"),
    );
    renderPage();
    type();
    send();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check your connection",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    type("Corrected fictional question?");
    send();
    await answered();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText(answerFixture.answer, { normalizer: (value) => value }),
    ).toBeInTheDocument();
  });
  it("treats malformed successes as failures, without fake assistant answers", async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        answer: "Unverified response",
        sources: null,
        grounded: true,
      }),
    );
    renderPage();
    type();
    send();
    await screen.findByRole("alert");
    expect(screen.queryByText("Unverified response")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("renders untrusted answer, question and source text literally without HTML execution", async () => {
    const malicious =
      '<img src=x onerror="window.aiInjected=true"><script>alert(1)</script>';
    fetchMock.mockResolvedValueOnce(
      response({
        ...answerFixture,
        answer: malicious,
        sources: [{ ...answerFixture.sources[0], document_title: malicious }],
      }),
    );
    renderPage();
    type(malicious);
    send();
    await waitFor(() => expect(screen.getAllByText(malicious)).toHaveLength(3));
    expect(document.querySelector(".ai-chat img, .ai-chat script")).toBeNull();
    expect(screen.getByRole("link", { name: malicious })).toHaveAttribute(
      "href",
      "/knowledge-base/42",
    );
  });
  it("clears only local history and returns focus to the composer without an HTTP call", async () => {
    renderPage();
    type();
    send();
    await answered();
    fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    expect(
      screen.queryByText(answerFixture.answer, {
        normalizer: (value) => value,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("What would you like to find?"),
    ).toBeInTheDocument();
    expect(input()).toHaveFocus();
    expect(input()).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Chat cleared.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("aborts the request when leaving the page and ignores a late response", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderPage();
    type();
    send();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const signal = fetchMock.mock.calls[0][1]?.signal;
    fireEvent.click(screen.getByRole("link", { name: "Support Requests" }));
    expect(signal?.aborted).toBe(true);
    resolve(response(answerFixture));
    await act(async () => {});
    fireEvent.click(screen.getByRole("link", { name: "AI Assistant" }));
    expect(
      screen.queryByText(answerFixture.answer, {
        normalizer: (value) => value,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("What would you like to find?"),
    ).toBeInTheDocument();
  });
});
