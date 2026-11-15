import { describe, expect, it } from "vitest";
import { AccountClient, AccountError, OfflineError, describeAccountError } from "./api";
import { FakeServer, fakeLocks } from "./fake-server";

function setup() {
  const server = new FakeServer();
  const client = () =>
    new AccountClient({ baseUrl: "https://wol.test/service", fetch: server.fetch, locks: null });
  return { server, client };
}

describe("AccountClient", () => {
  it("signs in and sends every request with credentials, the token only in memory", async () => {
    const { server, client } = setup();
    const a = client();
    await a.register("carol", "secret-pass");
    server.calls.length = 0;
    const b = client();
    const session = await b.login("carol", "secret-pass");
    expect(session.member.login).toBe("carol");
    expect(b.signedIn).toBe(true);
    await b.me();
    expect(server.calls.every((call) => call.credentials === "include")).toBe(true);
    expect(server.calls[0]?.fullPath).toBe("/service/v1/members/login");
    expect(server.calls[1]?.bearer).toBe(session.accessToken);
    // the token is nowhere a reload could read it
    expect(JSON.stringify({ ...localStorage })).not.toContain(session.accessToken);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(session.accessToken);
  });

  it("a refusal carries the status and errorCode", async () => {
    const { client } = setup();
    const error = await client()
      .login("nobody", "whatever1")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccountError);
    expect(error).toMatchObject({ status: 401, code: "bad_credentials" });
  });

  it("restores the session with one refresh from the cookie (a reload)", async () => {
    const { server, client } = setup();
    await client().register("carol", "secret-pass");
    server.calls.length = 0;
    const reloaded = client();
    const session = await reloaded.refresh();
    expect(session.member.login).toBe("carol");
    expect(server.log()).toEqual(["POST /v1/auth/refresh"]);
    expect(reloaded.signedIn).toBe(true);
  });

  it("with no cookie a refresh is refused as invalid_refresh", async () => {
    const { client } = setup();
    await expect(client().refresh()).rejects.toMatchObject({ code: "invalid_refresh" });
  });

  it("a 401 refreshes once and retries once", async () => {
    const { server, client } = setup();
    const c = client();
    await c.register("carol", "secret-pass");
    server.expireAccessTokens();
    server.calls.length = 0;
    const profile = await c.me();
    expect(profile.member.login).toBe("carol");
    expect(server.log()).toEqual([
      "GET /v1/members/me",
      "POST /v1/auth/refresh",
      "GET /v1/members/me",
    ]);
    // the retry carries the new token, which now works without another refresh
    expect(server.calls[2]?.bearer).not.toBe(server.calls[0]?.bearer);
    await c.me();
    expect(server.calls).toHaveLength(4);
  });

  it("does not retry forever: a refused refresh ends the call and the session", async () => {
    const { server, client } = setup();
    const c = client();
    await c.register("carol", "secret-pass");
    server.expireAccessTokens();
    server.cookie = null;
    await expect(c.me()).rejects.toMatchObject({ code: "invalid_refresh" });
    expect(c.signedIn).toBe(false);
    expect(server.log().filter((line) => line === "POST /v1/auth/refresh")).toHaveLength(1);
  });

  it("calls to refresh() at the same time share one request", async () => {
    const { server, client } = setup();
    await client().register("carol", "secret-pass");
    server.calls.length = 0;
    const c = client();
    const [a, b, d] = await Promise.all([c.refresh(), c.refresh(), c.refresh()]);
    expect(a).toBe(b);
    expect(b).toBe(d);
    expect(server.log()).toEqual(["POST /v1/auth/refresh"]);
  });

  it("several bearer calls with an expired token make one refresh", async () => {
    const { server, client } = setup();
    const c = client();
    await c.register("carol", "secret-pass");
    server.expireAccessTokens();
    server.calls.length = 0;
    await Promise.all([c.me(), c.me(), c.me()]);
    expect(server.log().filter((line) => line === "POST /v1/auth/refresh")).toHaveLength(1);
  });

  it("two tabs refreshing together are queued by the lock, so neither looks like a reuse", async () => {
    const { server } = setup();
    const locks = fakeLocks();
    const tab = () =>
      new AccountClient({ baseUrl: "https://wol.test", fetch: server.fetch, locks });
    await tab().register("carol", "secret-pass");
    const [one, two] = await Promise.all([tab().refresh(), tab().refresh()]);
    expect(one.member.login).toBe("carol");
    expect(two.member.login).toBe("carol");
    expect(server.cookie).not.toBeNull();
  });

  it("without the lock two tabs refreshing together are what the server calls a reuse", async () => {
    // the failure the lock prevents: both send the same cookie, the second arrives after the rotation
    const { server, client } = setup();
    await client().register("carol", "secret-pass");
    const results = await Promise.allSettled([client().refresh(), client().refresh()]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(server.cookie).toBeNull();
  });

  it("claims a game account: 201 created, 200 claimed", async () => {
    const { client } = setup();
    const c = client();
    await c.register("carol", "secret-pass");
    const made = await c.addGameAccount("Carol", "game-pass-1");
    expect(made).toMatchObject({ created: true, maxGameAccounts: 1 });
    expect(made.gameAccounts.map((g) => g.username)).toEqual(["Carol"]);
    const d = client();
    await d.register("dave", "secret-pass");
    const claimed = await d.addGameAccount("Taken", "wolpassword");
    expect(claimed.created).toBe(false);
  });

  it("refuses a second game account past the limit and a claim with a wrong password", async () => {
    const { client } = setup();
    const c = client();
    await c.register("carol", "secret-pass");
    await expect(c.addGameAccount("Taken", "not-it-pass")).rejects.toMatchObject({
      status: 403,
      code: "wrong_password",
    });
    await c.addGameAccount("Carol", "game-pass-1");
    await expect(c.addGameAccount("Second", "game-pass-1")).rejects.toMatchObject({
      status: 409,
      code: "limit_reached",
    });
  });

  it("signs out through /v1/auth/logout with the cookie and forgets the token", async () => {
    const { server, client } = setup();
    const c = client();
    await c.register("carol", "secret-pass");
    server.calls.length = 0;
    await c.logout();
    expect(server.log()).toEqual(["POST /v1/auth/logout"]);
    expect(c.signedIn).toBe(false);
    expect(server.cookie).toBeNull();
    await expect(client().refresh()).rejects.toMatchObject({ code: "invalid_refresh" });
  });

  it("signs out everywhere with the bearer token, refreshing it if it expired", async () => {
    const { server, client } = setup();
    const c = client();
    await c.register("carol", "secret-pass");
    server.expireAccessTokens();
    await c.logoutEverywhere();
    expect(server.cookie).toBeNull();
    expect(c.signedIn).toBe(false);
  });

  it("an unreachable server is an OfflineError, and the page keeps its token", async () => {
    const { server, client } = setup();
    const c = client();
    await c.register("carol", "secret-pass");
    server.down = true;
    await expect(c.refresh()).rejects.toBeInstanceOf(OfflineError);
    expect(c.signedIn).toBe(true);
    await expect(c.login("carol", "secret-pass")).rejects.toBeInstanceOf(OfflineError);
  });

  it("reads the server from the base URL, with or without a trailing slash", async () => {
    const server = new FakeServer();
    await new AccountClient({
      baseUrl: "https://wol.test/a/",
      fetch: server.fetch,
      locks: null,
    }).register("carol", "secret-pass");
    expect(server.calls[0]?.fullPath).toBe("/a/v1/members/register");
  });
});

