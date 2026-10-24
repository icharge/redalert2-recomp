import { EXPORT_SIGNATURES, type Ra2Exports } from "./protocol";
import { appPath } from "../paths";
import { type GameStore, gameStore } from "./store";
import type { WasmMemory } from "./presenter";
import type { GameRecord } from "../storage/manifest";
import { opfsSaveStore, opfsTarget, readGameFile } from "../storage/opfs";
import { restoreSaves, startSaveSync, type FsLike, type SaveSync } from "../storage/saves";
import { loadMods } from "../storage/mods";
import type { GameId } from "../storage/install";
import { liveGameFileSource, type ReadOnlyFileSource } from "../storage/file-browser";
import { readThaiFont, shouldLoadImportedGameFile, type ThaiFontPreference } from "../storage/thai-fonts";

/** Yuri's Revenge module; Red Alert 2 is nested below /game/ra2. */
export const GAME_SCRIPT = appPath("game/ra2.js");
export const gameScript = (game: GameId) => appPath(game === "ra2" ? "game/ra2/ra2.js" : "game/ra2.js");
const gameIni = (game: GameId) => game === "ra2" ? "ra2.ini" : "ra2md.ini";

/** No module for this game is present (docs/web/toolchain.md). */
export class GameNotBuilt extends Error {
  constructor(game: GameId = "ra2md") {
    super(`The game is not built. Run build-web.cmd (or build-web.sh) in the repository root${game === "ra2" ? " with RA2_TARGET=game" : ""}.`);
    this.name = "GameNotBuilt";
  }
}

/** What the loader needs of Emscripten's Module. */
interface EmscriptenFs extends FsLike {
  mkdir(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
}

interface Ra2Module extends Partial<WasmMemory> {
  arguments: string[];
  print(line: string): void;
  printErr(line: string): void;
  onAbort(what: unknown): void;
  onRuntimeInitialized(): void;
  preRun: (() => void)[];
  locateFile(path: string): string;
  cwrap(name: string, returns: string | null, args: string[]): (...values: unknown[]) => unknown;
  addRunDependency(id: string): void;
  removeRunDependency(id: string): void;
  FS?: EmscriptenFs;
}

declare global {
  interface Window {
    /** Emscripten's classic (non-module) build reads its settings from this before it loads. */
    Module?: Partial<Ra2Module>;
  }
}

export interface GameHandle {
  exports: Ra2Exports;
  memory: () => WasmMemory;
  /** the address of the game's shared picture and cursor (ra2_shared_t) */
  shared: number;
  /** a read-only view rooted at the live /game virtual filesystem */
  files: ReadOnlyFileSource;
  /** keeps the game's writes (saves, settings) in OPFS; null when the files are not from the import */
  saves: SaveSync | null;
}

/** Where /game comes from. The import (stage 6) adds OPFS; for now the dev server's folder. */
export type FileSource =
  | { kind: "dev-folder"; game?: GameId; video?: VideoSize | null }
  | { kind: "test-folder"; game?: GameId; video?: VideoSize | null }
  /** a game the import put in OPFS (storage/importer.ts) */
  | { kind: "opfs"; record: GameRecord; video?: VideoSize | null }
  | { kind: "already-there"; game?: GameId };

export function sourceStorage(files: FileSource): string {
  return files.kind === "opfs" ? files.record.storage : sourceGame(files);
}

export function sourceGame(files: FileSource): GameId {
  return files.kind === "opfs" ? files.record.id : files.game ?? "ra2md";
}

/** A battle's picture size. The game takes it from RA2MD.INI when a game starts. */
export interface VideoSize {
  w: number;
  h: number;
}

/** `?video=1280x720`: measure or try a size without editing the game folder (dev only). */
export function videoFromQuery(search: string): VideoSize | null {
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(new URLSearchParams(search).get("video") ?? "");
  return match ? { w: Number(match[1]), h: Number(match[2]) } : null;
}

/** RA2MD.INI's text with [Video] ScreenWidth and ScreenHeight set, the rest as it was. */
export function withVideoSize(ini: string, size: VideoSize): string {
  const eol = ini.includes("\r\n") ? "\r\n" : "\n";
  const wanted = new Map([
    ["screenwidth", `ScreenWidth=${size.w}`],
    ["screenheight", `ScreenHeight=${size.h}`],
  ]);
  const seen = new Set<string>();
  let section = "";
  let videoAt = -1;
  const lines = ini.split(/\r?\n/).map((line, index) => {
    const header = /^\s*\[([^\]]*)\]/.exec(line);
    if (header) {
      section = (header[1] ?? "").trim().toLowerCase();
      if (section === "video" && videoAt < 0) videoAt = index;
      return line;
    }
    const key = /^\s*([^=;\s]+)\s*=/.exec(line)?.[1]?.toLowerCase();
    const replacement = section === "video" && key ? wanted.get(key) : undefined;
    if (key && replacement) seen.add(key);
    return replacement ?? line;
  });
  const missing = [...wanted].filter(([key]) => !seen.has(key)).map(([, line]) => line);
  if (missing.length > 0) {
    if (videoAt >= 0) lines.splice(videoAt + 1, 0, ...missing);
    else lines.push("[Video]", ...missing);
  }
  return lines.join(eol);
}

