import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  blocker,
  directorySource,
  entrySource,
  prepareImport,
  runImport,
  type FolderSource,
  type SourceFile,
} from "./importer";
import { listMods } from "./mods";
import type { BuildInfo } from "./install";
import { Manifest } from "./manifest";
import type { CopyTarget } from "./opfs";

const STAMP = 0x3bdf544e;
const RA2_STAMP = 0x3b1ebbed;
const build: BuildInfo = {
  games: { ra2md: { title: "Yuri's Revenge", exe: "gamemd.exe", ini: "RA2MD.INI", stamp: STAMP } },
};
const bothBuild: BuildInfo = {
  games: {
    ra2: { title: "Red Alert 2", exe: "game.exe", ini: "RA2.INI", stamp: RA2_STAMP },
    ra2md: { title: "Yuri's Revenge", exe: "gamemd.exe", ini: "RA2MD.INI", stamp: STAMP },
  },
};

/** The first 4 KB of a PE file with a timestamp in it. */
function peHead(stamp: number): Uint8Array {
  const head = new Uint8Array(4096);
  const view = new DataView(head.buffer);
  view.setUint32(0x3c, 0x80, true);
  view.setUint32(0x88, stamp, true);
  return head;
}

function file(
  path: string,
  size: number,
  head: Uint8Array = new Uint8Array(0),
  lastModified = 1,
): SourceFile {
  return {
    path,
    size,
    lastModified,
    head: async (n) => head.slice(0, n),
    stream: () =>
      new ReadableStream({
        start(controller) {
          for (let at = 0; at < size; at += 8)
            controller.enqueue(new Uint8Array(Math.min(8, size - at)));
          controller.close();
        },
      }),
  };
}

const source = (files: SourceFile[]): FolderSource => ({ name: "RA2", list: async () => files });

const folder = (stamp = STAMP) => [
  file("gamemd.exe", 20, peHead(stamp)),
  file("Blowfish.dll", 10),
  file("binkw32.dll", 10),
  file("ra2.mix", 40),
  file("ra2md.mix", 30),
  file("movmd03.mix", 100),
  file("Syringe.exe", 5),
  file("Saved Games/one.sav", 3),
];