describe("describeAccountError", () => {
  it("words the codes a player can cause", () => {
    const refusal = (code: string) => new AccountError("x", 400, code);
    expect(describeAccountError(refusal("login_taken"))).toMatch(/taken/);
    expect(describeAccountError(refusal("wrong_password"))).toMatch(
      /password of that game account/,
    );
    expect(describeAccountError(refusal("limit_reached"))).toMatch(/all the game accounts/);
    expect(describeAccountError(new OfflineError())).toMatch(/guest/);
    expect(describeAccountError(new AccountError("Server said so", 500, "unknown"))).toBe(
      "Server said so",
    );
  });
});

describe("AccountClient tickets", () => {
  async function member() {
    const { server, client } = setup();
    const c = client();
    await c.register("carol", "secret-pass");
    await c.addGameAccount("Carol", "wol-password");
    server.calls.length = 0;
    return { server, client, c };
  }

  it("launchTicket posts the game account and edition with the bearer", async () => {
    const { server, c } = await member();
    const result = await c.launchTicket("Carol", "yr");
    expect(result).toMatchObject({ edition: "yr", user: "Carol", expiresIn: 60 });
    expect(server.log()).toEqual(["POST /v1/auth/launch-ticket"]);
    expect(server.calls[0]?.bearer).not.toBeNull();
    expect(server.tickets.get(result.ticket)).toMatchObject({ user: "Carol", guest: false });
  });

  it("launchTicket refreshes once on a 401 and retries", async () => {
    const { server, c } = await member();
    server.expireAccessTokens();
    await expect(c.launchTicket("Carol", "ra2")).resolves.toMatchObject({ edition: "ra2" });
    expect(server.log()).toEqual([
      "POST /v1/auth/launch-ticket",
      "POST /v1/auth/refresh",
      "POST /v1/auth/launch-ticket",
    ]);
  });

  it("launchTicket refuses a game account that is not the member's", async () => {
    const { c } = await member();
    await expect(c.launchTicket("Taken", "ra2")).rejects.toMatchObject({
      status: 403,
      code: "not_your_game_account",
    });
  });

  it("guestTicket sends no credential and no refresh", async () => {
    const { server, client } = setup();
    const result = await client().guestTicket("Visitor", "ra2");
    expect(result).toMatchObject({ user: "Visitor", guest: true, edition: "ra2" });
    expect(server.log()).toEqual(["POST /v1/auth/guest"]);
    expect(server.calls[0]?.bearer).toBeNull();
  });

  it("guestTicket says name_taken (409) and bad_nick (400), in words", async () => {
    const { client } = setup();
    const taken = await client()
      .guestTicket("taken", "ra2")
      .catch((e: unknown) => e);
    expect(taken).toMatchObject({ status: 409, code: "name_taken" });
    expect(describeAccountError(taken)).toBe("That name is taken. Choose another.");
    const bad = await client()
      .guestTicket("x", "ra2")
      .catch((e: unknown) => e);
    expect(bad).toMatchObject({ status: 400, code: "bad_nick" });
    expect(describeAccountError(bad)).toMatch(/2 to 9/);
  });
});
