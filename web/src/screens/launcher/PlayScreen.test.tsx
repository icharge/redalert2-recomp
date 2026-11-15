import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveInstall } from "../../storage/active-install";
import type { BuildInfo, GameId } from "../../storage/install";
import type { GameRecord } from "../../storage/manifest";
import type { ModRecord } from "../../storage/mods";
import { AccountClient } from "../../account/api";
import { FakeServer } from "../../account/fake-server";
import { AccountStore } from "../../account/store";
import { PlayScreen } from "./PlayScreen";

const g = (id: GameId, extra: Partial<GameRecord> = {}): GameRecord => ({
  id,
  slot: 1,
  storage: id,
  title: id,
  exeStamp: 0,
  importedAt: 0,
  bytes: 0,
  complete: true,
  files: {},
  ...extra,
});
const ra2 = g("ra2");
const yr = g("ra2md");
const install = (
  editions: GameRecord[],
  extra: Partial<ActiveInstall["installation"]> = {},
): ActiveInstall => ({
  installation: { slot: 1, name: "Game", importedAt: 0, ...extra },
  editions,
});
const mod = (name: string): ModRecord => ({ name, files: [], bytes: 0 });

// a build whose runtimes exist and need ra2.mix (and ra2md.mix for YR)
const build = {
  games: {
    ra2: {
      title: "Red Alert 2",
      exe: "",
      ini: "",
      build: "b",
      runtime: { edition: "ra2", build: "b" },
    },
    ra2md: {
      title: "Yuri's Revenge",
      exe: "",
      ini: "",
      build: "b",
      runtime: { edition: "ra2md", build: "b" },
    },
  },
} as unknown as BuildInfo;

/** A store over the fake member server (not restored yet: the page has not asked who is playing). */
function fakeStore(server: FakeServer = new FakeServer()) {
  return new AccountStore(
    new AccountClient({ baseUrl: "https://wol.test", fetch: server.fetch, locks: null }),
  );
}

