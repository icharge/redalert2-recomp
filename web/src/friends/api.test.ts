import { describe, expect, it } from "vitest";
import { AccountClient, AccountError, OfflineError } from "../account/api";
import { FriendsFake } from "./fake-friends";
import {
  FRIENDS_MAX,
  FriendsClient,
  NAME_MAX,
  describeFriendsError,
  friendNameProblem,
} from "./api";

async function signedIn() {
  const fake = new FriendsFake();
  const accounts = new AccountClient({
    baseUrl: "https://wol.test",
    fetch: fake.fetch,
    locks: null,
  });
  await accounts.register("carol", "secret-pass");
  return { fake, accounts, client: new FriendsClient(accounts) };
}

describe("FriendsClient", () => {
  it("lists the friends, sorted by name", async () => {
    const { fake, client } = await signedIn();
    fake
      .list("Carol")
      .push(
        { name: "Erin", status: "lobby", room: "Lobby 3" },
        { name: "Dave", status: "game", room: "Last stand" },
      );
    expect(await client.list()).toEqual([
      { name: "Dave", status: "game", room: "Last stand" },
      { name: "Erin", status: "lobby", room: "Lobby 3" },
    ]);
    expect(fake.requests).toEqual(["GET /v1/friends"]);
  });

  it("an answer with no list is an empty list", async () => {
    const { accounts } = await signedIn();
    accounts.bearer = (async () => ({})) as typeof accounts.bearer;
    expect(await new FriendsClient(accounts).list()).toEqual([]);
  });

  it("adds with PUT and removes with DELETE, the name encoded", async () => {
    const { fake, client } = await signedIn();
    fake.known.add("a b/c");
    fake.requests.length = 0;
    await client.add("Dave");
    await client.add("a b/c");
    await client.remove("Dave");
    expect(fake.requests).toEqual([
      "PUT /v1/friends/Dave",
      "PUT /v1/friends/a%20b%2Fc",
      "DELETE /v1/friends/Dave",
    ]);
    expect((await client.list()).map((friend) => friend.name)).toEqual(["a b/c"]);
  });

  it("names the game account with ?account= when asked to", async () => {
    const { fake, client } = await signedIn();
    fake.requests.length = 0;
    await client.add("Dave", "Second One");
    await client.list("Second One");
    await client.remove("Dave", "Second One");
    expect(fake.requests).toEqual([
      "PUT /v1/friends/Dave?account=Second%20One",
      "GET /v1/friends?account=Second%20One",
      "DELETE /v1/friends/Dave?account=Second%20One",
    ]);
  });

  it("raises the server's refusal with its status and sentence", async () => {
    const { fake, client } = await signedIn();
    const unknown = await client.add("Nobody").catch((error: unknown) => error);
    expect(unknown).toBeInstanceOf(AccountError);
    expect(unknown).toMatchObject({ status: 404, message: "No player has that name." });
    await client.add("Dave");
    const twice = await client.add("Dave").catch((error: unknown) => error);
    expect(twice).toMatchObject({ status: 409 });
    const self = await client.add("Carol").catch((error: unknown) => error);
    expect(self).toMatchObject({ status: 400, message: "You cannot add yourself." });
    for (let i = 0; i < FRIENDS_MAX; i++) {
      fake.list("Carol").push({ name: `P${i}`, status: "offline" });
    }
    const full = await client.add("Erin").catch((error: unknown) => error);
    expect(full).toMatchObject({ status: 409, message: "The friends list is full." });
  });

  it("an unreachable server raises OfflineError", async () => {
    const { fake, client } = await signedIn();
    fake.down = true;
    expect(await client.list().catch((error: unknown) => error)).toBeInstanceOf(OfflineError);
  });

  it("refreshes the session once when the token is gone", async () => {
    const { accounts, client } = await signedIn();
    accounts.forget();
    expect(await client.list()).toEqual([]);
    expect(accounts.signedIn).toBe(true);
  });
});

describe("describeFriendsError", () => {
  it("shows the server's sentence for a 400, 404 or 409", () => {
    for (const status of [400, 404, 409]) {
      expect(describeFriendsError(new AccountError("Already a buddy.", status, "unknown"))).toBe(
        "Already a buddy.",
      );
    }
  });

  it("uses the account wording for the rest", () => {
    expect(describeFriendsError(new OfflineError())).toMatch(/cannot be reached/);
    expect(describeFriendsError(new AccountError("x", 429, "rate_limited"))).toMatch(/Too many/);
    expect(describeFriendsError(new Error("boom"))).toBe("Something went wrong. Try again.");
  });
});

describe("friendNameProblem", () => {
  it("accepts 1 to 9 plain characters and says nothing for an empty box", () => {
    expect(friendNameProblem("")).toBeNull();
    expect(friendNameProblem("a")).toBeNull();
    expect(friendNameProblem("x".repeat(NAME_MAX))).toBeNull();
    expect(friendNameProblem("Dave_2-ok")).toBeNull();
  });

  it("refuses a long name, a space and non-ASCII characters", () => {
    expect(friendNameProblem("x".repeat(NAME_MAX + 1))).toMatch(/at most 9/);
    expect(friendNameProblem("two words")).toMatch(/no spaces/);
    expect(friendNameProblem("café")).toMatch(/plain ASCII/);
  });
});
