import { describe, expect, it } from "vitest";
import { AccountClient } from "./account/api";
import { FakeServer } from "./account/fake-server";
import { AccountStore } from "./account/store";
import { DEV_PROXY_PATH, resolveWolHttpUrl, wolDevProxy } from "./wol-endpoint";

describe("resolveWolHttpUrl", () => {
  it("on the dev server with no setting, the server is the page's own origin, through the proxy", () => {
    expect(resolveWolHttpUrl({ dev: true, origin: "http://localhost:5173" })).toBe(
      `http://localhost:5173${DEV_PROXY_PATH}`,
    );
  });

  it("a configured server wins, in dev too", () => {
    expect(
      resolveWolHttpUrl({
        configured: "https://service.example/",
        dev: true,
        origin: "http://localhost:5173",
      }),
    ).toBe("https://service.example/");
  });

  it("a member stays signed in after a reload of the dev page on localhost", async () => {
    // the bug: the page on localhost:5173, the server on 127.0.0.1:9090, a cross-site cookie
    const server = new FakeServer();
    server.pageOrigin = "http://localhost:5173";
    const baseUrl = resolveWolHttpUrl({ dev: true, origin: server.pageOrigin });
    const page = () =>
      new AccountStore(new AccountClient({ baseUrl, fetch: server.fetch, locks: null }));
    await page().register("carol", "secret-pass");
    const reloaded = page();
    await reloaded.restore();
    expect(reloaded.getState()).toMatchObject({ status: "member", member: { login: "carol" } });
  });
});

describe("wolDevProxy", () => {
  it("forwards HTTP and WebSockets under the prefix to the server, without the prefix", () => {
    const proxy = wolDevProxy("http://127.0.0.1:9090");
    const route = proxy[DEV_PROXY_PATH.slice(0, -1)]!;
    expect(route.target).toBe("http://127.0.0.1:9090");
    expect(route.ws).toBe(true);
    expect(route.rewrite(`${DEV_PROXY_PATH}v1/auth/refresh`)).toBe("/v1/auth/refresh");
    expect(route.rewrite(DEV_PROXY_PATH)).toBe("/");
  });

  it("moves the refresh cookie's path under the prefix, so the page sends it back", () => {
    const route = wolDevProxy("http://127.0.0.1:9090")[DEV_PROXY_PATH.slice(0, -1)]!;
    expect(route.cookiePathRewrite).toEqual({ "/v1/auth": `${DEV_PROXY_PATH}v1/auth` });
  });
});
