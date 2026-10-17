// What the page and the game say to each other (docs/web/protocol.md). The C side is
// src/web/web_api.h: change the two together, and RA2_WEB_PROTOCOL with them.

export const RA2_WEB_PROTOCOL = 1;

// ---- game to page: events -----------------------------------------------------------
// One line on stdout, "@ra2 " and JSON.

export type GameEvent =
  | { e: "boot"; protocol: number; title: string; exe: string; stamp: number }
  | { e: "menu" }
  | { e: "mode"; w: number; h: number }
  | { e: "fps"; fps: number; ms: number }
  | { e: "exit"; code: number }
  | { e: "error"; message: string };

const PREFIX = "@ra2 ";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The event a log line carries, or null for any other line (or a malformed one). */
export function parseEventLine(line: string): GameEvent | null {
  if (!line.startsWith(PREFIX)) return null;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(PREFIX.length));
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  switch (value.e) {
    case "boot":
      if (
        typeof value.protocol === "number" &&
        typeof value.title === "string" &&
        typeof value.exe === "string" &&
        typeof value.stamp === "number"
      ) {
        return {
          e: "boot",
          protocol: value.protocol,
          title: value.title,
          exe: value.exe,
          stamp: value.stamp,
        };
      }
      return null;
    case "menu":
      return { e: "menu" };
    case "mode":
      return typeof value.w === "number" && typeof value.h === "number"
        ? { e: "mode", w: value.w, h: value.h }
        : null;
    case "fps":
      return typeof value.fps === "number" && typeof value.ms === "number"
        ? { e: "fps", fps: value.fps, ms: value.ms }
        : null;
    case "exit":
      return typeof value.code === "number" ? { e: "exit", code: value.code } : null;
    case "error":
      return typeof value.message === "string" ? { e: "error", message: value.message } : null;
    default:
      return null;
  }
}

// ---- the picture and the cursor: shared memory ---------------------------------------
// ra2_shared() returns the address of a struct of 32-bit words (ra2_shared_t). The game
// thread fills it; the page reads it each animation frame.

/** Word indexes into the struct, as an Int32Array over the wasm memory sees it. */
export const Shared = {
  protocol: 0,
  frameSeq: 1,
  framePtr: 2,
  frameW: 3,
  frameH: 4,
  cursorSeq: 5,
  cursorKind: 6,
  cursorHotX: 7,
  cursorHotY: 8,
  viewW: 9,
  viewH: 10,
  viewDpr: 11,
} as const;

/** Byte offset of the cursor's 32x32 RGBA pixels in the struct. */
export const CURSOR_RGBA_OFFSET = 52;
export const CURSOR_PX = 32;

export const CursorKind = {
  /** The game draws its own cursor: hide the system one. */
  None: 0,
  /** The game's cursor image, with its hot spot. */
  Image: 1,
  /** The system arrow. */
  Arrow: 2,
} as const;
export type CursorKind = (typeof CursorKind)[keyof typeof CursorKind];

// ---- page to game: exported functions -------------------------------------------------

/** The kinds of ra2_input_pointer. */
export const PointerKind = { Move: 0, Down: 1, Up: 2 } as const;

/** The functions the page calls on the loaded module, wrapped by `cwrap`. */
export interface Ra2Exports {
  ra2_shared(): number;
  ra2_resize(width: number, height: number, dpr: number): void;
  ra2_set_volume(volume: number): void;
  ra2_focus(focused: number): void;
  ra2_quit(): void;
  /** kind: PointerKind; x and y in game pixels; button as the DOM numbers it (0 left, 1 middle, 2 right) */
  ra2_input_pointer(kind: number, x: number, y: number, button: number): void;
  /** vk: a Windows virtual key; scan: the set-1 scan code */
  ra2_input_key(down: number, vk: number, scan: number): void;
  ra2_crash_report(why: string): void;
}

export const EXPORT_SIGNATURES: {
  [K in keyof Ra2Exports]: { returns: "number" | null; args: ("number" | "string")[] };
} = {
  ra2_shared: { returns: "number", args: [] },
  ra2_resize: { returns: null, args: ["number", "number", "number"] },
  ra2_set_volume: { returns: null, args: ["number"] },
  ra2_focus: { returns: null, args: ["number"] },
  ra2_quit: { returns: null, args: [] },
  ra2_input_pointer: { returns: null, args: ["number", "number", "number", "number"] },
  ra2_input_key: { returns: null, args: ["number", "number", "number"] },
  ra2_crash_report: { returns: null, args: ["string"] },
};
