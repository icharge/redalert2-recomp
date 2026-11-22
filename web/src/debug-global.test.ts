import { describe, expect, it } from "vitest";
import { exposeDebugStore } from "./debug-global";

const store = { getSnapshot: () => ({}) };

function page(search: string) {
  return { location: { search } } as unknown as Window & { ra2Store?: unknown };
}

describe("exposeDebugStore", () => {
  it("a production build never exposes the store, whatever the address says", () => {
    for (const search of ["", "?e2e", "?e2e=1", "?test=1"]) {
      const win = page(search);
      exposeDebugStore(win, store, { dev: false, e2eBuild: false });
      expect(win.ra2Store).toBeUndefined();
    }
  });

  it("the dev server always exposes it", () => {
    const win = page("");
    exposeDebugStore(win, store, { dev: true, e2eBuild: false });
    expect(win.ra2Store).toBe(store);
  });

  it("an e2e build (VITE_E2E_HOOKS=1) exposes it when the address asks, with ?e2e or ?test=1", () => {
    for (const [search, exposed] of [
      ["?e2e", true],
      ["?e2e=1", true],
      ["?test=1", true],
      ["", false],
      ["?test=0", false],
    ] as const) {
      const win = page(search);
      exposeDebugStore(win, store, { dev: false, e2eBuild: true });
      expect(win.ra2Store).toBe(exposed ? store : undefined);
    }
  });
});
