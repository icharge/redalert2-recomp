import { describe, expect, it } from "vitest";
import { AccountClient } from "./api";
import { FakeServer } from "./fake-server";
import { AccountStore } from "./store";

function setup() {
  const server = new FakeServer();
  const page = () =>
    new AccountStore(
      new AccountClient({ baseUrl: "https://wol.test/", fetch: server.fetch, locks: null }),
    );
  return { server, page };
}

describe("AccountStore.restore", () => {
  it("a refused cookie (invalid_refresh) is a guest", async () => {
    const { page } = setup();
    const store = page();
    await store.restore();
    expect(store.getState().status).toBe("guest");
  });

  it.each([
    [401, "unauthorized"],
    [403, "inactive"],
  ])("%i %s is a guest", async (status, errorCode) => {
    const { server, page } = setup();
    server.refusals.set("POST /v1/auth/refresh", { status, errorCode });
    const store = page();
    await store.restore();
    expect(store.getState().status).toBe("guest");
  });

  it.each([
    [429, "rate_limited"],
    [403, "origin_refused"],
    [500, "internal"],
    [503, "unknown"],
  ])("%i %s keeps the session: offline, to retry, not a guest", async (status, errorCode) => {
    const { server, page } = setup();
    await page().register("carol", "secret-pass");
    server.refusals.set("POST /v1/auth/refresh", { status, errorCode });
    const store = page();
    await store.restore();
    expect(store.getState().status).toBe("offline");
    expect(store.getState()).toHaveProperty("notice");
    // the cookie was not spent: once the server answers again, a retry signs the member in
    server.refusals.delete("POST /v1/auth/refresh");
    await store.retry();
    expect(store.getState()).toMatchObject({ status: "member", member: { login: "carol" } });
  });

  it("an unreachable server is offline", async () => {
    const { server, page } = setup();
    server.down = true;
    const store = page();
    await store.restore();
    expect(store.getState().status).toBe("offline");
  });

  it("a reused cookie is a guest who was signed out everywhere", async () => {
    const { server, page } = setup();
    server.refusals.set("POST /v1/auth/refresh", { status: 401, errorCode: "refresh_reused" });
    const store = page();
    await store.restore();
    expect(store.getState()).toMatchObject({
      status: "guest",
      notice: expect.stringMatching(/every device/),
    });
  });
});

describe("AccountClient.refresh", () => {
  it("a rate-limited refresh keeps the token the page holds", async () => {
    const { server } = setup();
    const client = new AccountClient({
      baseUrl: "https://wol.test/",
      fetch: server.fetch,
      locks: null,
    });
    await client.register("carol", "secret-pass");
    server.refusals.set("POST /v1/auth/refresh", { status: 429, errorCode: "rate_limited" });
    await expect(client.refresh()).rejects.toMatchObject({ code: "rate_limited" });
    expect(client.signedIn).toBe(true);
  });
});
