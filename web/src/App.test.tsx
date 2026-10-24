import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { Manifest } from "./storage/manifest";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { BrowserCheck } from "./components/BrowserCheck";
import { checkBrowser } from "./components/features";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.history.replaceState({}, "", "/");
  delete window.ra2Session;
});

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
  it("offers resume for a known slot interrupted before edition registration", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ games: {} }))));
    const m = await Manifest.open();
    await m.createInstallation("Interrupted", ["ra2", "ra2md"]);
    window.history.replaceState({}, "", "/game/1");
    render(<App />);
    expect(await screen.findByText(/import did not finish/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Resume import" })).toHaveAttribute("href", "/import?resume=1");
    m.close();
  });
  it("refreshes incomplete installations when returning from Import", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("navigator", { storage: { estimate: async () => ({ quota: 1e12, usage: 0 }) } });
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ games: {} }))));
    window.history.replaceState({}, "", "/import");
    render(<App />);
    await screen.findByText("Bring your game");
    const m = await Manifest.open();
    const installation = await m.createInstallation("Interrupted import");
    await m.beginImport("ra2md", "Yuri's Revenge", 1, [{ name: "ra2.mix", size: 1, lastModified: 1, needs: ["ra2md"] }], installation.slot);
    await userEvent.setup().click(screen.getByRole("link", { name: "Back to launcher" }));
    expect(await screen.findByRole("heading", { name: "Yuri's Revenge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume import" })).toBeInTheDocument();
    m.close();
  });
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

  it("opens an edition from a numeric installation route under a context path", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubEnv("BASE_URL", "/emu/");
    const m = await Manifest.open();
    await m.createInstallation("First");
    const installation = await m.createInstallation("Second");
    await m.beginImport("ra2", "Red Alert 2", 1, [], installation.slot);
    window.history.replaceState({}, "", "/emu/game/2?edition=ra2");
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(
        url.endsWith("build.json")
          ? new Response(JSON.stringify({ games: {} }))
          : new Response("<html>", { headers: { "content-type": "text/html" } }),
      ),
    );
    render(<App />);
    expect(await screen.findByText(/RA2_TARGET=game/)).toBeInTheDocument();
    m.close();
  });

  it("does not launch a different game for an unknown slot", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ games: {} }))));
    window.history.replaceState({}, "", "/game/999");
    render(<App />);
    expect(await screen.findByText(/installation.*not.*found/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to launcher" })).toHaveAttribute("href", "/");
    expect(window.ra2Session).toBeUndefined();
  });
});
