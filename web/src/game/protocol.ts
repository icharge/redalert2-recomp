// What the page and the game say to each other (docs/web/protocol.md). The C side is
// src/web/web_api.h: change the two together, and RA2_WEB_PROTOCOL with them.

export const RA2_WEB_PROTOCOL = 3;

export const SCALES = ["sharp", "smooth", "crt", "nearest", "integer"] as const;
export type Scale = (typeof SCALES)[number];
export interface HostSettings {
  open: boolean;
  scale: Scale;
  bars: boolean;
  hd: boolean;
  modern: boolean;
  width: number;
  height: number;
  mod: string;
}
export const Setting = { Scale: 0, Bars: 1, Hd: 2, Modern: 3, Resolution: 4, Menu: 5 } as const;

// ---- game to page: events -----------------------------------------------------------
// One line on stdout, "@ra2 " and JSON.

/** How evenly the game's frames came in the last second (the game's own clock). */
export interface Pacing {
  /** the longest gap between two game frames, ms */
  worstMs: number;
  /** how many game frames came more than 25 ms after the one before */
  late: number;
  /** pictures the game published, and the mean ms one took to make */
  published: number;
  publishMs: number;
}

export type GameEvent =
  | { e: "boot"; protocol: number; title: string; exe: string; stamp: number }
  | { e: "menu" }
  | ({ e: "settings" } & HostSettings)
  | { e: "restart"; mod: string }
  | { e: "mode"; w: number; h: number }
  | { e: "fps"; fps: number; ms: number; pacing: Pacing | null }
  | { e: "exit"; code: number }
  | { e: "error"; message: string };

const PREFIX = "@ra2 ";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pacingOf(value: Record<string, unknown>): Pacing | null {
  const { worst, late, pub, pubms } = value;
  return typeof worst === "number" &&
    typeof late === "number" &&
    typeof pub === "number" &&
    typeof pubms === "number"
    ? { worstMs: worst, late, published: pub, publishMs: pubms }
    : null;
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
    case "restart":
      return typeof value.mod === "string" ? { e: "restart", mod: value.mod } : null;
    case "settings":
      if (
        typeof value.open !== "boolean" ||
        typeof value.bars !== "boolean" ||
        typeof value.hd !== "boolean" ||
        typeof value.modern !== "boolean" ||
        typeof value.width !== "number" ||
        typeof value.height !== "number" ||
        typeof value.mod !== "string" ||
        !SCALES.includes(value.scale as Scale)
      )
        return null;
      return {
        e: "settings",
        open: value.open,
        scale: value.scale as Scale,
        bars: value.bars,
        hd: value.hd,
        modern: value.modern,
        width: value.width,
        height: value.height,
        mod: value.mod,
      };
    case "mode":
      return typeof value.w === "number" && typeof value.h === "number"
        ? { e: "mode", w: value.w, h: value.h }
        : null;
    case "fps":
      return typeof value.fps === "number" && typeof value.ms === "number"
        ? { e: "fps", fps: value.fps, ms: value.ms, pacing: pacingOf(value) }
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
  gameW: 1037,
  gameH: 1038,
  warpSeq: 1039,
  warpX: 1040,
  warpY: 1041,
  pointerX: 1042,
  pointerY: 1043,
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
  /** Cursor image rendered above the game's separate sidebar while paused. */
  Overlay: 3,
} as const;
export type CursorKind = (typeof CursorKind)[keyof typeof CursorKind];

// ---- the sound: a ring in shared memory ---------------------------------------------------
// ra2_audio() returns the address of hle_audio_ring_t (pcrecomp win32hle.h): words, then 16-bit
// stereo frames. The game's mixer thread writes `wr`; while `live` is 1 the audio worklet
// (public/audio-worklet.js) reads and moves `rd`. Both count frames and only go up.

/** Word indexes into the ring header, as an Int32Array over the wasm memory sees it. */
export const AudioRing = {
  rd: 0,
  wr: 1,
  live: 2,
  capacity: 3,
  rate: 4,
  underruns: 5,
  mixed: 6,
  low: 7,
} as const;

/** Byte offset of the ring's interleaved s16 frames. */
export const AUDIO_PCM_OFFSET = 32;

// ---- page to game: exported functions -------------------------------------------------

/** The kinds of ra2_input_pointer. */
export const PointerKind = { Move: 0, Down: 1, Up: 2 } as const;

/** The functions the page calls on the loaded module, wrapped by `cwrap`. */
export interface Ra2Exports {
  ra2_shared(): number;
  ra2_resize(width: number, height: number, dpr: number): void;
  ra2_set_volume(volume: number): void;
  /** the address of the sound ring (hle_audio_ring_t) */
  ra2_audio(): number;
  /** 1 while the page has an audio context running and reads the ring; 0 otherwise */
  ra2_audio_live(live: number): void;
  ra2_focus(focused: number): void;
  ra2_quit(): void;
  /** queued to the game thread; settings are owned and saved by the host */
  ra2_setting(key: number, value: number, extra: number): void;
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
  ra2_audio: { returns: "number", args: [] },
  ra2_audio_live: { returns: null, args: ["number"] },
  ra2_focus: { returns: null, args: ["number"] },
  ra2_quit: { returns: null, args: [] },
  ra2_setting: { returns: null, args: ["number", "number", "number"] },
  ra2_input_pointer: { returns: null, args: ["number", "number", "number", "number"] },
  ra2_input_key: { returns: null, args: ["number", "number", "number"] },
  ra2_crash_report: { returns: null, args: ["string"] },
};
