import { EXPORT_SIGNATURES, type Ra2Exports } from "./protocol";
import { type GameStore, gameStore } from "./store";
import type { WasmMemory } from "./presenter";

/** Where the build leaves the game (web/public/game, build-web.sh). */
export const GAME_SCRIPT = "/game/ra2.js";

/** There is no ra2.js to load: the game has not been built (docs/web/toolchain.md). */
export class GameNotBuilt extends Error {
  constructor() {
    super("The game is not built. Run build-web.cmd (or build-web.sh) in the repository root.");
    this.name = "GameNotBuilt";
  }
}

/** What the loader needs of Emscripten's Module. */
interface EmscriptenFs {
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
}

/** Where /game comes from. The import (stage 6) adds OPFS; for now the dev server's folder. */
export type FileSource = { kind: "dev-folder" } | { kind: "already-there" };

export interface StartOptions {
  files: FileSource;
  /** extra game arguments, after --run and --game */
  args?: string[];
  store?: GameStore;
}

/** The `arg=` values of a URL query, for tests and debugging (docs/web/protocol.md). */
export function argsFromQuery(search: string): string[] {
  return new URLSearchParams(search).getAll("arg");
}

export function gameArguments(extra: string[] = []): string[] {
  return ["--run", "--game", "/game", ...extra];
}

/** Whether ra2.js is there. The dev server answers a missing file with the page, so look at what came back. */
export async function isBuilt(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(GAME_SCRIPT, { method: "HEAD" });
    return response.ok && (response.headers.get("content-type") ?? "").includes("javascript");
  } catch {
    return false;
  }
}

interface DevIndex {
  files: { name: string; size: number }[];
}

/** Dev only (W4.8): the dev server's local game folder, into the in-memory file system. */
async function loadDevFiles(
  fs: EmscriptenFs,
  store: GameStore,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher("/dev-game/index.json");
  if (!response.ok)
    throw new Error("The dev server has no game folder to serve (set RA2_GAME_DIR).");
  const index = (await response.json()) as DevIndex;
  if (index.files.length === 0) throw new Error("The dev server's game folder has no game files.");
  fs.mkdir("/game");
  let done = 0;
  for (const file of index.files) {
    store.loading(`${file.name} (${++done} of ${index.files.length})`);
    const data = await fetcher(`/dev-game/${encodeURIComponent(file.name)}`);
    if (!data.ok) throw new Error(`The dev server would not give ${file.name}.`);
    fs.writeFile(`/game/${file.name}`, new Uint8Array(await data.arrayBuffer()));
  }
}

function createHandle(module: Ra2Module): GameHandle {
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
  store.begin();
  if (!(await isBuilt())) throw new GameNotBuilt();

  return new Promise<GameHandle>((resolve, reject) => {
    const fail = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      store.crashed(message);
      reject(error instanceof Error ? error : new Error(message));
    };

    const module = {
      arguments: gameArguments(options.args),
      print: (line: string) => store.line(line),
      printErr: (line: string) => store.line(line),
      onAbort: (what: unknown) => store.crashed(`The game aborted: ${String(what)}`),
      locateFile: (path: string) => `/game/${path}`,
      preRun: [] as (() => void)[],
    } as Partial<Ra2Module> as Ra2Module;

    module.onRuntimeInitialized = () => resolve(createHandle(module));

    if (options.files.kind === "dev-folder") {
      module.preRun.push(() => {
        module.addRunDependency("game-files");
        const fs = module.FS;
        if (!fs) return fail(new Error("the game's file system is not up yet"));
        loadDevFiles(fs, store).then(
          () => module.removeRunDependency("game-files"),
          (error: unknown) => fail(error),
        );
      });
    }

    // a trap in the game's thread reaches the page as an uncaught error from its worker
    window.addEventListener("error", (event) => {
      const phase = store.getSnapshot().phase;
      if (phase !== "exited" && phase !== "crashed")
        store.crashed(event.message || "the game stopped");
    });

    window.Module = module;
    const script = document.createElement("script");
    script.src = GAME_SCRIPT;
    script.onerror = () => fail(new GameNotBuilt());
    document.head.append(script);
  });
}
