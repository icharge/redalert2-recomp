import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { Manifest } from "./storage/manifest";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { FakeServer } from "./account/fake-server";
import { account } from "./account/store";
import { BrowserCheck } from "./components/BrowserCheck";
import { checkBrowser } from "./components/features";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.history.replaceState({}, "", "/");
  delete window.ra2Session;
});

/**
 * A stand-in for OPFS: the files at their slash paths, with the sizes given. A name in `locked` will
 * not delete, as a file the game open in another tab holds.
 */
function fakeOpfs(
  files: Record<string, number>,
  locked: ReadonlySet<string> = new Set(),
): FileSystemDirectoryHandle {
  type Node = { dirs: Map<string, Node>; files: Map<string, number> };
  const root: Node = { dirs: new Map(), files: new Map() };
  for (const [path, size] of Object.entries(files)) {
    const parts = path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let next = node.dirs.get(part);
      if (!next) {
        next = { dirs: new Map(), files: new Map() };
        node.dirs.set(part, next);
      }
      node = next;
    }
    node.files.set(parts[parts.length - 1] ?? "", size);
  }
  const handle = (node: Node) => ({
    kind: "directory",
    async getDirectoryHandle(name: string) {
      const child = node.dirs.get(name);
      if (!child) throw new DOMException(`${name} is not there`, "NotFoundError");
      return handle(child);
    },
    async getFileHandle(name: string) {
      const size = node.files.get(name);
      if (size === undefined) throw new DOMException(`${name} is not there`, "NotFoundError");
      return { kind: "file", getFile: async () => ({ size }) };
    },
    async removeEntry(name: string) {
      if (locked.has(name))
        throw new DOMException(`${name} is in use`, "NoModificationAllowedError");
      if (!node.files.delete(name)) throw new DOMException(`${name} is not there`, "NotFoundError");
    },
  });
  return handle(root) as unknown as FileSystemDirectoryHandle;
}

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
    expect(screen.getByRole("link", { name: "Resume import" })).toHaveAttribute(
      "href",
      "/import?resume=1",
    );
    m.close();
  });
  it("refreshes incomplete installations when returning from Import", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("navigator", { storage: { estimate: async () => ({ quota: 1e12, usage: 0 }) } });
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ games: {} }))));
    window.history.replaceState({}, "", "/import");
    render(<App />);
    await screen.findByRole("heading", { name: "INSTALL THE GAME" });
    const m = await Manifest.open();
    const installation = await m.createInstallation("Interrupted import");
    await m.beginImport(
      "ra2md",
      "Yuri's Revenge",
      1,
      [{ name: "ra2.mix", size: 1, lastModified: 1, needs: ["ra2md"] }],
      installation.slot,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "LAUNCHER" }));
    expect(await screen.findByRole("button", { name: "RESUME INSTALL" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("YURI’S REVENGE");
    m.close();
  });
  it("clears a stale Resume prompt when OPFS has every recorded file", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("navigator", {
      storage: {
        estimate: async () => ({ quota: 1e12, usage: 0 }),
        getDirectory: async () => fakeOpfs({ "game/slot-1/ra2.mix": 4 }),
      },
    });
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ games: {} }))));
    const m = await Manifest.open();
    const installation = await m.createInstallation("Copied but unmarked");
    await m.beginImport(
      "ra2md",
      "Yuri's Revenge",
      1,
      [{ name: "ra2.mix", size: 4, lastModified: 1, needs: ["ra2md"] }],
      installation.slot,
    );
    window.history.replaceState({}, "", "/");
    render(<App />);
    expect(await screen.findByRole("button", { name: "RESUME INSTALL" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "RESUME INSTALL" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "PLAY" })).toBeInTheDocument();
    expect((await m.getGame("ra2md", installation.slot))?.complete).toBe(true);
    m.close();
  });
  it("offers resume when the record says complete but the browser's copy lost a file", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("navigator", {
      storage: {
        estimate: async () => ({ quota: 1e12, usage: 0 }),
        getDirectory: async () => fakeOpfs({ "game/slot-1/ra2.mix": 4 }),
      },
    });
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ games: {} }))));
    const m = await Manifest.open();
    const installation = await m.createInstallation("Lost file");
    await m.beginImport(
      "ra2md",
      "Yuri's Revenge",
      1,
      [
        { name: "ra2.mix", size: 4, lastModified: 1, needs: ["ra2md"] },
        { name: "testmap.yrm", size: 12, lastModified: 1, needs: ["ra2md"] },
      ],
      installation.slot,
    );
    await m.markFileDone("ra2md", "ra2.mix", installation.slot);
    await m.markFileDone("ra2md", "testmap.yrm", installation.slot);
    window.history.replaceState({}, "", "/game/1");
    render(<App />);
    expect(await screen.findByText(/testmap\.yrm/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Resume import" })).toHaveAttribute(
      "href",
      "/import?resume=1",
    );
    // the record now says the import did not finish, so the launcher offers Resume
    expect((await m.getGame("ra2md", installation.slot))?.complete).toBe(false);
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
    expect(window.location.pathname).toBe("/emu/game");
    expect(window.location.search).toBe("?edition=ra2");
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

describe("Launcher routes", () => {
  const files = Object.fromEntries(
    ["ra2.mix", "ra2md.mix", "maps01.mix", "multi.mix"].map((name) => [
      name,
      { size: 4, lastModified: 1, needs: ["ra2" as const, "ra2md" as const] },
    ]),
  );
  const runtime = (edition: "ra2" | "ra2md") => ({
    title: edition,
    exe: "x.exe",
    ini: "x.ini",
    stamp: 1,
    build: "b",
    runtime: { edition, build: "b", exeSha256: "a", blowfishSha256: "b" },
  });

  async function installed(editions: ("ra2" | "ra2md")[] = ["ra2", "ra2md"]) {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(
        url.endsWith("build.json")
          ? new Response(
              JSON.stringify({ games: { ra2: runtime("ra2"), ra2md: runtime("ra2md") } }),
            )
          : new Response("<html>", { headers: { "content-type": "text/html" } }),
      ),
    );
    const m = await Manifest.open();
    const installation = await m.createInstallation("Main", editions);
    for (const id of editions) {
      await m.beginImport(
        id,
        id,
        1,
        Object.entries(files).map(([name, entry]) => ({ name, ...entry })),
        installation.slot,
      );
      for (const name of Object.keys(files)) await m.markFileDone(id, name, installation.slot);
    }
    return m;
  }

  afterEach(() => localStorage.clear());

  it("/ shows PLAY in the bar", async () => {
    const m = await installed();
    render(<App />);
    expect(await screen.findByRole("link", { name: "PLAY" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByRole("button", { name: "PLAY" })).toBeEnabled();
    m.close();
  });

  it("/manage shows GAME as current", async () => {
    const m = await installed();
    window.history.replaceState({}, "", "/manage");
    render(<App />);
    expect(await screen.findByRole("link", { name: "GAME" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByRole("region", { name: "INSTALLED" })).toBeInTheDocument();
    m.close();
  });

  it("REMOVE GAME keeps the game, and says why, while a file is in use", async () => {
    const m = await installed();
    // the game open in another tab holds ra2.mix
    const locked = new Set(["ra2.mix"]);
    const opfs = fakeOpfs(
      Object.fromEntries(Object.keys(files).map((name) => [`game/slot-1/${name}`, 4])),
      locked,
    );
    vi.stubGlobal("navigator", {
      storage: {
        estimate: async () => ({ quota: 1e12, usage: 0 }),
        getDirectory: async () => opfs,
      },
    });
    window.history.replaceState({}, "", "/manage");
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "REMOVE…" }));
    const dialog = await screen.findByRole("dialog");
    // the game's own files: ticking them removes the game and keeps the installation
    const game = within(dialog).getByRole("checkbox", { name: /^Red Alert 2 and/ });
    await waitFor(() => expect(game).toBeEnabled());
    await user.click(game);
    await user.click(within(dialog).getByRole("button", { name: /^REMOVE \d/ }));
    // the record stays: forgetting it would leave the files behind, and RESUME INSTALL on a
    // page that still listed it would name an installation that does not exist
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/in use.*another tab/);
    expect(await m.listInstallations()).toHaveLength(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // the tab is closed: REMOVE EVERYTHING, asked inline, goes through and forgets the install
    locked.clear();
    await user.click(within(dialog).getByRole("button", { name: /^REMOVE EVERYTHING · / }));
    await user.click(
      within(within(dialog).getByRole("group", { name: "Confirm remove everything" })).getByRole(
        "button",
        { name: "REMOVE EVERYTHING" },
      ),
    );
    expect(await screen.findByText("No game installed yet.")).toBeInTheDocument();
    expect(await m.listInstallations()).toEqual([]);
    m.close();
  });

  it("/settings/nope redirects to /settings/launcher", async () => {
    const m = await installed();
    window.history.replaceState({}, "", "/settings/nope");
    render(<App />);
    expect(await screen.findByRole("link", { name: "LAUNCHER" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(window.location.pathname).toBe("/settings/launcher");
    m.close();
  });

  it("the bar and the rail stay in place when the tab changes", async () => {
    const m = await installed();
    render(<App />);
    const user = userEvent.setup();
    const rail = await screen.findByRole("navigation", { name: "Games" });
    await user.click(screen.getByRole("link", { name: "MODS" }));
    await screen.findByRole("heading", { name: "MODS" });
    expect(screen.getByRole("navigation", { name: "Games" })).toBe(rail);
    await user.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "SETTINGS" });
    expect(screen.getByRole("navigation", { name: "Games" })).toBe(rail);
    m.close();
  });

  it("picking an edition in the rail is remembered", async () => {
    const m = await installed();
    render(<App />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Red Alert 2" }));
    expect(localStorage.getItem("ra2-edition:1")).toBe("ra2");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("RED ALERT 2");
    m.close();
  });

  it("Play navigates to /game?edition=<id>", async () => {
    const m = await installed();
    render(<App />);
    const play = await screen.findByRole("button", { name: "PLAY" });
    await waitFor(() => expect(play).toBeEnabled());
    await userEvent.setup().click(play);
    await waitFor(() => expect(window.location.pathname).toBe("/game"));
    expect(window.location.search).toBe("?edition=ra2md");
    m.close();
  });

  describe("PLAY hands a launch ticket to the game (LW-4)", () => {
    afterEach(async () => {
      vi.restoreAllMocks();
      // the page's one account store is shared by every test of this file
      await account.signOut().catch(() => {});
    });

    /** Answers the member routes from a fake server; everything else goes to the earlier stub. */
    async function accountServer(): Promise<FakeServer> {
      const server = new FakeServer();
      const earlier = globalThis.fetch;
      vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/v1/") ? server.fetch(input, init) : earlier(input, init),
      );
      await account.retry();
      return server;
    }

    /** The addresses the launcher navigated to: the game page removes the ticket as it starts. */
    function navigations(): string[] {
      const pushed: string[] = [];
      const push = window.history.pushState.bind(window.history);
      vi.spyOn(window.history, "pushState").mockImplementation((state, title, url) => {
        pushed.push(String(url));
        push(state, title, url);
      });
      return pushed;
    }

    it("a member's game opens with #ticket= in the fragment, the query kept", async () => {
      const m = await installed();
      const server = await accountServer();
      await account.register("carol", "secret-pass");
      await account.addGameAccount("Carol", "wol-password");
      const pushed = navigations();
      render(<App />);
      const play = await screen.findByRole("button", { name: "PLAY" });
      await waitFor(() => expect(play).toBeEnabled());
      await userEvent.setup().click(play);
      await waitFor(() => expect(window.location.pathname).toBe("/game"));
      const ticket = [...server.tickets.keys()][0]!;
      expect(pushed).toContain(`/game?edition=ra2md#ticket=${ticket}`);
      expect(server.tickets.get(ticket)).toEqual({ user: "Carol", edition: "yr", guest: false });
      m.close();
    });

    it("a guest's game opens with the guest ticket in the fragment", async () => {
      localStorage.setItem("ra2.guest-name", "Visitor");
      const m = await installed();
      const server = await accountServer();
      const pushed = navigations();
      render(<App />);
      const play = await screen.findByRole("button", { name: "PLAY" });
      await waitFor(() => expect(play).toBeEnabled());
      await userEvent.setup().click(play);
      await waitFor(() => expect(window.location.pathname).toBe("/game"));
      const ticket = [...server.tickets.keys()][0]!;
      expect(pushed).toContain(`/game?edition=ra2md#ticket=${ticket}`);
      expect(server.tickets.get(ticket)).toMatchObject({ user: "Visitor", guest: true });
      expect(window.location.search).not.toContain("ticket");
      m.close();
    });

    it("with no name or no server there is no fragment at all", async () => {
      const m = await installed();
      await accountServer();
      const pushed = navigations();
      render(<App />);
      const play = await screen.findByRole("button", { name: "PLAY" });
      await waitFor(() => expect(play).toBeEnabled());
      await userEvent.setup().click(play);
      await waitFor(() => expect(window.location.pathname).toBe("/game"));
      expect(pushed).toContain("/game?edition=ra2md");
      expect(pushed.some((url) => url.includes("ticket"))).toBe(false);
      m.close();
    });
  });

  it("with a game installed, /import goes to the Game screen: remove it first", async () => {
    const m = await installed();
    window.history.replaceState({}, "", "/import");
    render(<App />);
    expect(await screen.findByRole("region", { name: "INSTALLED" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/manage");
    expect(screen.queryByRole("heading", { name: "INSTALL THE GAME" })).toBeNull();
    m.close();
  });

  it("nothing installed opens on the welcome page until it is dismissed", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ games: {} }))));
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "DON'T SHOW THIS AGAIN" }));
    expect(window.location.pathname).toBe("/");
    await user.click(await screen.findByRole("button", { name: "INSTALL THE GAME" }));
    expect(window.location.pathname).toBe("/import");
  });

  it("with a game installed, / opens on PLAY, not the welcome page", async () => {
    const m = await installed();
    render(<App />);
    expect(await screen.findByRole("button", { name: "PLAY" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
    m.close();
  });

  it.each([
    ["/install/guide", "INSTALL GUIDE"],
    ["/account", "ACCOUNT"],
  ])("%s is a launcher page", async (path, heading) => {
    const m = await installed();
    window.history.replaceState({}, "", path);
    render(<App />);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Launcher" })).toBeInTheDocument();
    m.close();
  });
});
