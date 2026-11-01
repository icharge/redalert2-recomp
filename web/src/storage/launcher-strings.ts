// The launcher's static CSF overrides, `strings.json`.
//
// This file belongs to the launcher build, not to a player's save store and not
// to the game. It is fetched from the app's public root, so an operator can
// change the launcher's text and redeploy without touching anyone's imported
// game. The file is never edited from the page.
//
//   { "version": 1,
//     "ra2":   { "strings": { "GUI:ExitGame": "Exit to Launcher" } },
//     "ra2md": { "strings": { "GUI:ExitGame": "Exit to Launcher" } } }
//
// Each edition may also set "encoding", "enabled", "inject" and "extra".

import { appPath } from "../paths";
import type { CsfEncoding } from "./csf";
import type { GameId } from "./install";

export const LAUNCHER_STRINGS_NAME = "strings.json";
export const LAUNCHER_STRINGS_MAX_BYTES = 256 * 1024;
export const LAUNCHER_STRINGS_VERSION = 1;
const LAUNCHER_STRINGS_URL = appPath(LAUNCHER_STRINGS_NAME);

export type LauncherEncoding = CsfEncoding;

export interface LauncherEditionStrings {
  enabled: boolean;
  encoding: LauncherEncoding;
  strings: Record<string, string>;
  inject: boolean;
  /** WRTS extra bytes, hex-encoded, by label. */
  extra: Record<string, string>;
}

export interface LauncherStringsConfig {
  version: number;
  editions: Partial<Record<GameId, LauncherEditionStrings>>;
}

const ENCODINGS: readonly LauncherEncoding[] = ["windows-1252", "windows-874"];

export function emptyLauncherEdition(): LauncherEditionStrings {
  return {
    enabled: true,
    encoding: "windows-1252",
    strings: {},
    inject: false,
    extra: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertLabel(label: string): void {
  if (!/^[\x20-\x7e]+$/.test(label))
    throw new Error(`The label "${label}" must use printable ASCII characters only.`);
  if (label.length > 255) throw new Error("A CSF label is longer than 255 characters.");
}

function assertText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`The value for ${label} must be text.`);
  if (value.length > 4096)
    throw new Error(`The value for ${label} is too long (over 4,096 characters).`);
  return value;
}

function assertHex(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(?:[0-9a-fA-F]{2})*$/.test(value))
    throw new Error(`The extra data for ${label} must be an even number of hex digits.`);
  if (value.length > 2048) throw new Error(`The extra data for ${label} is too long.`);
  return value.toUpperCase();
}

function parseEdition(value: unknown, edition: GameId): LauncherEditionStrings {
  if (!isRecord(value)) throw new Error(`The ${edition} strings must be an object.`);
  const out = emptyLauncherEdition();
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== "boolean")
      throw new Error(`The ${edition} enabled field must be true or false.`);
    out.enabled = value.enabled;
  }
  if (value.encoding !== undefined) {
    if (!ENCODINGS.includes(value.encoding as LauncherEncoding))
      throw new Error(`The ${edition} encoding must be windows-1252 or windows-874.`);
    out.encoding = value.encoding as LauncherEncoding;
  }
  if (value.inject !== undefined) {
    if (typeof value.inject !== "boolean")
      throw new Error(`The ${edition} inject field must be true or false.`);
    out.inject = value.inject;
  }
  if (value.strings !== undefined) {
    if (!isRecord(value.strings))
      throw new Error(`The ${edition} strings field must be an object.`);
    for (const [label, text] of Object.entries(value.strings)) {
      assertLabel(label);
      out.strings[label.toUpperCase()] = assertText(text, label);
    }
    if (Object.keys(out.strings).length > 20_000)
      throw new Error("The launcher strings have too many overrides.");
  }
  if (value.extra !== undefined) {
    if (!isRecord(value.extra)) throw new Error(`The ${edition} extra field must be an object.`);
    for (const [label, hex] of Object.entries(value.extra)) {
      assertLabel(label);
      out.extra[label.toUpperCase()] = assertHex(hex, label);
    }
  }
  return out;
}

/** Validate a parsed strings.json and normalize labels/hex. */
export function validateLauncherStrings(value: unknown): LauncherStringsConfig {
  if (!isRecord(value)) throw new Error("The launcher strings must be a JSON object.");
  const version = value.version ?? LAUNCHER_STRINGS_VERSION;
  if (version !== LAUNCHER_STRINGS_VERSION)
    throw new Error(`Unsupported strings.json version ${String(version)}; expected 1.`);
  const editions: Partial<Record<GameId, LauncherEditionStrings>> = {};
  for (const edition of ["ra2", "ra2md"] as const) {
    if (value[edition] !== undefined) editions[edition] = parseEdition(value[edition], edition);
  }
  return { version: LAUNCHER_STRINGS_VERSION, editions };
}

export function parseLauncherStrings(text: string): LauncherStringsConfig {
  if (new TextEncoder().encode(text).length > LAUNCHER_STRINGS_MAX_BYTES)
    throw new Error("The launcher strings file is larger than 256 KiB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The launcher strings file is not valid JSON.");
  }
  return validateLauncherStrings(parsed);
}

export function serializeLauncherStrings(value: LauncherStringsConfig): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Fetch and validate the launcher's static strings.json. */
export async function readLauncherStrings(
  fetcher: typeof fetch = fetch,
  url: string = LAUNCHER_STRINGS_URL,
): Promise<LauncherStringsConfig> {
  const response = await fetcher(url, { cache: "no-cache" });
  if (response.status === 404) return { version: LAUNCHER_STRINGS_VERSION, editions: {} };
  if (!response.ok)
    throw new Error(`Could not load ${LAUNCHER_STRINGS_NAME} (${response.status}).`);
  return parseLauncherStrings(await response.text());
}

/** The overrides for one edition, or null when the file does not mention it. */
export function editionStrings(
  config: LauncherStringsConfig,
  game: GameId,
): LauncherEditionStrings | null {
  return config.editions[game] ?? null;
}

/** Convert the extra hex strings to bytes for the CSF codec. */
export function launcherExtras(csf: LauncherEditionStrings): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [label, hex] of Object.entries(csf.extra)) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    out[label] = bytes;
  }
  return out;
}