function memoryTarget(): CopyTarget & { files: Map<string, number> } {
  const files = new Map<string, number>();
  return {
    files,
    async write(path, stream) {
      let n = 0;
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.length;
      }
      files.set(path, n);
    },
    async size(path) {
      return files.get(path) ?? null;
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

const roomy = { quota: 1e12, usage: 0 };
const all = { movies: true, saves: true, settings: true };

describe("prepareImport", () => {
  it("plans game data without requiring the bundled executable and DLL", async () => {
    const prepared = await prepareImport(source(folder()), build, all, roomy);
    expect(prepared.plan.games).toEqual(["ra2md"]);
    expect(prepared.space.fits).toBe(true);
    expect(blocker(prepared)).toBeNull();
  });

  it("is blocked by no room or by a folder with no game data", async () => {
    const wrongBuild = await prepareImport(source(folder(0x11111111)), build, all, roomy);
    expect(blocker(wrongBuild)).toBeNull();
    const tight = await prepareImport(source(folder()), build, all, { quota: 100, usage: 0 });
    expect(blocker(tight)).toMatch(/not enough room/);
    const none = await prepareImport(source([file("readme.txt", 1)]), build, all, roomy);
    expect(blocker(none)).toMatch(/no Red Alert 2 game data/i);
  });
});

describe("runImport", () => {
  const run = async (
    prepared: Awaited<ReturnType<typeof prepareImport>>,
    manifest: Manifest,
    target: CopyTarget,
    extra = {},
  ) => runImport({ prepared, build, manifest, target, ...extra });

  it("copies the plan into the game's folder and records the game as complete", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const target = memoryTarget();
    const prepared = await prepareImport(
      source(folder()),
      build,
      { movies: false, saves: true, settings: false },
      roomy,
    );
    const seen: number[] = [];
    await run(prepared, manifest, target, {
      onProgress: (p: { doneBytes: number }) => seen.push(p.doneBytes),
    });
    expect([...target.files.keys()].sort()).toEqual(
      [
        "game/slot-1/Saved Games/one.sav",
        "game/slot-1/movies01.mix",
        "game/slot-1/movmd03.mix",
        "game/slot-1/ra2.mix",
        "game/slot-1/ra2md.mix",
      ].sort(),
    );
    const record = await manifest.getGame("ra2md");
    expect(record?.complete).toBe(true);
    expect(record?.exeStamp).toBe(STAMP);
    // both edition startup movie anchors are 12-byte empty archives when omitted
    expect(seen.at(-1)).toBe(40 + 30 + 3 + 12 + 12);
    expect(target.files.get("game/slot-1/movmd03.mix")).toBe(12);
  });

  it("imports both games and keeps their shared files in OPFS only once", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const target = memoryTarget();
    const both = [
      file("game.exe", 21, peHead(RA2_STAMP)),
      file("gamemd.exe", 20, peHead(STAMP)),
      file("Blowfish.dll", 10),
      file("binkw32.dll", 10),
      file("ra2.mix", 40),
      file("ra2md.mix", 30),
      file("expandmd01.mix", 25),
      file("rules.ini", 5),
      file("rulesmd.ini", 6),
    ];
    const prepared = await prepareImport(source(both), bothBuild, all, roomy);
    expect(prepared.plan.games).toEqual(["ra2", "ra2md"]);
    await runImport({ prepared, build: bothBuild, manifest, target });

    const ra2 = await manifest.getGame("ra2");
    const yuri = await manifest.getGame("ra2md");
    expect(ra2?.complete).toBe(true);
    expect(yuri?.complete).toBe(true);
    expect(ra2?.files["ra2.mix"]?.home).toBe("slot-1");
    expect(yuri?.files["ra2.mix"]?.home).toBe("slot-1");
    expect([...target.files.keys()].filter((path) => path.endsWith("/ra2.mix"))).toEqual([
      "game/slot-1/ra2.mix",
    ]);
    expect(target.files.has("game/ra2md/ra2.mix")).toBe(false);
  });

  it("takes up where a cancelled import stopped, copying only what is left", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const target = memoryTarget();
    const prepared = await prepareImport(source(folder()), build, all, roomy);
    const controller = new AbortController();
    let marked = 0;
    const counting = {
      ...target,
      write: async (path: string, stream: ReadableStream<Uint8Array>, signal?: AbortSignal) => {
        await target.write(path, stream, signal);
        if (++marked === 3) controller.abort();
      },
    };
    await expect(run(prepared, manifest, counting, { signal: controller.signal })).rejects.toThrow(
      /cancelled/,
    );
    expect((await manifest.getGame("ra2md"))?.complete).toBe(false);
    const before = target.files.size;
    expect(before).toBe(3);

    const second = memoryTarget();
    second.files = target.files;
    const again = await prepareImport(source(folder()), build, all, roomy);
    const writes: string[] = [];
    const watching = {
      ...target,
      write: async (path: string, stream: ReadableStream<Uint8Array>) => {
        writes.push(path);
        await target.write(path, stream);
      },
    };
    await run(again, manifest, watching, { slot: 1 });
    expect(writes).toHaveLength(prepared.plan.copy.length - 3);
    expect((await manifest.getGame("ra2md"))?.complete).toBe(true);
  });

  it("copies again a file a stopped import recorded but the copy no longer has", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const target = memoryTarget();
    const prepared = await prepareImport(source(folder()), build, all, roomy);
    const controller = new AbortController();
    let writes = 0;
    const counting = {
      ...target,
      write: async (path: string, stream: ReadableStream<Uint8Array>, signal?: AbortSignal) => {
        await target.write(path, stream, signal);
        if (++writes === 2) controller.abort();
      },
    };
    await expect(run(prepared, manifest, counting, { signal: controller.signal })).rejects.toThrow(
      /cancelled/,
    );
    const record = await manifest.getGame("ra2md");
    const lost = Object.entries(record!.files).find(([, entry]) => entry.done);
    expect(lost).toBeDefined();
    const [name, entry] = lost!;
    // the browser dropped the copy; the record still says it is there
    target.files.delete(`game/${entry.home}/${name}`);

    const again = await prepareImport(source(folder()), build, all, roomy);
    await run(again, manifest, target, { slot: 1 });
    expect(target.files.has(`game/${entry.home}/${name}`)).toBe(true);
    expect((await manifest.getGame("ra2md"))?.complete).toBe(true);
  });

  it("lets a resume repair a complete-looking installation whose copy lost a file", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const target = memoryTarget();
    const prepared = await prepareImport(source(folder()), build, all, roomy);
    await run(prepared, manifest, target);
    expect((await manifest.getGame("ra2md"))?.complete).toBe(true);
    // the browser dropped one recorded archive; the record still says the import is complete
    target.files.delete("game/slot-1/ra2md.mix");

    const again = await prepareImport(source(folder()), build, all, roomy);
    await run(again, manifest, target, { slot: 1 });
    expect(target.files.has("game/slot-1/ra2md.mix")).toBe(true);
    expect((await manifest.getGame("ra2md"))?.complete).toBe(true);
  });

  it("refuses a second install: one game only, removed before another folder", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const target = memoryTarget();
    const prepared = await prepareImport(source(folder()), build, all, roomy);
    expect(await run(prepared, manifest, target)).toBe(1);
    await expect(run(prepared, manifest, target)).rejects.toThrow(/already installed/);
    expect(await manifest.listInstallations()).toHaveLength(1);
    expect([...target.files.keys()].some((path) => path.startsWith("game/slot-2/"))).toBe(false);
    await expect(run(prepared, manifest, target, { slot: 1 })).rejects.toThrow(/already installed/);
  });

  const withMods = () => [
    ...folder(),
    file("Mods/Lite/rulesmd.ini", 6),
    file("Mods/Lite/expandmd90.mix", 9),
    file("mods/Patched/Ares.dll", 4),
    file("mods/Patched/rulesmd.ini", 5),
  ];

  it("brings each mod in Mods after the game, for the MODS tab", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const target = memoryTarget();
    const prepared = await prepareImport(source(withMods()), build, all, roomy);
    await run(prepared, manifest, target);
    const [yuri] = await manifest.listGames();
    const mods = await listMods(manifest, yuri!.storage);
    expect(mods.map((mod) => mod.name)).toEqual(["Lite"]);
    expect(mods[0]?.files.map((f) => f.name).sort()).toEqual(["expandmd90.mix", "rulesmd.ini"]);
    expect(target.files.get(`game/${yuri!.storage}/mods/Lite/expandmd90.mix`)).toBe(9);
    // a mod is not game content
    expect([...target.files.keys()].some((path) => path.startsWith("game/slot-1/Mods"))).toBe(
      false,
    );
  });

  it("leaves the mods out when asked", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const prepared = await prepareImport(source(withMods()), build, { ...all, mods: false }, roomy);
    await run(prepared, manifest, memoryTarget());
    const [yuri] = await manifest.listGames();
    expect(await listMods(manifest, yuri!.storage)).toEqual([]);
  });

  it("resumes after a reload between finishing the first edition and starting the second", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const installation = await manifest.createInstallation("Both games", ["ra2", "ra2md"]);
    await manifest.beginImport("ra2", "Red Alert 2", RA2_STAMP, [], installation.slot);
    const prepared = await prepareImport(
      source([...folder(), file("game.exe", 21, peHead(RA2_STAMP))]),
      bothBuild,
      all,
      roomy,
    );
    await expect(
      runImport({
        prepared,
        build: bothBuild,
        manifest,
        target: memoryTarget(),
        slot: installation.slot,
      }),
    ).resolves.toBe(installation.slot);
    expect((await manifest.listGames(installation.slot)).every((game) => game.complete)).toBe(true);
  });
});

