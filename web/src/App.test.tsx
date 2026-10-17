import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { BrowserCheck } from "./components/BrowserCheck";
import { checkBrowser } from "./components/features";

describe("BrowserCheck", () => {
  it("says what this browser lacks and what to do", () => {
    render(<App />);
    // jsdom is not cross-origin isolated, so the check screen is what shows
    expect(screen.getByText("This browser can't run the game yet")).toBeInTheDocument();
    const alerts = screen.getAllByRole("alert");
    const threads = alerts.find((a) => a.textContent?.includes("Threads (SharedArrayBuffer)"));
    expect(threads).toHaveTextContent("is required");
    expect(threads).toHaveTextContent("cross-origin isolated");
  });

  it("lists a missing optional feature as missing, not required", () => {
    const requirements = checkBrowser({
      crossOriginIsolated: true,
      SharedArrayBuffer,
      navigator: {},
    });
    render(<BrowserCheck requirements={requirements} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Private file storage (OPFS)");
    expect(alert).toHaveTextContent("is missing");
    expect(alert).not.toHaveTextContent("is required");
  });
});

describe("App", () => {
  it("goes to the game when the browser has what it needs", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ ok: true, headers: new Headers({ "content-type": "text/html" }) }),
    );
    render(<App />);
    // the game is not built in this test: Play says so
    expect(await screen.findByText(/The game isn't built/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
