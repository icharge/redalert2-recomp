import { afterEach, describe, expect, it, vi } from "vitest";
import { networkLanVisible } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("networkLanVisible", () => {
  it("shows Network (LAN) for true", () => {
    expect(networkLanVisible("true")).toBe(true);
  });

  it("hides Network (LAN) only for the exact string false", () => {
    expect(networkLanVisible("false")).toBe(false);
  });

  it.each([undefined, "", "0", "FALSE", "nope", " false "])(
    "shows Network (LAN) for %j, which is not the exact string false",
    (value) => {
      expect(networkLanVisible(value)).toBe(true);
    },
  );

  it("reads VITE_SHOW_NETWORK_LAN from the build environment by default", () => {
    vi.stubEnv("VITE_SHOW_NETWORK_LAN", "false");
    expect(networkLanVisible()).toBe(false);
  });

  it("shows Network (LAN) by default when the build environment does not set it", () => {
    vi.stubEnv("VITE_SHOW_NETWORK_LAN", "");
    expect(networkLanVisible()).toBe(true);
  });
});
