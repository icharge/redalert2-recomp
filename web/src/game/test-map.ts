// FA2EX's Test Map: one skirmish on the map being edited, with no menus.
//
// FA2EX (same origin, so the same origin-private file system) writes the map and a small INI into
// OPFS under `fa2ex-test/`, then opens `<launcher>/game?testmap=1&edition=<ra2|ra2md>&return=<its own path>`. The launcher copies
// those files into /game before the game starts (the game lists maps once, at start-up) and passes
// `--test-map /game/fa2ex-test.ini`; the game skips the menus and the skirmish dialog
// (src/web/test_map.c, run_lift.py test_map_patches; docs/web/test-map.md). When the match ends the game
// sends `testMapDone` instead of showing the score screen, and the page goes back to FA2EX.

import { appPath } from "../paths";

/** FA2EX writes these (fa2web src/vfs/testMapHandoff.ts): change the two together. */
export const TEST_MAP_DIRECTORY = "fa2ex-test";
export const TEST_MAP_INI = "fa2ex-test.ini";

export interface TestMapRequest {
  /** where to go when the match ends: a same-origin path */
  returnTo: string;
}

/** `?testmap=1[&return=/fa2/]`; null when this is not a Test Map launch. Without a return path: the launcher. */
export function testMapRequest(search: string, home = appPath()): TestMapRequest | null {
  const query = new URLSearchParams(search);
  if (query.get("testmap") !== "1") return null;
  const back = query.get("return") ?? "";
  // only a path on this origin: never `//host` or a scheme
  const returnTo = /^\/(?!\/)[^\s\\]*$/.test(back) ? back : home;
  return { returnTo };
}

/** The game arguments a Test Map launch adds. */
export function testMapArguments(): string[] {
  return ["--test-map", `/game/${TEST_MAP_INI}`];
}

/** Where to go after the match: the editor, told whether the test ran. */
export function testMapReturnUrl(request: TestMapRequest, outcome: "done" | "failed"): string {
  const cut = request.returnTo.indexOf("#");
  const path = cut < 0 ? request.returnTo : request.returnTo.slice(0, cut);
  const hash = cut < 0 ? "" : request.returnTo.slice(cut + 1);
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}testmap=${outcome}${hash ? `#${hash}` : ""}`;
}

interface TestMapFs {
  writeFile(path: string, data: Uint8Array): void;
}

/** Copies FA2EX's staged files into /game. Throws when the INI is not there. */
export async function stageTestMap(
  fs: TestMapFs,
  root?: FileSystemDirectoryHandle,
): Promise<string[]> {
  const opfs = root ?? (await navigator.storage.getDirectory());
  let folder: FileSystemDirectoryHandle;
  try {
    folder = await opfs.getDirectoryHandle(TEST_MAP_DIRECTORY);
  } catch {
    throw new Error("FA2EX did not leave a map to test. Start Test Map from FA2EX again.");
  }
  const names: string[] = [];
  const listing = folder as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> };
  for await (const [name, entry] of listing.entries()) {
    if (entry.kind !== "file" || name.includes("/")) continue;
    const file = await (entry as FileSystemFileHandle).getFile();
    fs.writeFile(`/game/${name}`, new Uint8Array(await file.arrayBuffer()));
    names.push(name);
  }
  if (!names.some((name) => name.toLowerCase() === TEST_MAP_INI))
    throw new Error("FA2EX's test settings are missing. Start Test Map from FA2EX again.");
  return names;
}
