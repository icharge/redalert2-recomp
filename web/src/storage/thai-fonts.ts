
const PREFERENCE_PREFIX = "ra2.thai-font.";
const PREFERENCE_VERSION = 2;

export interface ThaiFontChoice {
  id: string;
  name: string;
}

export interface BuiltInThaiFont extends ThaiFontChoice {
  asset: string;
}

/** Shipped with the app so the Thai font fix works without uploading a font. */
export const BUILT_IN_THAI_FONTS: readonly BuiltInThaiFont[] = [
  { id: "builtin-default", name: "Tahoma", asset: "default" },
  { id: "builtin-boiling-point", name: "Boiling Point", asset: "boiling-point" },
  { id: "builtin-final-war", name: "Final War", asset: "final-war" },
  { id: "builtin-phobos-improved", name: "Phobos Improved", asset: "phobos-improved" },
  { id: "builtin-reborn", name: "Reborn", asset: "reborn" },
  { id: "builtin-rise-of-the-east", name: "Rise of the East", asset: "rise-of-the-east" },
  { id: "builtin-westwood-improved", name: "Westwood Improved", asset: "westwood-improved" },
];

export interface ThaiFontPreference {
  enabled: boolean;
  fontId: string;
}

export const DEFAULT_THAI_FONT_PREFERENCE: ThaiFontPreference = {
  enabled: true,
  fontId: "builtin-westwood-improved",
};

/** Only the active fix suppresses imported `game.fnt`; all other imported files keep normal priority. */
export function shouldLoadImportedGameFile(path: string, thaiFontFixEnabled: boolean): boolean {
  return !thaiFontFixEnabled || path.split(/[\\/]/).at(-1)?.toLowerCase() !== "game.fnt";
}

/** Validate the bitmap-font structure and the CP874 Thai glyph map used by the fix. */
export function validateThaiGameFont(data: Uint8Array): string | null {
  const signature = String.fromCharCode(...data.subarray(0, 4));
  if (signature !== "fonT" || data.length < 28 + 0x20000) return "This is not a Red Alert 2 game.fnt file.";
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const height = view.getUint32(12, true);
  const count = view.getUint32(20, true);
  const stride = view.getUint32(24, true);
  const records = 28 + 0x20000;
  if (height !== 16 || !count || stride < 49 || records + count * stride !== data.length)
    return "This game.fnt has unsupported dimensions or a truncated glyph table.";
  const thaiCodes = [...Array.from({ length: 0xDA - 0xA1 + 1 }, (_, i) => 0xA1 + i), 0xDF,
    ...Array.from({ length: 0xFB - 0xE0 + 1 }, (_, i) => 0xE0 + i)];
  for (const code of thaiCodes) {
    const glyph = view.getUint16(28 + code * 2, true);
    if (!glyph || glyph > count) return `This font has no Thai glyph for CP874 byte 0x${code.toString(16).toUpperCase()}.`;
  }
  return null;
}

export function listThaiFonts(): ThaiFontChoice[] {
  return [...BUILT_IN_THAI_FONTS]
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function readThaiFont(id: string): Promise<Uint8Array> {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error("Invalid Thai font selection.");
  const builtIn = BUILT_IN_THAI_FONTS.find((font) => font.id === id);
  if (!builtIn) throw new Error("Choose one of the bundled Thai fonts.");
  const response = await fetch(`${import.meta.env.BASE_URL}thai-fonts/${builtIn.asset}.fnt`);
  if (!response.ok) throw new Error(`The bundled Thai font could not be loaded (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const invalid = validateThaiGameFont(bytes);
  if (invalid) throw new Error(`The bundled Thai font is invalid: ${invalid}`);
  return bytes;
}

export function readThaiFontPreference(game: string, storage: Pick<Storage, "getItem"> | null = safeLocalStorage()): ThaiFontPreference {
  try {
    const value: unknown = JSON.parse(storage?.getItem(`${PREFERENCE_PREFIX}${game}`) ?? "null");
    if (typeof value === "object" && value !== null &&
        typeof (value as ThaiFontPreference).enabled === "boolean" &&
        typeof (value as ThaiFontPreference).fontId === "string") {
      const preference = value as ThaiFontPreference;
      const fontId = BUILT_IN_THAI_FONTS.some((font) => font.id === preference.fontId)
        ? preference.fontId
        : DEFAULT_THAI_FONT_PREFERENCE.fontId;
      // Older builds defaulted the fix off, which left the bundled default selected but unstaged.
      const enabled = (value as { version?: number }).version === PREFERENCE_VERSION
        ? preference.enabled
        : true;
      return { enabled, fontId };
    }
  } catch { /* storage may be unavailable or contain an old value */ }
  return DEFAULT_THAI_FONT_PREFERENCE;
}

export function writeThaiFontPreference(game: string, preference: ThaiFontPreference, storage: Pick<Storage, "setItem"> | null = safeLocalStorage()): void {
  try { storage?.setItem(`${PREFERENCE_PREFIX}${game}`, JSON.stringify({ ...preference, version: PREFERENCE_VERSION })); }
  catch { /* private browsing may deny local storage */ }
}

function safeLocalStorage(): Storage | null {
  try { return window.localStorage; }
  catch { return null; }
}
