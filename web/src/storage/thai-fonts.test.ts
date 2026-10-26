import { describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_THAI_FONTS,
  listThaiFonts,
  readThaiFont,
  readThaiFontPreference,
  shouldLoadImportedGameFile,
  validateThaiGameFont,
  writeThaiFontPreference,
} from "./thai-fonts";

function validThaiFont(): Uint8Array {
  const glyphCount = 100;
  const stride = 49;
  const bytes = new Uint8Array(28 + 0x20000 + glyphCount * stride);
  bytes.set(new TextEncoder().encode("fonT"));
  const view = new DataView(bytes.buffer);
  view.setUint32(12, 16, true);
  view.setUint32(20, glyphCount, true);
  view.setUint32(24, stride, true);
  for (const code of [
    ...Array.from({ length: 0xda - 0xa1 + 1 }, (_, i) => 0xa1 + i),
    0xdf,
    ...Array.from({ length: 0xfb - 0xe0 + 1 }, (_, i) => 0xe0 + i),
  ]) {
    view.setUint16(28 + code * 2, 1, true);
  }
  return bytes;
}

describe("Thai font storage validation", () => {
  it("lists only the bundled fonts", () => {
    const choices = listThaiFonts();
    expect(choices.map(({ id }) => id)).toEqual(
      expect.arrayContaining(BUILT_IN_THAI_FONTS.map(({ id }) => id)),
    );
    expect(choices).toHaveLength(7);
  });

  it("loads a selected built-in font from the bundled asset", async () => {
    const font = validThaiFont();
    const fetchMock = vi.fn(async () => new Response(font.slice().buffer));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const choice = BUILT_IN_THAI_FONTS[0]!;
      await expect(readThaiFont(choice.id)).resolves.toEqual(font);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/thai-fonts/${choice.asset}.fnt`),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips imported game.fnt only while the fix is enabled", () => {
    expect(shouldLoadImportedGameFile("game.fnt", false)).toBe(true);
    expect(shouldLoadImportedGameFile("game.fnt", true)).toBe(false);
    expect(shouldLoadImportedGameFile("Mods/Test/GAME.FNT", true)).toBe(false);
    expect(shouldLoadImportedGameFile("rules.ini", true)).toBe(true);
  });

  it("accepts a structurally valid FNT with a complete Thai CP874 map", () => {
    expect(validateThaiGameFont(validThaiFont())).toBeNull();
  });

  it("rejects non-FNT data and fonts missing a required Thai glyph", () => {
    expect(validateThaiGameFont(new Uint8Array([1, 2, 3, 4]))).toContain("not a Red Alert 2");
    const font = validThaiFont();
    new DataView(font.buffer).setUint16(28 + 0xe8 * 2, 0, true);
    expect(validateThaiGameFont(font)).toContain("0xE8");
  });

  it("persists the selected fix font independently for each installation edition", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    writeThaiFontPreference("slot-2-ra2", { enabled: false, fontId: "builtin-default" }, storage);
    expect(readThaiFontPreference("slot-2-ra2", storage)).toEqual({
      enabled: false,
      fontId: "builtin-default",
    });
    expect(readThaiFontPreference("slot-3-ra2", storage)).toEqual({
      enabled: false,
      fontId: "builtin-westwood-improved",
    });
  });

  it("turns off a fix that an earlier build saved as on", () => {
    const values = new Map<string, string>([
      [
        "ra2.thai-font.slot-1",
        JSON.stringify({ version: 2, enabled: true, fontId: "builtin-default" }),
      ],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(readThaiFontPreference("slot-1", storage)).toEqual({
      enabled: false,
      fontId: "builtin-default",
    });
    writeThaiFontPreference("slot-1", { enabled: true, fontId: "builtin-default" }, storage);
    expect(readThaiFontPreference("slot-1", storage).enabled).toBe(true);
  });
});
