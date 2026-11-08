import { afterEach, describe, expect, it, vi } from "vitest";
import { LAUNCHER_THEMES, readLauncherTheme, writeLauncherTheme } from "./launcher-theme";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("launcher appearance", () => {
  it("defaults safely for missing, invalid and unavailable storage", () => {
    expect(readLauncherTheme()).toBe("retro");
    expect(readLauncherTheme({ getItem: () => "unknown" })).toBe("retro");
    expect(
      readLauncherTheme({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("retro");
    expect(readLauncherTheme(null)).toBe("retro");
  });
  it.each(LAUNCHER_THEMES)("restores $name", ({ id }) => {
    writeLauncherTheme(id);
    expect(readLauncherTheme()).toBe(id);
  });
  it("does not throw when persistence is blocked", () => {
    expect(() =>
      writeLauncherTheme("game-ui", {
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).not.toThrow();
  });
});
