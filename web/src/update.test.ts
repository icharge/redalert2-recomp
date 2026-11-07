import { describe, expect, it, vi } from "vitest";
import { checkForUpdate } from "./update";

const container = (registration: Partial<ServiceWorkerRegistration> | undefined) => ({
  getRegistration: vi.fn(async () => registration as ServiceWorkerRegistration | undefined),
});

describe("checkForUpdate", () => {
  it("has nothing to ask without a service worker", async () => {
    expect(await checkForUpdate(undefined)).toBe("none");
    expect(await checkForUpdate(container(undefined))).toBe("none");
  });

  it("asks the worker for the newest build, under the page's base", async () => {
    const update = vi.fn(async () => {});
    const sw = container({ update, installing: null, waiting: null } as never);
    expect(await checkForUpdate(sw, "/emu/")).toBe("current");
    expect(sw.getRegistration).toHaveBeenCalledWith("/emu/");
    expect(update).toHaveBeenCalled();
  });

  it("finds a build that is installing or waiting", async () => {
    const update = async () => {};
    expect(
      await checkForUpdate(container({ update, installing: {}, waiting: null } as never)),
    ).toBe("found");
    expect(
      await checkForUpdate(container({ update, installing: null, waiting: {} } as never)),
    ).toBe("found");
  });
});
