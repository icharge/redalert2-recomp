import { afterEach, describe, expect, it } from "vitest";
import { AccountClient, pickLocks } from "./api";
import { FakeServer } from "./fake-server";
import { storageLocks } from "./tab-lock";

afterEach(() => localStorage.clear());

describe("storageLocks: the cross-tab lock without Web Locks", () => {
  it("two tabs refreshing together are queued, so neither looks like a reuse", async () => {
    const server = new FakeServer();
    // each tab its own lock object; they meet only in the shared localStorage, as two tabs would
    const tab = () =>
      new AccountClient({
        baseUrl: "https://wol.test",
        fetch: server.fetch,
        locks: storageLocks(localStorage, { settleMs: 5, pollMs: 5 }),
      });
    await tab().register("carol", "secret-pass");
    const [one, two] = await Promise.all([tab().refresh(), tab().refresh()]);
    expect(one.member.login).toBe("carol");
    expect(two.member.login).toBe("carol");
    expect(server.cookie).not.toBeNull();
  });

  it("runs one at a time and releases on failure", async () => {
    const order: string[] = [];
    const a = storageLocks(localStorage, { settleMs: 2, pollMs: 2 });
    const b = storageLocks(localStorage, { settleMs: 2, pollMs: 2 });
    const run =
      (name: string, fail = false) =>
      async () => {
        order.push(`${name}+`);
        await new Promise((r) => setTimeout(r, 15));
        order.push(`${name}-`);
        if (fail) throw new Error(name);
      };
    await Promise.allSettled([a("x", run("a", true)), b("x", run("b"))]);
    expect(order).toHaveLength(4);
    expect(order[0]!.slice(1)).toBe("+");
    expect(order[1]).toBe(`${order[0]![0]}-`);
    expect(localStorage.length).toBe(0);
  });

  it("takes over a lease a closed tab left behind, once it expires", async () => {
    localStorage.setItem("x", JSON.stringify({ owner: "gone", until: Date.now() + 30 }));
    const lock = storageLocks(localStorage, { settleMs: 2, pollMs: 5, leaseMs: 1000 });
    await expect(lock("x", async () => "ran")).resolves.toBe("ran");
  });
});

describe("pickLocks", () => {
  it("uses Web Locks when the browser has them", async () => {
    let used = false;
    const locks = {
      request: async (_name: string, run: () => Promise<unknown>) => {
        used = true;
        return run();
      },
    };
    await pickLocks({ locks } as unknown as Navigator, localStorage)!("x", async () => 1);
    expect(used).toBe(true);
  });

  it("falls back to the storage lock on an insecure page with no navigator.locks", async () => {
    const lock = pickLocks({} as Navigator, localStorage);
    expect(lock).not.toBeNull();
    await expect(lock!("x", async () => 2)).resolves.toBe(2);
  });
});
