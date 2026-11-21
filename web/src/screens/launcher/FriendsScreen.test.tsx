import { act, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountClient } from "../../account/api";
import { AccountStore } from "../../account/store";
import { FriendsFake } from "../../friends/fake-friends";
import type { GameRecord } from "../../storage/manifest";
import { FriendsScreen, REFRESH_MS } from "./FriendsScreen";

configure({ asyncUtilTimeout: 5000 });

const edition: GameRecord = {
  id: "ra2md",
  slot: 1,
  storage: "ra2md",
  title: "ra2md",
  exeStamp: 0,
  importedAt: 0,
  bytes: 0,
  complete: true,
  files: {},
};

function storeFor(fake: FriendsFake) {
  return new AccountStore(
    new AccountClient({ baseUrl: "https://wol.test", fetch: fake.fetch, locks: null }),
  );
}

/** A member "carol" whose game names are `nicks`; the first is the one the fake acts as. */
async function member(fake: FriendsFake, nicks: string[] = ["Carol"]) {
  const store = storeFor(fake);
  fake.accounts.maxGameAccounts = Math.max(1, nicks.length);
  await store.register("carol", "secret-pass");
  for (const nick of nicks) await store.addGameAccount(nick, "game-pass-1");
  fake.who = nicks[0] ?? "Carol";
  return store;
}

