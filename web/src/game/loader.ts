import { EXPORT_SIGNATURES, type Ra2Exports } from "./protocol";
import { appPath } from "../paths";
import { type GameStore, gameStore } from "./store";
import type { WasmMemory } from "./presenter";
import type { GameRecord } from "../storage/manifest";
import {
  gamePath,
  mountedPath,
  opfsSaveStore,
  opfsTarget,
  READ_IN_PLACE_BYTES,
  readGameFile,
} from "../storage/opfs";
import {
  replaceFile,
  restoreSaves,
  startSaveSync,
  type FsLike,
  type SaveSync,
} from "../storage/saves";
import { loadMods } from "../storage/mods";
import {
  checkExe,
  EMPTY_ARCHIVE,
  loadBuildInfo,
  REQUIRED_MOVIE_ARCHIVES,
  type BuildInfo,
  type GameId,
} from "../storage/install";
import { liveGameFileSource, type ReadOnlyFileSource } from "../storage/file-browser";
import {
  readThaiFont,
  shouldLoadImportedGameFile,
  type ThaiFontPreference,
} from "../storage/thai-fonts";
import { toWolSocketUrl, withBrowserWolPort, wolLineBytes, WolClient } from "./wol";
import { UdpRelay, parseStartHandoff } from "./udp-relay";

/** The two edition bundles share /game and use edition-specific filenames. */
export const GAME_SCRIPT = appPath("game/ra2md.js");
export const gameScript = (game: GameId) =>
  appPath(game === "ra2" ? "game/ra2.js" : "game/ra2md.js");
export function gameModuleFile(game: GameId, moduleBase: string, file: string): string {
  const moduleFile =
    game === "ra2md" && (file === "ra2.wasm" || file === "ra2.data")
      ? `ra2md${file.slice("ra2".length)}`
      : file;
  return `${moduleBase}${moduleFile}`;
}
const gameIni = (game: GameId) => (game === "ra2" ? "ra2.ini" : "ra2md.ini");
const locallyBundledRuntimeFile = /^(?:game|gamemd)\.exe$|^(?:blowfish|binkw32)\.dll$/i;

/** No module for this game is present (docs/web/toolchain.md). */
export class GameNotBuilt extends Error {
  constructor(game: GameId = "ra2md") {
    super(
      `The game is not built. Run build-web.cmd (or build-web.sh) in the repository root${game === "ra2" ? " with RA2_TARGET=game" : ""}.`,
    );
    this.name = "GameNotBuilt";
  }
}

