import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAllowsLanPlay } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildAllowsLanPlay", () => {
  it("allows LAN play for true", () => {
    expect(buildAllowsLanPlay("true")).toBe(true);
  });

  it("turns LAN play off only for the exact string false", () => {
    expect(buildAllowsLanPlay("false")).toBe(false);
  });

  it.each([undefined, "", "0", "FALSE", "nope", " false "])(
    "allows LAN play for %j, which is not the exact string false",
    (value) => {
      expect(buildAllowsLanPlay(value)).toBe(true);
    },
  );

  it("reads VITE_SHOW_NETWORK_LAN from the build environment by default", () => {
    vi.stubEnv("VITE_SHOW_NETWORK_LAN", "false");
    expect(buildAllowsLanPlay()).toBe(false);
  });

  it("allows LAN play by default when the build environment does not set it", () => {
    vi.stubEnv("VITE_SHOW_NETWORK_LAN", "");
    expect(buildAllowsLanPlay()).toBe(true);
  });
});
