// What the import copies, and the checks made before it does (docs/web/storage.md).

export type GameId = "ra2md" | "ra2";
export const GAME_TITLE: Record<GameId, string> = {
  ra2: "Red Alert 2",
  ra2md: "Yuri's Revenge",
};

/** The expected exes, from the build (web/public/game/build.json, written by CMake). */
export interface BuildInfo {
  games: Partial<
    Record<
      GameId,
      {
        title: string;
        exe: string;
        ini: string;
        script?: string;
        build?: string;
        /** the PE timestamp lifted */
        stamp: number;
        /** Locally generated inputs the browser stages at /game before starting the host. */
        runtime?: {
          edition: GameId;
          build: string;
          exeSha256: string;
          blowfishSha256: string;
        };
      }
    >
  >;
}

export type FileKind = "archive" | "movie" | "sound" | "data" | "save";

export interface InstallFile {
  /** relative to the install folder, `/` or `\` between parts */
  path: string;
  size: number;
}

export interface Classified {
  kind: FileKind;
  /** the games that read it */
  needs: GameId[];
}

const BOTH: GameId[] = ["ra2", "ra2md"];

/** Built locally and staged by the launcher; these are not imported from the player's content folder. */
const RUNTIME_INPUTS = new Set(["game.exe", "gamemd.exe", "blowfish.dll", "binkw32.dll"]);

/** Runtime files are supplied by the matching web build, never by an import or save store. */
export const isRuntimeInput = (path: string): boolean =>
  !path.includes("/") && RUNTIME_INPUTS.has(path.toLowerCase());

/** Where an older layout's `Saved Games/...` starts, as a path with `/`. */
const SAVES = "saved games/";

