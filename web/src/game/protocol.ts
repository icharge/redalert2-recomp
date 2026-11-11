// What the page and the game say to each other (docs/web/protocol.md). The C side is
// src/web/web_api.h: change the two together, and RA2_WEB_PROTOCOL with them.

export const RA2_WEB_PROTOCOL = 13;

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
  | {
      e: "mapSearch";
      open: boolean;
      noMatches: boolean;
      x: number;
      y: number;
      w: number;
      h: number;
    }
  /** the player pressed the game's Find Maps button (src/web/map_search.c) */
  | { e: "mapFinder" }
  /** the native finder screen (src/web/finder_screen.c): the player pressed Search, or Add on a result */
  | { e: "mapFinderSearch"; q: string }
  | { e: "mapFinderAdd"; sha1: string }
  | { e: "mapFinderPreview"; sha1: string }
  | { e: "fps"; fps: number; ms: number; pacing: Pacing | null }
  | { e: "exit"; code: number }
  | { e: "exitConfirm"; request: number }
  | { e: "saveReference"; request: number }
  /**
   * A WOL-era link. `url` is the game's own string, unchanged, or "" when the
   * game only named a WOL page (YR's DoWebPageDialog passes a page key, not a
   * URL); `page` carries that key so the dialog never shows a made-up URL.
   */
  | { e: "open"; url: string; ask: number; seq: number; page?: string }
  | { e: "settingsSaved"; path: string }
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
    case "mapSearch":
      return typeof value.open === "boolean" &&
        typeof value.noMatches === "boolean" &&
        typeof value.x === "number" &&
        typeof value.y === "number" &&
        typeof value.w === "number" &&
        typeof value.h === "number"
        ? {
            e: "mapSearch",
            open: value.open,
            noMatches: value.noMatches,
            x: value.x,
            y: value.y,
            w: value.w,
            h: value.h,
          }
        : null;
    case "mapFinder":
      return { e: "mapFinder" };
    case "mapFinderSearch":
      return typeof value.q === "string" ? { e: "mapFinderSearch", q: value.q } : null;
    case "mapFinderAdd":
      return typeof value.sha1 === "string" ? { e: "mapFinderAdd", sha1: value.sha1 } : null;
    case "mapFinderPreview":
      return typeof value.sha1 === "string" ? { e: "mapFinderPreview", sha1: value.sha1 } : null;
    case "fps":
      return typeof value.fps === "number" && typeof value.ms === "number"
        ? { e: "fps", fps: value.fps, ms: value.ms, pacing: pacingOf(value) }
        : null;
    case "exit":
      return typeof value.code === "number" ? { e: "exit", code: value.code } : null;
    case "exitConfirm":
      return Number.isInteger(value.request) &&
        Number(value.request) > 0 &&
        Number(value.request) <= 0xffffffff
        ? { e: "exitConfirm", request: Number(value.request) }
        : null;
    case "saveReference":
      return Number.isInteger(value.request) &&
        Number(value.request) > 0 &&
        Number(value.request) <= 0xffffffff
        ? { e: "saveReference", request: Number(value.request) }
        : null;
    case "settingsSaved":
      return typeof value.path === "string" ? { e: "settingsSaved", path: value.path } : null;
    case "open":
      if (
        typeof value.url !== "string" ||
        typeof value.ask !== "number" ||
        typeof value.seq !== "number"
      )
        return null;
      if (value.page !== undefined && typeof value.page !== "string") return null;
      return value.page === undefined
        ? { e: "open", url: value.url, ask: value.ask, seq: value.seq }
        : { e: "open", url: value.url, ask: value.ask, seq: value.seq, page: value.page };
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
  /** A seqlock: odd while the game publishes a picture, even when it is whole. Take a picture only at an even value that did not change while reading (docs/web/protocol.md). */
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
  /** protocol 11: 1 while a match is loading, playing or showing its score screen; 0 in the menus */
  matchState: 12,
  gameW: 1037,
  gameH: 1038,
  warpSeq: 1039,
  warpX: 1040,
  warpY: 1041,
  pointerX: 1042,
  pointerY: 1043,
  /** the raw picture's format (PixelFormat); protocol 8 */
  format: 1044,
  /** bytes per row of the raw picture */
  framePitch: 1045,
  /** PAL8: 256 words, r | g << 8 | b << 16 */
  palettePtr: 1046,
  /**
   * The buffer the page is reading (0 to 2), -1 for none. Written with Atomics.store only. The page's reads:
   * read frameIndex and framePtr; store readIndex = that index; re-read frameIndex and framePtr and retry if
   * either changed; read the pixels; store -1 when done (docs/web/protocol.md).
   */
  readIndex: 1047,
  /** the buffer framePtr is in (0 to 2); the page reads it with Atomics.load */
  frameIndex: 1048,
  /** the HD vehicle layers (filled by the GPU path; 0 until then) */
  hdLayer1x: 1049,
  hdLayer2x: 1050,
  hdRects: 1051,
  hdRectCount: 1052,
  hdSeq: 1053,
  /** the page sets 1 to ask for a full picture; the game clears it */
  republish: 1054,
  /** 0 (the default) publishes RGBA as before; 1 publishes the game's own format raw (PresentMode.Raw) */
  presentMode: 1055,
  /** the in-match game cursor, protocol 10 (docs/web/cursor-layer.md) */
  pageCursorSeq: 1056,
  pageCursorKind: 1057,
  pageCursorHotX: 1058,
  pageCursorHotY: 1059,
  pageCursorW: 1060,
  pageCursorH: 1061,
  /** the page sets 1 here while it draws the cursor itself; the game then skips its own blit */
  pageCursorRequest: 1062,
  /** the SHP's largest frame: the sheet the frame is placed in */
  pageCursorSheetW: 1063,
  pageCursorSheetH: 1064,
  /** the frame's offset inside that sheet */
  pageCursorX: 1065,
  pageCursorY: 1066,
  /** goes up whenever the cursor palette below is copied */
  pageCursorPaletteSeq: 1067,
} as const;