function show(store: AccountStore) {
  render(
    <MemoryRouter initialEntries={["/friends"]}>
      <Routes>
        <Route path="/friends" element={<FriendsScreen edition={edition} store={store} />} />
        <Route path="/account" element={<p>account page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("FriendsScreen signed out", () => {
  it("tells a guest friends are for members, with no request to the friends routes", async () => {
    const fake = new FriendsFake();
    const store = storeFor(fake);
    await store.restore();
    show(store);
    const panel = screen.getByRole("region", { name: "Your friends" });
    expect(within(panel).getByText(/Friends are for members/)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "SIGN IN" })).toHaveAttribute(
      "href",
      "/account",
    );
    expect(screen.getByRole("heading", { name: "FRIENDS" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(fake.requests).toEqual([]);
  });

  it("asks a member with no game name to add one", async () => {
    const fake = new FriendsFake();
    const store = storeFor(fake);
    await store.register("carol", "secret-pass");
    show(store);
    expect(await screen.findByText(/Add a game name to your account first/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ADD A GAME NAME" })).toHaveAttribute(
      "href",
      "/account",
    );
    expect(fake.requests).toEqual([]);
  });

  it("says when the online service cannot be reached", async () => {
    const fake = new FriendsFake();
    fake.accounts.down = true;
    const store = storeFor(fake);
    await store.restore();
    show(store);
    expect(await screen.findByText(/online service cannot be reached/)).toBeInTheDocument();
  });
});

describe("FriendsScreen list", () => {
  it("shows each friend with a status in words, and the room where there is one", async () => {
    const fake = new FriendsFake();
    fake
      .list("Carol")
      .push(
        { name: "Dave", status: "lobby", room: "Lobby 3" },
        { name: "Erin", status: "game", room: "Last stand" },
        { name: "Frank", status: "offline" },
        { name: "Gus", status: "online" },
        { name: "Hal", status: "hidden" },
      );
    show(await member(fake));
    await screen.findByRole("table");
    const text = rows().map((row) => row.textContent);
    expect(text).toEqual([
      "DaveIn the lobby · Lobby 3REMOVE",
      "ErinIn a game · Last standREMOVE",
      "FrankOfflineREMOVE",
      "GusOnlineREMOVE",
      "HalHiddenREMOVE",
    ]);
    expect(screen.getByText("5 / 100")).toBeInTheDocument();
    expect(fake.requests).toEqual(["GET /v1/friends"]);
  });

  it("explains an empty list", async () => {
    show(await member(new FriendsFake()));
    expect(await screen.findByText(/No friends yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("0 / 100")).toBeInTheDocument();
  });

  it("shows an error with TRY AGAIN, which loads the list when the server is back", async () => {
    const fake = new FriendsFake();
    fake.list("Carol").push({ name: "Dave", status: "online" });
    const store = await member(fake);
    fake.down = true;
    show(store);
    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot be reached/);
    fake.down = false;
    await userEvent.click(screen.getByRole("button", { name: "TRY AGAIN" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("REFRESH reads the list again", async () => {
    const fake = new FriendsFake();
    show(await member(fake));
    await screen.findByText(/No friends yet/);
    fake.list("Carol").push({ name: "Dave", status: "game" });
    await userEvent.click(screen.getByRole("button", { name: "REFRESH" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(rows()[0]).toHaveTextContent("DaveIn a game");
  });

  it("keeps the list on screen when a later refresh fails", async () => {
    const fake = new FriendsFake();
    fake.list("Carol").push({ name: "Dave", status: "online" });
    show(await member(fake));
    await screen.findByRole("table");
    fake.down = true;
    await userEvent.click(screen.getByRole("button", { name: "REFRESH" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be refreshed/);
    expect(rows()).toHaveLength(1);
    fake.down = false;
    await userEvent.click(screen.getByRole("button", { name: "REFRESH" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("reads the list again every 30 seconds while the page is visible, not while hidden", async () => {
    const fake = new FriendsFake();
    const store = await member(fake);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    show(store);
    await screen.findByText(/No friends yet/);
    const reads = () => fake.requests.filter((request) => request.startsWith("GET")).length;
    expect(reads()).toBe(1);

    fake.list("Carol").push({ name: "Dave", status: "lobby", room: "Lobby 1" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS);
    });
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(reads()).toBe(2);

    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS * 2);
    });
    expect(reads()).toBe(2);

    hidden.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(reads()).toBe(3));
  });
});

describe("FriendsScreen changes", () => {
  it("adds a friend with PUT and shows them", async () => {
    const fake = new FriendsFake();
    show(await member(fake));
    await screen.findByText(/No friends yet/);
    const box = screen.getByRole("textbox", { name: "ADD A FRIEND" });
    await userEvent.type(box, "dave");
    await userEvent.click(screen.getByRole("button", { name: "ADD" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(fake.requests).toContain("PUT /v1/friends/dave");
    expect(rows()[0]).toHaveTextContent(/^DaveOffline/);
    expect(box).toHaveValue("");
  });

  it("validates the name before it asks the server", async () => {
    const fake = new FriendsFake();
    fake.list("Carol").push({ name: "Dave", status: "offline" });
    show(await member(fake));
    await screen.findByRole("table");
    const box = screen.getByRole("textbox", { name: "ADD A FRIEND" });
    const add = screen.getByRole("button", { name: "ADD" });
    expect(add).toBeDisabled();

    await userEvent.type(box, "abcdefghij");
    expect(screen.getByText(/at most 9 characters/)).toBeInTheDocument();
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(add).toBeDisabled();

    await userEvent.clear(box);
    await userEvent.type(box, "two words");
    expect(screen.getByText(/no spaces/)).toBeInTheDocument();
    expect(add).toBeDisabled();

    await userEvent.clear(box);
    await userEvent.type(box, "carol");
    expect(screen.getByText("You cannot add yourself.")).toBeInTheDocument();
    expect(add).toBeDisabled();

    await userEvent.clear(box);
    await userEvent.type(box, "DAVE");
    expect(screen.getByText("DAVE is already a friend.")).toBeInTheDocument();
    expect(add).toBeDisabled();

    expect(fake.requests.filter((request) => request.startsWith("PUT"))).toEqual([]);
  });

  it("shows the server's refusal and the list as it is now", async () => {
    const fake = new FriendsFake();
    show(await member(fake));
    await screen.findByText(/No friends yet/);
    await userEvent.type(screen.getByRole("textbox", { name: "ADD A FRIEND" }), "nobody");
    await userEvent.click(screen.getByRole("button", { name: "ADD" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No player has that name.");
    expect(screen.getByRole("textbox", { name: "ADD A FRIEND" })).toHaveValue("nobody");
    // typing again clears the old refusal
    await userEvent.type(screen.getByRole("textbox", { name: "ADD A FRIEND" }), "x");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks before it removes, and CANCEL changes nothing", async () => {
    const fake = new FriendsFake();
    fake
      .list("Carol")
      .push({ name: "Dave", status: "online" }, { name: "Erin", status: "offline" });
    show(await member(fake));
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "Remove Dave" }));
    const group = screen.getByRole("group", { name: "Confirm remove" });
    expect(group).toHaveTextContent("Remove Dave?");
    await userEvent.click(within(group).getByRole("button", { name: "CANCEL" }));
    expect(screen.queryByRole("group", { name: "Confirm remove" })).toBeNull();
    expect(fake.requests.some((request) => request.startsWith("DELETE"))).toBe(false);
    expect(rows()).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Remove Dave" }));
    await userEvent.click(screen.getByRole("button", { name: "YES, REMOVE" }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(fake.requests).toContain("DELETE /v1/friends/Dave");
    expect(rows()[0]).toHaveTextContent(/^Erin/);
  });

  it("with several game names, picks one and sends it as ?account=", async () => {
    const fake = new FriendsFake();
    fake.list("Carol").push({ name: "Dave", status: "offline" });
    fake.list("Second").push({ name: "Erin", status: "game", room: "Duel" });
    show(await member(fake, ["Carol", "Second"]));
    await screen.findByRole("table");
    expect(fake.requests).toEqual(["GET /v1/friends?account=Carol"]);
    expect(rows()[0]).toHaveTextContent(/^Dave/);

    await userEvent.selectOptions(screen.getByRole("combobox"), "Second");
    await waitFor(() => expect(rows()[0]).toHaveTextContent(/^ErinIn a game · Duel/));
    expect(fake.requests).toContain("GET /v1/friends?account=Second");

    await userEvent.type(screen.getByRole("textbox", { name: "ADD A FRIEND" }), "frank");
    await userEvent.click(screen.getByRole("button", { name: "ADD" }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(fake.requests).toContain("PUT /v1/friends/frank?account=Second");
  });
});
