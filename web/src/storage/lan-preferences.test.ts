import { describe, expect, it } from "vitest";
import { lanPlay, readLanPlayPreference, writeLanPlayPreference } from "./lan-preferences";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("LAN play preference", () => {
  it("is on until the player turns it off, and on again after", () => {
    const storage = memoryStorage();
    expect(readLanPlayPreference(storage)).toBe(true);
    writeLanPlayPreference(false, storage);
    expect(readLanPlayPreference(storage)).toBe(false);
    writeLanPlayPreference(true, storage);
    expect(readLanPlayPreference(storage)).toBe(true);
  });

  it("stays on when the browser refuses storage", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLanPlayPreference(blocked)).toBe(true);
  });

  it("says who turned LAN play off: the build wins over the player", () => {
    const storage = memoryStorage();
    expect(lanPlay(storage, true)).toBe("on");
    writeLanPlayPreference(false, storage);
    expect(lanPlay(storage, true)).toBe("player");
    expect(lanPlay(storage, false)).toBe("build");
    writeLanPlayPreference(true, storage);
    expect(lanPlay(storage, false)).toBe("build");
  });
});