export interface StartOptions {
  files: FileSource;
  /** When enabled, an app-managed Thai font replaces imported and mod game.fnt files before startup. */
  thaiFontFix?: ThaiFontPreference;
  /** extra game arguments, after --run and --game */
  args?: string[];
  store?: GameStore;
}

/** The `arg=` values of a URL query, for tests and debugging (docs/web/protocol.md). */
export function argsFromQuery(search: string): string[] {
  return new URLSearchParams(search).getAll("arg");
}

export function gameArguments(extra: string[] = [], thaiFontFix: ThaiFontPreference = { enabled: false, fontId: "" }): string[] {
  return ["--run", "--game", "/game", ...extra,
    ...(thaiFontFix.enabled ? ["--thai-font-fix", "--thai-font-id", thaiFontFix.fontId] : [])];
}

/** Whether this game's module is there. The dev server answers a missing file with the page, so check its content type. */
export async function isBuilt(fetcher: typeof fetch = fetch, game: GameId = "ra2md"): Promise<boolean> {
  try {
    const response = await fetcher(gameScript(game), { method: "HEAD" });
    return response.ok && (response.headers.get("content-type") ?? "").includes("javascript");
  } catch {
    return false;
  }
}

interface DevIndex {
  files: { name: string; size: number }[];
}

/**
 * The body of a response as bytes, telling `onBytes` how many have come as they do. A file of a
 * known size is read straight into one array; a body that cannot be streamed comes whole.
 */
export async function readBody(
  response: Response,
  size: number,
  onBytes: (received: number) => void,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    const whole = new Uint8Array(await response.arrayBuffer());
    onBytes(whole.length);
    return whole;
  }
  let out = new Uint8Array(size > 0 ? size : 1 << 20);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.length > out.length) {
      const bigger = new Uint8Array(Math.max(out.length * 2, received + value.length));
      bigger.set(out.subarray(0, received));
      out = bigger;
    }
    out.set(value, received);
    received += value.length;
    onBytes(received);
  }
  return received === out.length ? out : out.subarray(0, received);
}

