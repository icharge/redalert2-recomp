import { describe, expect, it } from "vitest";
import { cursorChoice, readCursorPreference, writeCursorPreference } from "./cursor-preferences";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("cursor choice", () => {
  it("draws the page cursor by default", () => {
    const storage = memoryStorage();
    expect(readCursorPreference("slot-1-ra2md", storage)).toBe("page");
    expect(cursorChoice("", "slot-1-ra2md", storage)).toBe("page");
  });

  it("keeps the launcher's choice per installation", () => {
    const storage = memoryStorage();
    writeCursorPreference("slot-1-ra2md", "game", storage);
    expect(readCursorPreference("slot-1-ra2md", storage)).toBe("game");
    expect(readCursorPreference("slot-2-ra2", storage)).toBe("page");
    expect(cursorChoice("", "slot-1-ra2md", storage)).toBe("game");
  });

  it("clears the stored choice when the page layer comes back", () => {
    const storage = memoryStorage();
    writeCursorPreference("slot-1-ra2md", "game", storage);
    writeCursorPreference("slot-1-ra2md", "page", storage);
    expect(storage.values.size).toBe(0);
  });

  it("lets the launcher's own address override it for one launch", () => {
    const storage = memoryStorage();
    writeCursorPreference("slot-1-ra2md", "game", storage);
    expect(cursorChoice("?cursor=page", "slot-1-ra2md", storage)).toBe("page");
    expect(cursorChoice("?cursor=software", "slot-1-ra2md", storage)).toBe("game");
    expect(cursorChoice("?cursor=off", "slot-1-ra2md", storage)).toBe("game");
  });

  it("survives storage that is unavailable", () => {
    expect(readCursorPreference("slot-1-ra2md", null)).toBe("page");
    expect(() => writeCursorPreference("slot-1-ra2md", "game", null)).not.toThrow();
    expect(cursorChoice("", "slot-1-ra2md", null)).toBe("page");
  });
});