function normalise(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

/**
 * What a file of the install folder is to the import, or null for what is not copied. Files at the
 * folder's top level only, matched without regard to case, except `Saved Games/`. Runtime binaries
 * are supplied by the local build. A name with
 * `md` in it is Yuri's Revenge's own (`expandmd01.mix`, `rulesmd.ini`, `audiomd.bag`); the rest are
 * the base game's, which the expansion reads too.
 */
export function classify(path: string): Classified | null {
  const name = normalise(path);
  if (name.startsWith(SAVES) && name.length > SAVES.length) return { kind: "save", needs: BOTH };
  if (name.includes("/")) return null;
  // the game writes `SAVE0001.sav` beside its exe (SAVE%04lX.%3s), not in a folder
  if (name.endsWith(".sav")) return { kind: "save", needs: BOTH };
  if (isRuntimeInput(name)) return null;
  const md: GameId[] = name.includes("md") ? ["ra2md"] : BOTH;
  if (/^(movies|movmd)[^/]*\.mix$/.test(name)) return { kind: "movie", needs: md };
  if (name.endsWith(".mix")) return { kind: "archive", needs: md };
  if (/^audio(md)?\.(bag|idx)$/.test(name)) return { kind: "sound", needs: md };
  if (/\.(ini|csf|fnt|mmx|map|mpr|yrm)$/.test(name)) return { kind: "data", needs: md };
  return null;
}

export interface ImportOptions {
  /** copy the movies (optional: the game runs without them) */
  movies: boolean;
  /** bring `Saved Games/` along */
  saves: boolean;
}

/**
 * What is written in place of a movie archive the player did not bring: an empty archive. The game
 * stops at start ("Failed to initialize") if MOVMD03.MIX is missing, though it takes an empty one.
 */
export const EMPTY_ARCHIVE = new Uint8Array(12);

export interface ImportPlan {
  /** the editions identified by game data and supported by this build */
  games: GameId[];
  /** `stub`: not the folder's file but an empty archive of 12 bytes in its place (`size` is that) */
  copy: (InstallFile & Classified & { stub?: boolean })[];
  /** what was left out, and why */
  skipped: { path: string; reason: string }[];
  /** bytes of everything to copy */
  bytes: number;
  /** bytes of the movies in the folder, copied or not */
  movieBytes: number;
  /** something worth saying that does not stop the import */
  warnings: string[];
  /** why nothing can be imported, if so */
  error: string | null;
  /** per-edition result based on the user's content and this page's runtime bundles */
  readiness: Partial<Record<GameId, EditionReadiness>>;
}

export interface EditionReadiness {
  status: "ready" | "missing-content" | "runtime-not-built";
  missing: string[];
  moviesMissing: boolean;
}

/** Hard-failure content traced in the lifted startup paths; movies are handled separately. */
export const REQUIRED_CONTENT: Record<GameId, readonly string[]> = {
  ra2: ["ra2.mix", "maps01.mix", "multi.mix"],
  ra2md: ["ra2.mix", "ra2md.mix", "maps01.mix", "multi.mix"],
};

/** Startup probes these movie archives even when the player opts out of the actual videos. */
export const REQUIRED_MOVIE_ARCHIVES: Record<GameId, readonly string[]> = {
  ra2: ["movies01.mix"],
  ra2md: ["movies01.mix", "movmd03.mix"],
};

/** Movie packs have an empty-archive fallback and do not determine core readiness. */
const MOVIE_ARCHIVE = /^(?:movies|movmd)[^/]*\.mix$/i;

export function assessEditionReadiness(
  id: GameId,
  build: BuildInfo,
  names: Iterable<string>,
): EditionReadiness {
  const game = build.games[id];
  if (
    !game?.runtime ||
    game.runtime.edition !== id ||
    !game.build ||
    game.runtime.build !== game.build
  )
    return { status: "runtime-not-built", missing: [], moviesMissing: false };
  const present = new Set([...names].map((name) => normalise(name)));
  const missing = REQUIRED_CONTENT[id].filter((name) => !present.has(name));
  const moviesMissing = REQUIRED_MOVIE_ARCHIVES[id].some((name) => !present.has(name));
  return { status: missing.length ? "missing-content" : "ready", missing, moviesMissing };
}

export function planImport(
  files: InstallFile[],
  build: BuildInfo,
  options: ImportOptions,
): ImportPlan {
  const hasBaseData = files.some((file) => {
    const classified = classify(file.path);
    return (
      !!classified &&
      classified.kind !== "save" &&
      classified.kind !== "movie" &&
      classified.needs.includes("ra2")
    );
  });
  const hasYuriData = files.some((file) => {
    const classified = classify(file.path);
    return (
      !!classified &&
      classified.kind !== "save" &&
      classified.kind !== "movie" &&
      classified.needs.length === 1 &&
      classified.needs[0] === "ra2md"
    );
  });
  const detected = new Set<GameId>();
  if (hasBaseData) detected.add("ra2");
  if (hasYuriData) detected.add("ra2md");
  const detectedGames = [...detected];
  const games = (Object.keys(build.games) as GameId[]).filter((id) => detected.has(id));
  const plan: ImportPlan = {
    games,
    copy: [],
    skipped: [],
    bytes: 0,
    movieBytes: 0,
    warnings: [],
    error: null,
    readiness: {},
  };
  if (detectedGames.length === 0) {
    plan.error = "No Red Alert 2 game data was found at the top of this folder.";
    return plan;
  }
  for (const id of detectedGames) {
    plan.readiness[id] = assessEditionReadiness(
      id,
      build,
      files
        .filter((file) => options.movies || !MOVIE_ARCHIVE.test(normalise(file.path)))
        .map((file) => file.path),
    );
  }
  if (games.length === 0) {
    plan.error = `This build does not include the ${detectedGames.map((id) => GAME_TITLE[id]).join(" or ")} runtime.`;
    return plan;
  }
  for (const file of files) {
    const what = classify(file.path);
    if (!what) {
      plan.skipped.push({ path: file.path, reason: "not read by the game" });
      continue;
    }
    if (what.kind === "movie") plan.movieBytes += file.size;
    if (!what.needs.some((id) => games.includes(id))) {
      plan.skipped.push({ path: file.path, reason: "for a game this folder does not have" });
    } else if (what.kind === "movie" && !options.movies) {
      plan.copy.push({ ...file, ...what, size: EMPTY_ARCHIVE.length, stub: true });
      plan.bytes += EMPTY_ARCHIVE.length;
    } else if (what.kind === "save" && !options.saves) {
      plan.skipped.push({ path: file.path, reason: "saves not brought" });
    } else {
      plan.copy.push({ ...file, ...what });
      plan.bytes += file.size;
    }
  }
  const sourceNames = new Set(files.map((file) => normalise(file.path)));
  for (const id of games) {
    for (const path of REQUIRED_MOVIE_ARCHIVES[id]) {
      if (sourceNames.has(path)) continue;
      const needs: GameId[] = path.startsWith("movmd") ? ["ra2md"] : ["ra2", "ra2md"];
      if (!needs.some((edition) => games.includes(edition))) continue;
      plan.copy.push({ path, size: EMPTY_ARCHIVE.length, kind: "movie", needs, stub: true });
      plan.bytes += EMPTY_ARCHIVE.length;
    }
  }
  return plan;
}

/** The PE timestamp at `e_lfanew + 8` of an exe's first 4 KB, or 0 if it is not one (src/web/main.c: exe_stamp). */
export function readExeStamp(head: Uint8Array): number {
  if (head.length < 0x40) return 0;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const nt = view.getUint32(0x3c, true);
  return nt !== 0 && nt + 12 <= head.length ? view.getUint32(nt + 8, true) : 0;
}

export interface Check {
  ok: boolean;
  message: string | null;
}

/** Whether this exe is the build the game was lifted from. */
export function checkExe(head: Uint8Array, expected: number, exeName: string): Check {
  const stamp = readExeStamp(head);
  if (stamp === expected) return { ok: true, message: null };
  const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, "0")}`;
  return {
    ok: false,
    message:
      stamp === 0
        ? `${exeName} is not a Windows program the game can run.`
        : `This ${exeName} is not the build the game was lifted from (it is stamped ${hex(stamp)}, the lift is ${hex(expected)}). Use the Steam or EA App release.`,
  };
}

export interface SpaceCheck {
  fits: boolean;
  /** bytes still needed, 0 if it fits */
  short: number;
  /** a way out, if it does not fit */
  advice: string | null;
}

/** `navigator.storage.estimate()`'s answer against what the copy needs (with a margin for the manifest and saves). */
export function checkSpace(
  estimate: { quota?: number; usage?: number },
  need: number,
  movieBytes: number,
  margin = 64 * 1024 * 1024,
): SpaceCheck {
  const free = Math.max(0, (estimate.quota ?? 0) - (estimate.usage ?? 0));
  const short = Math.max(0, need + margin - free);
  if (short === 0) return { fits: true, short: 0, advice: null };
  return {
    fits: false,
    short,
    advice:
      movieBytes > 0 && short <= movieBytes
        ? "Skipping the movies would make it fit."
        : "Free some space in the browser's storage, or import on another browser profile.",
  };
}

/** The build's list of games: web/public/game/build.json. */
export async function loadBuildInfo(fetcher: typeof fetch = fetch): Promise<BuildInfo> {
  const response = await fetcher(`${import.meta.env.BASE_URL}game/build.json`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("The game is not built (no build.json).");
  const value = (await response.json()) as BuildInfo;
  if (typeof value !== "object" || value === null || typeof value.games !== "object")
    throw new Error("build.json is not what the page expects.");
  return value;
}