/** What the loader needs of Emscripten's Module. */
interface EmscriptenFs extends FsLike {
  mkdir(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
  symlink(target: string, path: string): void;
}

type RuntimeGame = NonNullable<BuildInfo["games"][GameId]>;

async function runtimeAsset(
  fetcher: typeof fetch,
  url: string,
  expectedSha256: string,
  name: string,
): Promise<Uint8Array> {
  const response = await fetcher(url);
  if (!response.ok)
    throw new Error(`The local runtime bundle is missing ${name}. Rebuild this game target.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  const actual = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== expectedSha256.toLowerCase())
    throw new Error(`${name} does not match build.json. Rebuild this game target.`);
  return bytes;
}

/** Put the build-matched PE and Blowfish tables at the paths the host expects. */
export async function stageRuntimeBundle(
  fs: EmscriptenFs,
  game: GameId,
  build: RuntimeGame,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const runtime = build.runtime;
  if (!runtime || runtime.edition !== game || !build.build || runtime.build !== build.build)
    throw new Error(
      `The ${build.title} runtime bundle is not built or does not match this Wasm build.`,
    );
  const base = `${import.meta.env.BASE_URL}game/runtime/${game}/`;
  const [exe, blowfish] = await Promise.all([
    runtimeAsset(fetcher, `${base}${build.exe}`, runtime.exeSha256, build.exe),
    runtimeAsset(fetcher, `${base}Blowfish.dll`, runtime.blowfishSha256, "Blowfish.dll"),
  ]);
  const check = checkExe(exe.slice(0, 4096), build.stamp, build.exe);
  if (!check.ok) throw new Error(`The bundled executable is invalid: ${check.message}`);
  fs.writeFile(`/game/${build.exe}`, exe);
  fs.writeFile("/game/Blowfish.dll", blowfish);
}

interface Ra2Module extends Partial<WasmMemory> {
  arguments: string[];
  print(line: string): void;
  printErr(line: string): void;
  onAbort(what: unknown): void;
  onRuntimeInitialized(): void;
  /** The runtime comes up first, the page puts the game's files in place, and then it starts main() itself. */
  noInitialRun: boolean;
  callMain(args: string[]): void;
  locateFile(path: string): string;
  cwrap(name: string, returns: string | null, args: string[]): (...values: unknown[]) => unknown;
  FS?: EmscriptenFs;
  ra2WolStart?(username: string, password: string): void;
  ra2WolSend?(line: string): void;
  ra2WolStop?(): void;
  ra2WolReceiveLine?(line: string): void;
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
  return files.kind === "opfs" ? files.record.id : (files.game ?? "ra2md");
}

/** A per-runtime WOL identity. The original key format is 128 ASCII decimal digits. */
export function createWolDataKey(): Uint8Array {
  const digits = new Uint8Array(128);
  const entropy = new Uint8Array(256);
  let written = 0;
  while (written < digits.length) {
    crypto.getRandomValues(entropy);
    for (const byte of entropy) {
      // Discard the six values that would bias modulo-10 digit selection.
      if (byte >= 250) continue;
      digits[written++] = 0x30 + (byte % 10);
      if (written === digits.length) break;
    }
  }
  return digits;
}

function stageWolDataKey(fs: EmscriptenFs, game: GameId): void {
  fs.writeFile("/game/woldata.key", createWolDataKey());
  const name =
    fs.readdir("/game").find((name) => name.toLowerCase() === gameIni(game)) ?? gameIni(game);
  const path = `/game/${name}`;
  let ini = new Uint8Array();
  try {
    ini = fs.readFile(path) as Uint8Array<ArrayBuffer>;
  } catch {
    /* use the native defaults */
  }
  replaceFile(fs, path, withBrowserWolPort(ini));
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

/** Reapply the launcher's explicit size after restored browser settings have replaced the imported INI. */
export function stageVideoSize(
  fs: Pick<FsLike, "readdir" | "readFile" | "writeFile">,
  game: GameId,
  size: VideoSize | null,
): void {
  if (!size) return;
  const name = fs.readdir("/game").find((entry) => entry.toLowerCase() === gameIni(game));
  if (!name) return;
  const path = `/game/${name}`;
  try {
    const ini = new TextDecoder("latin1").decode(fs.readFile(path));
    fs.writeFile(path, new TextEncoder().encode(withVideoSize(ini, size)));
  } catch {
    // A partial import may not have an INI; the game can use its native defaults.
  }
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

export function gameArguments(
  extra: string[] = [],
  thaiFontFix: ThaiFontPreference = { enabled: false, fontId: "" },
): string[] {
  return [
    "--run",
    "--game",
    "/game",
    ...extra,
    ...(thaiFontFix.enabled ? ["--thai-font-fix", "--thai-font-id", thaiFontFix.fontId] : []),
  ];
}

/** Whether this game's module is there. The dev server answers a missing file with the page, so check its content type. */
export async function isBuilt(
  fetcher: typeof fetch = fetch,
  game: GameId = "ra2md",
): Promise<boolean> {
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
  const files = index.files.filter((file) =>
    shouldLoadImportedGameFile(file.name, thaiFontFix.enabled),
  );
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
  stageWolDataKey(fs, game);
  await stageThaiFont(fs, thaiFontFix);
  store.loading("the game");
}

/** Stage the explicit choice at the game's canonical path after imported files and mods load. */
async function stageThaiFont(fs: EmscriptenFs, preference: ThaiFontPreference): Promise<void> {
  if (!preference.enabled) return;
  if (!preference.fontId) throw new Error("Choose a Thai font before enabling the Thai font fix.");
  const bytes = await readThaiFont(preference.fontId);
  replaceFile(fs, "/game/game.fnt", bytes);
}

/**
 * A game the import put in OPFS, into the game's folder. Big files (the archives) are only linked to
 * their copy in OPFS, which the game's thread has mounted at /opfs and reads in place; the small ones
 * are copied into memory, because the game edits some (the picture size, the online port) and reads
 * the rest over and over. Then what the game saved last time goes back over it, and from then on its
 * writes are kept (saves.ts).
 */
async function loadOpfsFiles(
  fs: EmscriptenFs,
  store: GameStore,
  record: GameRecord,
  video: VideoSize | null,
  thaiFontFix: ThaiFontPreference,
): Promise<SaveSync> {
  fs.mkdir("/game");
  const names = Object.keys(record.files).filter(
    (name) =>
      !locallyBundledRuntimeFile.test(name) &&
      shouldLoadImportedGameFile(name, thaiFontFix.enabled),
  );
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
    const isIni = name.toLowerCase() === gameIni(record.id);
    if (entry.size >= READ_IN_PLACE_BYTES && !isIni) {
      fs.symlink(mountedPath(gamePath(entry.home, name)), `/game/${name}`);
    } else {
      const bytes = await readGameFile(entry.home, name);
      const stored =
        video && isIni
          ? new TextEncoder().encode(withVideoSize(new TextDecoder("latin1").decode(bytes), video))
          : bytes;
      fs.writeFile(`/game/${name}`, stored);
    }
    doneBytes += entry.size;
    doneFiles++;
  }
  // Older imports may predate movie stubs, or users may remove one in the file manager.
  // The host probes these archives during startup even when movies are optional.
  const importedNames = new Set(Object.keys(record.files).map((name) => name.toLowerCase()));
  for (const name of REQUIRED_MOVIE_ARCHIVES[record.id]) {
    if (!importedNames.has(name)) fs.writeFile(`/game/${name}`, EMPTY_ARCHIVE);
  }
  const mods = await loadMods(fs, record.storage, {
    excludeGameFont: thaiFontFix.enabled,
    inPlace: true,
  });
  await restoreSaves(
    fs,
    opfsSaveStore(),
    record.storage,
    (path) => !path.startsWith("mods/") || mods.includes(path.split("/")[1] ?? ""),
  );
  stageWolDataKey(fs, record.id);
  // Restored browser settings include the game's INI and can contain a stale mode.
  // The launcher's explicit choice must win for this session and the next save sync.
  stageVideoSize(fs, record.id, video);
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
  const buildInfo = await loadBuildInfo(fetch);
  const runtimeGame = buildInfo.games[game];
  if (!runtimeGame) throw new GameNotBuilt(game);

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
        if (store.getSnapshot().phase !== "exited")
          fail(new Error(`The game aborted: ${String(what)}`));
      },
      locateFile: (path: string) => gameModuleFile(game, moduleBase, path),
    } as Partial<Ra2Module> as Ra2Module;

    let saves: SaveSync | null = null;
    let wolClient: WolClient | null = null;
    let udpRelay: UdpRelay | null = null;
    // Only the operator's build settings choose where game credentials go.
    // HTTP auth and the WOL socket can live at different paths behind a proxy.
    const wolHttpUrl = import.meta.env.VITE_WOL_HTTP_URL ?? "http://127.0.0.1:19090";
    const wolServer = {
      httpUrl: wolHttpUrl,
      socketUrl: import.meta.env.VITE_WOL_SOCKET_URL ?? toWolSocketUrl(wolHttpUrl),
    };
    module.ra2WolStart = (username, password) => {
      udpRelay?.stop();
      wolClient?.close();
      const client = new WolClient(wolServer, username, password);
      wolClient = client;
      client.onLine((line) => {
        if (wolClient !== client) return;
        // STARTG carries the ticket for RA2Web's native datagram relay: open it
        // before the game's OnGameStart so no first packet is lost.
        const handoff = parseStartHandoff(line);
        if (handoff) udpRelay?.start(handoff);
        module.ra2WolReceiveLine?.(line);
      });
      client.onDisconnect(() => {
        if (wolClient === client) module.ra2WolReceiveLine?.("@wolapi disconnected");
      });
      void client.connect({ joinLobby: false }).then(
        () => {
          if (wolClient === client) module.ra2WolReceiveLine?.("@wolapi connected");
        },
        (error: unknown) => {
          if (wolClient === client)
            module.ra2WolReceiveLine?.(
              `@wolapi error ${error instanceof Error ? error.message : String(error)}`,
            );
        },
      );
    };
    module.ra2WolSend = (line) => {
      try {
        // Entering a new lobby/room ends the previous match. PART happens while
        // the native game is still starting, so its relay must stay alive then.
        if (/^(?:join|joingame)\s/i.test(line)) udpRelay?.stop();
        wolClient?.sendRaw(line);
      } catch (error) {
        module.ra2WolReceiveLine?.(
          `@wolapi error ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    module.ra2WolStop = () => {
      udpRelay?.stop();
      wolClient?.close();
      wolClient = null;
    };
    // Files cannot be put in place before the runtime is up (WasmFS's calls into the file system abort in
    // preRun), so the game does not start itself: once it is up the page loads the files and calls main().
    module.noInitialRun = true;
    const files = options.files;
    const loadFiles = (fs: EmscriptenFs): Promise<void> => {
      if (files.kind === "opfs")
        return loadOpfsFiles(fs, store, files.record, files.video ?? null, thaiFontFix).then(
          (sync) => {
            saves = sync;
          },
        );
      if (files.kind === "dev-folder" || files.kind === "test-folder") {
        const base = appPath(files.kind === "test-folder" ? "test-game" : "dev-game");
        return loadDevFiles(fs, store, files.video ?? null, fetch, base, game, thaiFontFix);
      }
      return Promise.resolve();
    };
    module.onRuntimeInitialized = () => {
      try {
        const receiveWol = module.cwrap("ra2_wolapi_receive_line", null, ["array"]);
        module.ra2WolReceiveLine = (line) => {
          receiveWol(wolLineBytes(line));
        };
        const udp = {
          ra2_udp_buffer: module.cwrap("ra2_udp_buffer", "number", []) as () => number,
          ra2_udp_pop: module.cwrap("ra2_udp_pop", "number", ["number"]) as (
            capacity: number,
          ) => number,
          ra2_udp_push: module.cwrap("ra2_udp_push", "number", ["number"]) as (
            length: number,
          ) => number,
        };
        // ?udptrace logs Winsock calls and the relay's datagrams. The router drops the
        // query later, so read it now.
        const udpTrace = typeof location !== "undefined" && /[?&]udptrace/.test(location.search);
        if (udpTrace) (module.cwrap("ra2_net_trace", null, ["number"]) as (on: number) => void)(1);
        udpRelay = new UdpRelay(
          udp,
          () => {
            if (!module.HEAPU8) throw new Error("the game's memory is not up yet");
            return module.HEAPU8;
          },
          undefined,
          (message) => console.warn(`[udp-relay] ${message}`),
          udpTrace,
        );
        const fs = module.FS;
        if (!fs) throw new Error("the game's file system is not up yet");
        loadFiles(fs)
          .then(() => stageRuntimeBundle(fs, game, runtimeGame))
          .then(() => {
            resolve(createHandle(module, saves, game));
            module.callMain(module.arguments);
          }, fail);
      } catch (error) {
        fail(error);
      }
    };

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
