import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { blocker, prepareImport, runImport, type FolderSource, type SourceFile } from "./importer";
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
  file("movmd01.mix", 100),
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
const all = { movies: true, saves: true };

describe("prepareImport", () => {
  it("plans the copy, checks the exe against the lift and the room against the plan", async () => {
    const prepared = await prepareImport(source(folder()), build, all, roomy);
    expect(prepared.plan.games).toEqual(["ra2md"]);
    expect(prepared.exes.ra2md).toEqual({ ok: true, message: null });
    expect(prepared.space.fits).toBe(true);
    expect(blocker(prepared)).toBeNull();
  });

  it("is blocked by another build of the exe, by no room, and by a folder with no game", async () => {
    const wrongBuild = await prepareImport(source(folder(0x11111111)), build, all, roomy);
    expect(blocker(wrongBuild)).toMatch(/not the build the game was lifted from/);
    const tight = await prepareImport(source(folder()), build, all, { quota: 100, usage: 0 });
    expect(blocker(tight)).toMatch(/not enough room/);
    const none = await prepareImport(source([file("readme.txt", 1)]), build, all, roomy);
    expect(blocker(none)).toMatch(/no gamemd\.exe/);
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
      { movies: false, saves: true },
      roomy,
    );
    const seen: number[] = [];
    await run(prepared, manifest, target, {
      onProgress: (p: { doneBytes: number }) => seen.push(p.doneBytes),
    });
    expect([...target.files.keys()].sort()).toEqual(
      [
        "game/ra2md/Blowfish.dll",
        "game/ra2md/Saved Games/one.sav",
        "game/ra2md/binkw32.dll",
        "game/ra2md/gamemd.exe",
        "game/ra2md/movmd01.mix",
        "game/ra2md/ra2.mix",
        "game/ra2md/ra2md.mix",
      ].sort(),
    );
    const record = await manifest.getGame("ra2md");
    expect(record?.complete).toBe(true);
    expect(record?.exeStamp).toBe(STAMP);
    // the movie archive is a 12-byte empty one in its place
    expect(seen.at(-1)).toBe(20 + 10 + 10 + 40 + 30 + 3 + 12);
    expect(target.files.get("game/ra2md/movmd01.mix")).toBe(12);
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
    expect(prepared.exes).toEqual({
      ra2: { ok: true, message: null },
      ra2md: { ok: true, message: null },
    });
    await runImport({ prepared, build: bothBuild, manifest, target });

    const ra2 = await manifest.getGame("ra2");
    const yuri = await manifest.getGame("ra2md");
    expect(ra2?.complete).toBe(true);
    expect(yuri?.complete).toBe(true);
    expect(ra2?.files["ra2.mix"]?.home).toBe("ra2");
    expect(yuri?.files["ra2.mix"]?.home).toBe("ra2");
    expect([...target.files.keys()].filter((path) => path.endsWith("/ra2.mix"))).toEqual([
      "game/ra2/ra2.mix",
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
    await run(again, manifest, watching);
    expect(writes).toHaveLength(prepared.plan.copy.length - 3);
    expect((await manifest.getGame("ra2md"))?.complete).toBe(true);
  });
});