/** The pixel formats of a raw picture (Shared.format). */
export const PixelFormat = { Rgba: 0, Rgb565: 1, Pal8: 2, Bgrx: 3 } as const;
/** Shared.presentMode: what the game publishes. */
export const PresentMode = { Rgba: 0, Raw: 1 } as const;

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

/** Byte offset of the cursor palette (768 bytes of r, g, b, each 0..63). */
export const PAGE_CURSOR_PALETTE_OFFSET = 1068 * 4;
export const PALETTE_BYTES = 768;
/** Byte offset of the frame: w*h palette indices, index 0 transparent. */
export const PAGE_CURSOR_INDICES_OFFSET = PAGE_CURSOR_PALETTE_OFFSET + PALETTE_BYTES;
export const PAGE_CURSOR_PX = 64;

/** Shared.pageCursorKind: the in-match cursor the game captured for the page. */
export const PageCursorKind = {
  /** no sprite yet, or the game stopped drawing its cursor */
  None: 0,
  /** pageCursorRGBA, with its hot spot */
  Image: 1,
} as const;
export type PageCursorKind = (typeof PageCursorKind)[keyof typeof PageCursorKind];

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
  /** shared scratch packet buffer for the page's WebRTC/IPX bridge */
  ra2_net_buffer(): number;
  /** pop one packet (source socket, destination socket, payload); 0 means empty */
  ra2_net_pop(capacity: number): number;
  /** push bytes already in ra2_net_buffer into the game's IPX receive queue */
  ra2_net_push(length: number): number;
  ra2_resize(width: number, height: number, dpr: number): void;
  ra2_set_volume(volume: number): void;
  /** the address of the sound ring (hle_audio_ring_t) */
  ra2_audio(): number;
  /** 1 while the page has an audio context running and reads the ring; 0 otherwise */
  ra2_audio_live(live: number): void;
  ra2_focus(focused: number): void;
  /** 1 (the default) lets the game's music play anywhere; 0 keeps it for matches (the mixer silences it elsewhere) */
  ra2_set_menu_music(allowed: number): void;
  ra2_quit(): void;
  /** queued to the game thread; settings are owned and saved by the host */
  ra2_setting(key: number, value: number, extra: number): void;
  /** reply to the intercepted Exit confirmation without creating a native dialog */
  ra2_exit_confirmation_reply(request: number, exitGame: number): number;
  ra2_web_save_reference_reply(request: number, ignore: number): number;
  /** kind: PointerKind; x and y in game pixels; button as the DOM numbers it (0 left, 1 middle, 2 right) */
  ra2_input_pointer(kind: number, x: number, y: number, button: number): void;
  /** vk: a Windows virtual key; scan: the set-1 scan code */
  ra2_input_key(down: number, vk: number, scan: number): void;
  /** a wheel turn at x, y in game pixels: 120 a notch, positive away from the player; missing in older builds */
  ra2_input_wheel?(delta: number, x: number, y: number): void;
  /** committed Unicode text; the game host converts supported characters to CP874 WM_CHAR messages */
  ra2_input_text(text: string): void;
  /** Yuri's Revenge: scan the game's map folder again on the game thread; truncate 1 replaces the list, 0 appends */
  ra2_maps_rescan(truncate: number): void;
  /** the native finder screen: lines of "sha1 TAB flags TAB name" (flags: u unreviewed, a already added) replace its rows */
  ra2_finder_results(tsv: string): void;
  /** one line in its list that is no map; "" clears it */
  ra2_finder_note(text: string): void;
  /** an add ended: the map is in (1) or is not (0) */
  ra2_finder_added(sha1: string, added: number): void;
  /** the map is in the game's folder as `file`, for the finder's preview; the game removes the file */
  ra2_finder_preview(sha1: string, file: string): void;
  ra2_crash_report(why: string): void;
}

