import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { getHealth } from "./services/health";

vi.mock("./services/health", () => ({ getHealth: vi.fn() }));
const health = {
  status: "healthy",
  service: "HealthCareAssist AI",
  version: "1.0.0",
} as const;

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  vi.mocked(getHealth).mockReset();
});

describe("welcome and backend connection", () => {
  it("renders the welcome screen", async () => {
    vi.mocked(getHealth).mockResolvedValue(health);
    render(<App />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Welcome to HealthCareAssist AI/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A foundation for simpler, more connected healthcare support.",
      ),
    ).toBeInTheDocument();
    await screen.findByText("Backend connected");
  });

  it("shows a loading state while the request is pending", () => {
    vi.mocked(getHealth).mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking backend connection…",
    );
    expect(
      screen.getByRole("button", { name: /Check connection/ }),
    ).toBeDisabled();
  });

  it("shows the connected service and version", async () => {
    vi.mocked(getHealth).mockResolvedValue(health);
    render(<App />);
    expect(await screen.findByText("Backend connected")).toBeInTheDocument();
    expect(screen.getAllByRole("definition")).toHaveLength(2);
    expect(screen.getByText("1.0.0")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(health.service);
  });

  it("shows actionable guidance when the backend fails", async () => {
    vi.mocked(getHealth).mockRejectedValue(new TypeError("Failed to fetch"));
    render(<App />);
    expect(await screen.findByText("Backend unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Start the Flask backend/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeEnabled();
  });

  it("retries a failed connection successfully", async () => {
    vi.mocked(getHealth)
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(health);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("Backend connected")).toBeInTheDocument();
    expect(getHealth).toHaveBeenCalledTimes(2);
  });
});