/** Dev only (W4.8): the dev server's local game folder, into the in-memory file system. */
async function loadDevFiles(
  fs: EmscriptenFs,
  store: GameStore,
  video: VideoSize | null = null,
  fetcher: typeof fetch = fetch,
  base = "/dev-game",
  game: GameId = "ra2md",
  thaiFontFix: ThaiFontPreference = { enabled: false, fontId: "" },
): Promise<void> {
  const response = await fetcher(`${base}/index.json`);
  if (!response.ok)
    throw new Error("The dev server has no game folder to serve (set RA2_GAME_DIR).");
  const index = (await response.json()) as DevIndex;
  if (index.files.length === 0) throw new Error("The dev server's game folder has no game files.");
  fs.mkdir("/game");
  const files = index.files.filter((file) => shouldLoadImportedGameFile(file.name, thaiFontFix.enabled));
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let doneBytes = 0;
  let doneFiles = 0;
  for (const file of files) {
    const progress = (inFile: number) =>
      store.copying({
        doneBytes: doneBytes + inFile,
        totalBytes,
        doneFiles,
        totalFiles: files.length,
        file: file.name,
      });
    progress(0);
    const data = await fetcher(`${base}/${encodeURIComponent(file.name)}`);
    if (!data.ok) throw new Error(`The dev server would not give ${file.name}.`);
    let last = 0;
    const bytes = await readBody(data, file.size, (received) => {
      // a screen's worth of updates is enough: a few a second
      const now = performance.now();
      if (now - last > 100) {
        last = now;
        progress(received);
      }
    });
    // the picture size asked for in the address replaces what the game's own settings say
    const stored =
      video && file.name.toLowerCase() === gameIni(game)
        ? new TextEncoder().encode(withVideoSize(new TextDecoder("latin1").decode(bytes), video))
        : bytes;
    fs.writeFile(`/game/${file.name}`, stored);
    doneBytes += bytes.length;
    doneFiles++;
  }
  await stageThaiFont(fs, thaiFontFix);
  store.loading("the game");
}

/** Stage the explicit choice at the game's canonical path after imported files and mods load. */
async function stageThaiFont(fs: EmscriptenFs, preference: ThaiFontPreference): Promise<void> {
  if (!preference.enabled) return;
  if (!preference.fontId) throw new Error("Choose a Thai font before enabling the Thai font fix.");
  const bytes = await readThaiFont(preference.fontId);
  fs.writeFile("/game/game.fnt", bytes);
}

/**
 * A game the import put in OPFS, into the in-memory file system: each file whole, one at a time. Then
 * what the game saved last time goes back over it, and from then on its writes are kept (saves.ts).
 */
async function loadOpfsFiles(
  fs: EmscriptenFs,
  store: GameStore,
  record: GameRecord,
  video: VideoSize | null,
  thaiFontFix: ThaiFontPreference,
): Promise<SaveSync> {
  fs.mkdir("/game");
  const names = Object.keys(record.files).filter((name) => shouldLoadImportedGameFile(name, thaiFontFix.enabled));
  const totalBytes = names.reduce((sum, name) => sum + (record.files[name]?.size ?? 0), 0);
  let doneBytes = 0;
  let doneFiles = 0;
  for (const name of names) {
    const entry = record.files[name];
    if (!entry) continue;
    store.copying({
      doneBytes,
      totalBytes,
      doneFiles,
      totalFiles: names.length,
      file: name,
    });
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++) {
      try {
        fs.mkdir(`/game/${parts.slice(0, i).join("/")}`);
      } catch {
        // already there
      }
    }
    const bytes = await readGameFile(entry.home, name);
    const stored =
      video && name.toLowerCase() === gameIni(record.id)
        ? new TextEncoder().encode(withVideoSize(new TextDecoder("latin1").decode(bytes), video))
        : bytes;
    fs.writeFile(`/game/${name}`, stored);
    doneBytes += entry.size;
    doneFiles++;
  }
  const mods = await loadMods(fs, record.storage, { excludeGameFont: thaiFontFix.enabled });
  await restoreSaves(fs, opfsSaveStore(), record.storage, (path) => !path.startsWith("mods/") || mods.includes(path.split("/")[1] ?? ""));
  await stageThaiFont(fs, thaiFontFix);
  store.loading("the game");
  return startSaveSync(fs, opfsTarget(), record.storage);
}