/** A picked folder as the browser hands it over, from paths. */
function handleTree(paths: string[]) {
  type Dir = { kind: "directory"; name: string; children: Map<string, Dir | Leaf> };
  type Leaf = { kind: "file"; name: string; getFile(): Promise<File> };
  const root: Dir = { kind: "directory", name: "RA2", children: new Map() };
  for (const path of paths) {
    const parts = path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.children.get(part) as Dir | undefined;
      if (!next) {
        next = { kind: "directory", name: part, children: new Map() };
        dir.children.set(part, next);
      }
      dir = next;
    }
    const name = parts.at(-1)!;
    dir.children.set(name, { kind: "file", name, getFile: async () => new File(["x"], name) });
  }
  const handle = (dir: Dir): unknown => ({
    kind: "directory",
    name: dir.name,
    async *entries() {
      for (const [name, child] of dir.children)
        yield [name, child.kind === "file" ? child : handle(child)];
    },
  });
  const entry = (node: Dir | Leaf): unknown =>
    node.kind === "file"
      ? {
          isFile: true,
          isDirectory: false,
          name: node.name,
          file: (ok: (f: File) => void) => void node.getFile().then(ok),
        }
      : {
          isFile: false,
          isDirectory: true,
          name: node.name,
          createReader() {
            let done = false;
            return {
              readEntries(ok: (entries: unknown[]) => void) {
                ok(done ? [] : [...node.children.values()].map(entry));
                done = true;
              },
            };
          },
        };
  return {
    handle: handle(root) as FileSystemDirectoryHandle,
    entry: entry(root) as Parameters<typeof entrySource>[0],
  };
}

describe("folder sources", () => {
  const tree = [
    "ra2md.mix",
    "Saved Games/one.sav",
    "Mods/Lite/rulesmd.ini",
    "Mods/Lite/art/deep.shp",
    "Maps/Custom/x.map",
    "Tools/x.exe",
  ];
  const expected = ["Mods/Lite/rulesmd.ini", "Saved Games/one.sav", "ra2md.mix"];

  it("a picked folder: the top, Saved Games, and each mod in Mods", async () => {
    const files = await directorySource(handleTree(tree).handle).list();
    expect(files.map((f) => f.path).sort()).toEqual(expected);
  });

  it("a dropped folder reads the same", async () => {
    const files = await entrySource(handleTree(tree).entry).list();
    expect(files.map((f) => f.path).sort()).toEqual(expected);
  });
});
