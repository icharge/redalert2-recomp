import { describe, expect, it } from "vitest";
import { readChatTimePreference, writeChatTimePreference } from "./chat-time-preferences";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

describe("chat time preference", () => {
  it("is on until the player turns it off", () => {
    const storage = memoryStorage();
    expect(readChatTimePreference(storage)).toBe(true);
    writeChatTimePreference(false, storage);
    expect(storage.items.get("ra2-chat-time")).toBe("0");
    expect(readChatTimePreference(storage)).toBe(false);
    writeChatTimePreference(true, storage);
    expect(storage.items.has("ra2-chat-time")).toBe(false);
    expect(readChatTimePreference(storage)).toBe(true);
  });

  it("stays on when storage is unavailable", () => {
    expect(readChatTimePreference(null)).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readChatTimePreference(broken)).toBe(true);
  });
});