function createHandle(module: Ra2Module, saves: SaveSync | null, game: GameId): GameHandle {
  if (!module.FS) throw new Error("the game's file system is not available yet");
  const exports = {} as Record<string, unknown>;
  for (const [name, { returns, args }] of Object.entries(EXPORT_SIGNATURES)) {
    exports[name] = module.cwrap(name, returns, args);
  }
  const ra2 = exports as unknown as Ra2Exports;
  return {
    exports: ra2,
    memory: () => {
      if (!module.HEAPU8 || !module.HEAP32) throw new Error("the game's memory is not up yet");
      return { HEAPU8: module.HEAPU8, HEAP32: module.HEAP32 };
    },
    shared: ra2.ra2_shared(),
    files: liveGameFileSource(module.FS, game === "ra2" ? "Red Alert 2" : "Yuri's Revenge"),
    saves,
  };
}

/**
 * Loads ra2.js and starts the game. Emscripten's classic build reads window.Module before
 * the script runs; the game's main() then runs on its own thread (PROXY_TO_PTHREAD), and
 * this resolves once the runtime is up, with the game still booting: its events follow in
 * the store. The canvas is not handed over; the picture comes back through shared memory
 * (presenter.ts).
 */
export async function startGame(options: StartOptions): Promise<GameHandle> {
  const store = options.store ?? gameStore;
  const game = sourceGame(options.files);
  const thaiFontFix = options.thaiFontFix ?? { enabled: false, fontId: "" };
  const scriptUrl = gameScript(game);
  const moduleBase = scriptUrl.slice(0, scriptUrl.lastIndexOf("/") + 1);
  store.begin();
  if (!(await isBuilt(fetch, game))) throw new GameNotBuilt(game);

  return new Promise<GameHandle>((resolve, reject) => {
    const fail = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      store.crashed(message);
      reject(error instanceof Error ? error : new Error(message));
    };

    const module = {
      arguments: gameArguments(options.args, thaiFontFix),
      print: (line: string) => store.line(line),
      printErr: (line: string) => store.line(line),
      onAbort: (what: unknown) => {
        if (store.getSnapshot().phase !== "exited") fail(new Error(`The game aborted: ${String(what)}`));
      },
      locateFile: (path: string) => `${moduleBase}${path}`,
      preRun: [] as (() => void)[],
    } as Partial<Ra2Module> as Ra2Module;

    let saves: SaveSync | null = null;
    module.onRuntimeInitialized = () => {
      try { resolve(createHandle(module, saves, game)); }
      catch (error) { fail(error); }
    };

    const files = options.files;
    if (files.kind === "opfs") {
      module.preRun.push(() => {
        module.addRunDependency("game-files");
        const fs = module.FS;
        if (!fs) return fail(new Error("the game's file system is not up yet"));
        loadOpfsFiles(fs, store, files.record, files.video ?? null, thaiFontFix).then(
          (sync) => {
            saves = sync;
            module.removeRunDependency("game-files");
          },
          (error: unknown) => fail(error),
        );
      });
    }
    if (files.kind === "dev-folder" || files.kind === "test-folder") {
      module.preRun.push(() => {
        module.addRunDependency("game-files");
        const fs = module.FS;
        if (!fs) return fail(new Error("the game's file system is not up yet"));
        const video = files.video;
        const base = appPath(files.kind === "test-folder" ? "test-game" : "dev-game");
        loadDevFiles(fs, store, video ?? null, fetch, base, game, thaiFontFix).then(
          () => module.removeRunDependency("game-files"),
          (error: unknown) => fail(error),
        );
      });
    }

    // a trap in the game's thread reaches the page as an uncaught error from its worker
    window.addEventListener("error", (event) => {
      const phase = store.getSnapshot().phase;
      if (phase !== "exited" && phase !== "crashed")
        fail(new Error(event.message || "the game stopped"));
    });

    window.Module = module;
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.onerror = () => fail(new GameNotBuilt(game));
    document.head.append(script);
  });
}
