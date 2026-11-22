import { configure, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountClient } from "../account/api";
import { AccountStore } from "../account/store";
import { FriendsFake } from "../friends/fake-friends";
import { LadderClient } from "../ladder/api";
import { FriendsTab } from "./FriendsTab";
import { PlayerProfile } from "./PlayerProfile";

configure({ asyncUtilTimeout: 5000 });

function storeFor(fake: FriendsFake) {
  return new AccountStore(
    new AccountClient({ baseUrl: "https://wol.test", fetch: fake.fetch, locks: null }),
  );
}

async function member(fake: FriendsFake) {
  const store = storeFor(fake);
  await store.register("carol", "secret-pass");
  await store.addGameAccount("Carol", "game-pass-1");
  fake.who = "Carol";
  return store;
}

describe("FriendsTab", () => {
  it("lists the friends of the name being played, with MESSAGE and PROFILE for each", async () => {
    const fake = new FriendsFake();
    fake.list("Carol").push({ name: "Dave", status: "game", room: "Last stand" });
    const onMessage = vi.fn();
    const onProfile = vi.fn();
    render(
      <FriendsTab
        nick="carol"
        onMessage={onMessage}
        onProfile={onProfile}
        store={await member(fake)}
      />,
    );
    const list = await screen.findByRole("list", { name: "Friends of Carol" });
    expect(within(list).getByText("Dave")).toBeInTheDocument();
    expect(within(list).getByText(/In a game/)).toBeInTheDocument();
    await userEvent.click(within(list).getByRole("button", { name: "MESSAGE" }));
    expect(onMessage).toHaveBeenCalledWith("Dave");
    await userEvent.click(within(list).getByRole("button", { name: "PROFILE" }));
    expect(onProfile).toHaveBeenCalledWith("Dave");
  });

  it("offers JOIN for a friend in a game room, and INVITE into the player's own room", async () => {
    const fake = new FriendsFake();
    fake
      .list("Carol")
      .push(
        { name: "Dave", status: "game", room: "#Dave's game" },
        { name: "Erin", status: "lobby", room: "#Lob 41 0" },
        { name: "Frank", status: "offline" },
      );
    const onJoin = vi.fn();
    const onInvite = vi.fn();
    render(
      <FriendsTab
        nick="Carol"
        onMessage={vi.fn()}
        onProfile={vi.fn()}
        room="Carol's_game"
        onJoin={onJoin}
        onInvite={onInvite}
        store={await member(fake)}
      />,
    );
    const list = await screen.findByRole("list", { name: "Friends of Carol" });
    const row = (name: string) => within(list).getByText(name).closest("li")!;
    await userEvent.click(within(row("Dave")).getByRole("button", { name: "JOIN" }));
    expect(onJoin).toHaveBeenCalledWith("#Dave's game");
    expect(within(row("Erin")).queryByRole("button", { name: "JOIN" })).toBeNull();
    await userEvent.click(within(row("Erin")).getByRole("button", { name: "INVITE" }));
    expect(onInvite).toHaveBeenCalledWith("Erin");
    expect(within(row("Frank")).queryByRole("button", { name: "INVITE" })).toBeNull();
  });

  it("adds a friend by game name, and removes one", async () => {
    const fake = new FriendsFake();
    render(
      <FriendsTab
        nick="Carol"
        onMessage={vi.fn()}
        onProfile={vi.fn()}
        store={await member(fake)}
      />,
    );
    await screen.findByText("No friends yet. Add one by their game name.");
    await userEvent.type(screen.getByRole("textbox", { name: "Add a friend" }), "Erin");
    await userEvent.click(screen.getByRole("button", { name: "ADD" }));
    const list = await screen.findByRole("list", { name: "Friends of Carol" });
    expect(within(list).getByText("Erin")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Add a friend" })).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "Remove Erin" }));
    await screen.findByText("No friends yet. Add one by their game name.");
    expect(fake.requests).toContain("PUT /v1/friends/Erin");
    expect(fake.requests).toContain("DELETE /v1/friends/Erin");
  });

  it("explains that a guest (a name with no player account) cannot be a friend", async () => {
    const fake = new FriendsFake();
    render(
      <FriendsTab
        nick="Carol"
        onMessage={vi.fn()}
        onProfile={vi.fn()}
        store={await member(fake)}
      />,
    );
    await screen.findByText("No friends yet. Add one by their game name.");
    await userEvent.type(screen.getByRole("textbox", { name: "Add a friend" }), "Guest42");
    await userEvent.click(screen.getByRole("button", { name: "ADD" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Guest42 has no player account (a guest, or no such player): only members can be friends.",
    );
    expect(screen.getByRole("textbox", { name: "Add a friend" })).toHaveValue("Guest42");
  });

  it("tells a guest friends are for members", async () => {
    const fake = new FriendsFake();
    const store = storeFor(fake);
    await store.restore();
    render(<FriendsTab nick="Guest1" onMessage={vi.fn()} onProfile={vi.fn()} store={store} />);
    expect(await screen.findByText(/Friends are for members/)).toBeInTheDocument();
    expect(fake.requests).toEqual([]);
  });
});

describe("PlayerProfile", () => {
  it("shows a player's rating, rank, record and last matches", async () => {
    const client = {
      profile: vi.fn().mockResolvedValue({
        name: "Dave",
        seasonId: 1,
        season: "S1",
        ranked: true,
        rank: 3,
        ratedPlayers: 40,
        rating: 1234,
        badge: 2,
        wins: 6,
        losses: 2,
        draws: 0,
        placementMatchesLeft: 0,
        games: [{ gameId: 1, ended: 0, won: true, resultType: 0 }],
      }),
    } as unknown as LadderClient;
    render(<PlayerProfile name="Dave" sku={18688} client={client} />);
    expect(await screen.findByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("#3")).toBeInTheDocument();
    expect(screen.getByText("6 – 2")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(client.profile).toHaveBeenCalledWith("Dave", 18688, expect.anything());
  });

  it("says when a player has no profile in this game", async () => {
    const client = { profile: vi.fn().mockResolvedValue(null) } as unknown as LadderClient;
    render(<PlayerProfile name="Nobody" sku={16640} client={client} />);
    expect(
      await screen.findByText("No ranked profile for Nobody in this game yet."),
    ).toBeInTheDocument();
  });
});
