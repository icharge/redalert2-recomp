import { describe, expect, it } from "vitest";
import {
  readFullscreenPreference,
  WINDOWED,
  writeFullscreenPreference,
} from "./fullscreen-preferences";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}

describe("fullscreen preferences", () => {
  it("starts windowed", () => {
    expect(readFullscreenPreference("slot-1-ra2md", memoryStorage())).toEqual(WINDOWED);
  });

  it("remembers fullscreen and the in-game-only choice", () => {
    const storage = memoryStorage();
    writeFullscreenPreference("slot-1-ra2md", { enabled: true, onlyInGame: true }, storage);
    expect(readFullscreenPreference("slot-1-ra2md", storage)).toEqual({
      enabled: true,
      onlyInGame: true,
    });
  });

  it("drops a fullscreen preference when it is turned off", () => {
    const storage = memoryStorage();
    writeFullscreenPreference("slot-1-ra2md", { enabled: true, onlyInGame: false }, storage);
    writeFullscreenPreference("slot-1-ra2md", { enabled: false, onlyInGame: true }, storage);
    expect(storage.values.has("ra2.fullscreen.slot-1-ra2md")).toBe(false);
    expect(readFullscreenPreference("slot-1-ra2md", storage)).toEqual(WINDOWED);
  });

  it("ignores anything that is not a preference", () => {
    const storage = memoryStorage();
    storage.setItem("ra2.fullscreen.slot-1-ra2md", "not json");
    expect(readFullscreenPreference("slot-1-ra2md", storage)).toEqual(WINDOWED);
    storage.setItem("ra2.fullscreen.slot-1-ra2md", JSON.stringify({ enabled: "yes" }));
    expect(readFullscreenPreference("slot-1-ra2md", storage)).toEqual(WINDOWED);
  });
});