export const EXPORT_SIGNATURES: {
  [K in keyof Ra2Exports]: { returns: "number" | null; args: ("number" | "string")[] };
} = {
  ra2_shared: { returns: "number", args: [] },
  ra2_net_buffer: { returns: "number", args: [] },
  ra2_net_pop: { returns: "number", args: ["number"] },
  ra2_net_push: { returns: "number", args: ["number"] },
  ra2_resize: { returns: null, args: ["number", "number", "number"] },
  ra2_set_volume: { returns: null, args: ["number"] },
  ra2_audio: { returns: "number", args: [] },
  ra2_audio_live: { returns: null, args: ["number"] },
  ra2_focus: { returns: null, args: ["number"] },
  ra2_set_menu_music: { returns: null, args: ["number"] },
  ra2_quit: { returns: null, args: [] },
  ra2_setting: { returns: null, args: ["number", "number", "number"] },
  ra2_exit_confirmation_reply: { returns: "number", args: ["number", "number"] },
  ra2_web_save_reference_reply: { returns: "number", args: ["number", "number"] },
  ra2_input_pointer: { returns: null, args: ["number", "number", "number", "number"] },
  ra2_input_key: { returns: null, args: ["number", "number", "number"] },
  ra2_input_wheel: { returns: null, args: ["number", "number", "number"] },
  ra2_input_text: { returns: null, args: ["string"] },
  ra2_maps_rescan: { returns: null, args: ["number"] },
  ra2_finder_results: { returns: null, args: ["string"] },
  ra2_finder_note: { returns: null, args: ["string"] },
  ra2_finder_added: { returns: null, args: ["string", "number"] },
  ra2_finder_preview: { returns: null, args: ["string", "string"] },
  ra2_crash_report: { returns: null, args: ["string"] },
};