function renderPlay(props: Partial<Parameters<typeof PlayScreen>[0]> = {}) {
  const handlers = {
    onActiveMod: vi.fn(async () => {}),
    onPlay: vi.fn(),
    onInstall: vi.fn(),
    onResume: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={
            <PlayScreen
              install={install([ra2, yr])}
              edition={yr}
              mods={[]}
              activeMod=""
              {...handlers}
              accountStore={fakeStore()}
              {...props}
            />
          }
        />
        <Route path="/mods" element={<p>mods page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return handlers;
}

describe("PlayScreen", () => {
  it("nothing installed shows one INSTALL THE GAME button", async () => {
    const { onInstall } = renderPlay({ install: null, edition: null });
    expect(screen.queryByRole("button", { name: "PLAY" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "INSTALL THE GAME" }));
    expect(onInstall).toHaveBeenCalled();
  });

  it("nothing installed says to bring your own game", () => {
    renderPlay({ install: null, edition: null });
    expect(screen.getByRole("heading", { level: 1, name: /BRING YOUR\s*OWN GAME/ })).toBeVisible();
    expect(screen.getByText("NOTHING INSTALLED YET")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is uploaded\./)).toBeInTheDocument();
  });

  it("nothing installed lists the three steps", () => {
    renderPlay({ install: null, edition: null });
    const steps = within(screen.getByRole("list", { name: "How it works" })).getAllByRole(
      "listitem",
    );
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent("Choose your game folder");
    expect(steps[2]).toHaveTextContent("Play");
  });

  it("nothing installed links to the install guide", () => {
    renderPlay({ install: null, edition: null });
    expect(screen.getByRole("link", { name: /READ THE INSTALL GUIDE/ })).toHaveAttribute(
      "href",
      "/install/guide",
    );
  });

  it("YR shows EXPANSION and YURI’S REVENGE", () => {
    renderPlay();
    expect(screen.getByText("EXPANSION")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("YURI’S REVENGE");
  });

  it("RA2 shows RED ALERT 2 without a kicker", () => {
    renderPlay({ edition: ra2 });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("RED ALERT 2");
    expect(screen.queryByText("EXPANSION")).toBeNull();
  });

  it("PLAY calls onPlay with the edition", async () => {
    const { onPlay } = renderPlay();
    expect(screen.getByRole("status")).toHaveTextContent("Ready");
    await userEvent.click(screen.getByRole("button", { name: "PLAY" }));
    await waitFor(() => expect(onPlay).toHaveBeenCalledWith(yr, undefined));
  });

  it("PLAY is disabled with the readiness reason as the status", () => {
    renderPlay({ build });
    expect(screen.getByRole("button", { name: "PLAY" })).toBeDisabled();
    expect(screen.getByRole("status").textContent).toMatch(/^Missing/);
  });

  it("an unfinished import shows RESUME INSTALL", async () => {
    const { onResume, onPlay } = renderPlay({
      install: install([g("ra2md", { complete: false })]),
      edition: g("ra2md", { complete: false }),
    });
    expect(screen.queryByRole("button", { name: "PLAY" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "RESUME INSTALL" }));
    expect(onResume).toHaveBeenCalledWith(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("an edition still to import offers RESUME INSTALL beside PLAY", async () => {
    const { onResume } = renderPlay({ install: install([yr], { editions: ["ra2", "ra2md"] }) });
    expect(screen.getByRole("button", { name: "PLAY" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "RESUME INSTALL" }));
    expect(onResume).toHaveBeenCalledWith(1);
  });

  it("the profile menu lists Vanilla and each mod, and picking one calls onActiveMod(name)", async () => {
    const { onActiveMod } = renderPlay({ mods: [mod("Mental Omega"), mod("Rise")], activeMod: "" });
    const profile = screen.getByRole("button", { name: /PROFILE/ });
    expect(profile).toHaveTextContent("Vanilla");
    await userEvent.click(profile);
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Vanilla", "Mental Omega", "Rise"]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("option", { name: "Rise" }));
    expect(onActiveMod).toHaveBeenCalledWith("Rise");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape closes the profile menu", async () => {
    renderPlay({ mods: [mod("Rise")] });
    await userEvent.click(screen.getByRole("button", { name: /PROFILE/ }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("MANAGE MODS goes to /mods", async () => {
    renderPlay({ mods: [mod("Rise")] });
    await userEvent.click(screen.getByRole("button", { name: /PROFILE/ }));
    await userEvent.click(screen.getByRole("link", { name: "MANAGE MODS" }));
    expect(screen.getByText("mods page")).toBeInTheDocument();
  });

  describe("online play (LW-4)", () => {
    afterEach(() => localStorage.clear());

    /** A member whose session the store holds (with a game account, or without), then the screen. */
    async function asMember(
      game: string | null,
      props: Partial<Parameters<typeof PlayScreen>[0]> = {},
    ) {
      const server = new FakeServer();
      const store = fakeStore(server);
      await store.register("carol", "secret-pass");
      if (game) await store.addGameAccount(game, "wol-password");
      const handlers = renderPlay({ accountStore: store, ...props });
      server.calls.length = 0;
      return { server, store, ...handlers };
    }

    async function asGuest(props: Partial<Parameters<typeof PlayScreen>[0]> = {}) {
      const server = new FakeServer();
      const store = fakeStore(server);
      await store.restore();
      const handlers = renderPlay({ accountStore: store, ...props });
      return { server, store, ...handlers };
    }

    it("a member with a game account gets a launch ticket for the edition", async () => {
      const { server, onPlay } = await asMember("Carol");
      await userEvent.click(screen.getByRole("button", { name: "PLAY" }));
      await waitFor(() => expect(onPlay).toHaveBeenCalled());
      const ticket = [...server.tickets.keys()][0]!;
      expect(onPlay).toHaveBeenCalledWith(yr, ticket);
      // Yuri's Revenge is the server's `yr`
      expect(server.tickets.get(ticket)).toEqual({ user: "Carol", edition: "yr", guest: false });
      expect(screen.queryByLabelText("ONLINE NAME")).toBeNull();
    });

    it("mints at the moment of PLAY, never ahead", async () => {
      const { server } = await asMember("Carol");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(server.log()).toEqual([]);
    });

    it("an access token that expired refreshes once and the ticket still comes", async () => {
      const { server, onPlay } = await asMember("Carol", { edition: ra2 });
      server.expireAccessTokens();
      await userEvent.click(screen.getByRole("button", { name: "PLAY" }));
      await waitFor(() => expect(onPlay).toHaveBeenCalled());
      expect(server.log()).toEqual([
        "POST /v1/auth/launch-ticket",
        "POST /v1/auth/refresh",
        "POST /v1/auth/launch-ticket",
      ]);
      const ticket = [...server.tickets.keys()][0]!;
      expect(onPlay).toHaveBeenCalledWith(ra2, ticket);
      expect(server.tickets.get(ticket)?.edition).toBe("ra2");
    });

    it("a member without a game account plays with no ticket and is pointed to /account", async () => {
      const { server, onPlay } = await asMember(null);
      expect(screen.getByRole("link", { name: /Add one on the Account page/ })).toHaveAttribute(
        "href",
        "/account",
      );
      await userEvent.click(screen.getByRole("button", { name: "PLAY" }));
      await waitFor(() => expect(onPlay).toHaveBeenCalledWith(yr, undefined));
      expect(server.log()).toEqual([]);
    });

    it("a refusal of the member's ticket shows, and the next PLAY opens the game without one", async () => {
      const { server, onPlay } = await asMember("Carol");
      server.refusals.set("POST /v1/auth/launch-ticket", { status: 403, errorCode: "banned" });
      await userEvent.click(screen.getByRole("button", { name: "PLAY" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "That game account is banned. Press PLAY again to play without it.",
      );
      expect(onPlay).not.toHaveBeenCalled();
      server.refusals.clear();
      await userEvent.click(screen.getByRole("button", { name: "PLAY" }));
      await waitFor(() => expect(onPlay).toHaveBeenCalledWith(yr));
      expect(server.tickets.size).toBe(0);
    });

    it("a guest who gives a name gets a guest ticket, and the name is remembered", async () => {
      const { server, onPlay } = await asGuest();
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("ONLINE NAME"), "Visitor");
      await user.click(screen.getByRole("button", { name: "PLAY" }));
      await waitFor(() => expect(onPlay).toHaveBeenCalled());
      const ticket = [...server.tickets.keys()][0]!;
      expect(onPlay).toHaveBeenCalledWith(yr, ticket);
      expect(server.tickets.get(ticket)).toEqual({ user: "Visitor", edition: "yr", guest: true });
      expect(localStorage.getItem("ra2.guest-name")).toBe("Visitor");
    });

    it("the remembered name is there next time, capped at 9 characters", async () => {
      localStorage.setItem("ra2.guest-name", "Visitor");
      await asGuest();
      const field = screen.getByLabelText("ONLINE NAME");
      expect(field).toHaveValue("Visitor");
      expect(field).toHaveAttribute("maxlength", "9");
    });

    it("a taken name shows inline and the game does not open", async () => {
      const { server, onPlay } = await asGuest();
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("ONLINE NAME"), "Taken");
      await user.click(screen.getByRole("button", { name: "PLAY" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("That name is taken.");
      expect(onPlay).not.toHaveBeenCalled();
      expect(server.tickets.size).toBe(0);
      // typing again clears the message, and PLAY works for a free name
      await user.clear(screen.getByLabelText("ONLINE NAME"));
      expect(screen.queryByRole("alert")).toBeNull();
      await user.type(screen.getByLabelText("ONLINE NAME"), "Free");
      await user.click(screen.getByRole("button", { name: "PLAY" }));
      await waitFor(() => expect(onPlay).toHaveBeenCalled());
    });

    it("a name that cannot be a name (bad_nick) shows inline too", async () => {
      const { onPlay } = await asGuest();
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("ONLINE NAME"), "a b");
      await user.click(screen.getByRole("button", { name: "PLAY" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("2 to 9 letters");
      expect(onPlay).not.toHaveBeenCalled();
    });

    it("a guest who leaves the name empty plays offline: no ticket, no request", async () => {
      const { server, onPlay } = await asGuest();
      await userEvent.click(screen.getByRole("button", { name: "PLAY" }));
      await waitFor(() => expect(onPlay).toHaveBeenCalledWith(yr, undefined));
      expect(server.log()).not.toContain("POST /v1/auth/guest");
    });

    it("with guests off on the server, PLAY opens the game with no ticket", async () => {
      const { server, onPlay } = await asGuest();
      server.guestsEnabled = false;
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("ONLINE NAME"), "Visitor");
      await user.click(screen.getByRole("button", { name: "PLAY" }));
      await waitFor(() => expect(onPlay).toHaveBeenCalledWith(yr, undefined));
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("with the server unreachable from the start, PLAY opens the game with no ticket", async () => {
      const server = new FakeServer();
      server.down = true;
      const store = fakeStore(server);
      await store.restore();
      expect(store.getState().status).toBe("offline");
      const { onPlay } = renderPlay({ accountStore: store });
      await userEvent.click(screen.getByRole("button", { name: "PLAY" }));
      await waitFor(() => expect(onPlay).toHaveBeenCalledWith(yr, undefined));
    });

    it("a server that goes away after the page loaded does not stop a guest", async () => {
      const { server, onPlay } = await asGuest();
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("ONLINE NAME"), "Visitor");
      server.down = true;
      await user.click(screen.getByRole("button", { name: "PLAY" }));
      await waitFor(() => expect(onPlay).toHaveBeenCalledWith(yr, undefined));
    });
  });
});
