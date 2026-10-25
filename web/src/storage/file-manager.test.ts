import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { managedInstallationSource, SAVES_DIR } from "./file-manager";
import type { BuildInfo, GameId } from "./install";
import { Manifest, type PlannedFile } from "./manifest";
import type { CopyTarget } from "./opfs";
import type { SaveStore } from "./saves";

const YR_STAMP = 0x3bdf544e;
const RA2_STAMP = 0x3b1b1aed;

const build: BuildInfo = {
  games: {
    ra2: { title: "Red Alert 2", exe: "game.exe", ini: "RA2.INI", stamp: RA2_STAMP },
    ra2md: { title: "Yuri's Revenge", exe: "gamemd.exe", ini: "RA2MD.INI", stamp: YR_STAMP },
  },
};

/** The parts of a File the manager uses; jsdom's File has no stream(). */
function upload(name: string, content: string | Uint8Array, lastModified = 9000): File {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return {
    name,
    size: bytes.length,
    lastModified,
    slice: (start: number, end: number) => ({
      arrayBuffer: async () => bytes.slice(start, end).buffer,
    }),
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  } as unknown as File;
}

function memoryTarget() {
  const files = new Map<string, Uint8Array>();
  const target: CopyTarget = {
    async write(path, stream) {
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      files.set(path, Uint8Array.from(chunks.flatMap((chunk) => [...chunk])));
    },
    async size(path) {
      return files.get(path)?.length ?? null;
    },
    async remove(path) {
      files.delete(path);
    },
  };
  const saves: SaveStore = {
    async list(game) {
      const prefix = `save/${game}/`;
      return [...files]
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, bytes]) => ({
          path: path.slice(prefix.length),
          size: bytes.length,
          modified: 1,
          read: async () => bytes,
        }));
    },
  };
  return { files, target, saves };
}

const plan = (...names: string[]): PlannedFile[] =>
  names.map((name) => ({
    name,
    size: 10,
    lastModified: 100,
    needs: /md/i.test(name) ? ["ra2md"] : ["ra2", "ra2md"],
  }));

const YR_FILES = ["ra2.mix", "maps01.mix", "multi.mix", "ra2md.mix", "RA2MD.INI", "rulesmd.ini"];
const RA2_FILES = ["ra2.mix", "maps01.mix", "multi.mix"];

/** An installation (slot 1) of the editions asked for, its files in OPFS as an import leaves them. */
async function setup(editions: GameId[] = ["ra2md"]) {
  const manifest = await Manifest.open(new IDBFactory());
  const memory = memoryTarget();
  for (const id of editions) {
    const names = id === "ra2md" ? YR_FILES : RA2_FILES;
    await manifest.beginImport(
      id,
      build.games[id]!.title,
      build.games[id]!.stamp,
      plan(...names),
      editions.indexOf(id) === 0 ? undefined : 1,
    );
    for (const name of names) {
      await manifest.markFileDone(id, name);
      memory.files.set(`game/slot-1/${name}`, new Uint8Array(10));
    }
  }
  let changes = 0;
  const source = managedInstallationSource("Test install", 1, await manifest.listGames(1), {
    manifest,
    target: memory.target,
    saves: memory.saves,
    build,
    onChange: () => changes++,
  });
  return { manifest, memory, source, changes: () => changes };
}

const manage = (source: Awaited<ReturnType<typeof setup>>["source"]) => source.manage!;
const names = (entries: { name: string }[]) => entries.map((entry) => entry.name).sort();

describe("managed installation files: listing", () => {
  it("shows the imported files and a Saves folder that cannot be deleted", async () => {
    const { source } = await setup();
    const root = await source.list("");
    expect(root.find((entry) => entry.name === SAVES_DIR)).toEqual({
      name: SAVES_DIR,
      type: "folder",
      locked: true,
    });
    expect(names(root.filter((entry) => entry.type === "file"))).toEqual([
      "RA2MD.INI",
      "maps01.mix",
      "multi.mix",
      "ra2.mix",
      "ra2md.mix",
      "rulesmd.ini",
    ]);
  });

  it("lists the files of both editions together, a shared one once", async () => {
    const { source } = await setup(["ra2md", "ra2"]);
    expect(names((await source.list("")).filter((entry) => entry.type === "file"))).toEqual([
      "RA2MD.INI",
      "maps01.mix",
      "multi.mix",
      "ra2.mix",
      "ra2md.mix",
      "rulesmd.ini",
    ]);
  });

  it("lists what the game saved, apart from mods and the host's files", async () => {
    const { source, memory } = await setup();
    memory.files.set("save/slot-1-ra2md/SAVE0001.sav", new Uint8Array(3));
    memory.files.set("save/slot-1-ra2md/RA2MD.INI", new Uint8Array(4));
    memory.files.set("save/slot-1-ra2md/mods/Alpha/x.sav", new Uint8Array(1));
    memory.files.set("save/slot-1-ra2md/.host/ra2md.ini", new Uint8Array(1));
    expect(names(await source.list(SAVES_DIR))).toEqual(["RA2MD.INI", "SAVE0001.sav"]);
  });

  it("keeps each game's saves in a folder of its own when there are two", async () => {
    const { source, memory } = await setup(["ra2md", "ra2"]);
    memory.files.set("save/slot-1-ra2md/SAVE0001.sav", new Uint8Array(3));
    memory.files.set("save/slot-1-ra2/SAVE0002.sav", new Uint8Array(3));
    expect(await source.list(SAVES_DIR)).toEqual([
      { name: "Red Alert 2", type: "folder", locked: true },
      { name: "Yuri's Revenge", type: "folder", locked: true },
    ]);
    expect(names(await source.list(`${SAVES_DIR}/Yuri's Revenge`))).toEqual(["SAVE0001.sav"]);
    expect(names(await source.list(`${SAVES_DIR}/Red Alert 2`))).toEqual(["SAVE0002.sav"]);
  });

  it("says which names an upload would replace, without regard to case", async () => {
    const { source, memory } = await setup();
    memory.files.set("save/slot-1-ra2md/SAVE0001.sav", new Uint8Array(3));
    expect(await manage(source).clashes("", ["RULESMD.INI", "new.ini"])).toEqual(["RULESMD.INI"]);
    expect(await manage(source).clashes(SAVES_DIR, ["save0001.SAV", "other.sav"])).toEqual([
      "save0001.SAV",
    ]);
  });
});

describe("managed installation files: upload", () => {
  it("replaces an imported file in place and updates the record", async () => {
    const { source, memory, manifest, changes } = await setup();
    const report = await manage(source).upload("", [
      upload("rulesmd.ini", "twenty bytes of rule", 777),
    ]);
    expect(report.problems).toEqual([]);
    expect(report.replaced).toEqual(["rulesmd.ini"]);
    expect(memory.files.get("game/slot-1/rulesmd.ini")?.length).toBe(20);
    const record = (await manifest.getGame("ra2md", 1))!;
    expect(record.files["rulesmd.ini"]).toMatchObject({
      size: 20,
      lastModified: 777,
      done: true,
      home: "slot-1",
    });
    expect(record.bytes).toBe(5 * 10 + 20);
    expect(changes()).toBeGreaterThan(0);
    expect((await source.list("")).find((e) => e.name === "rulesmd.ini")?.size).toBe(20);
  });

  it("keeps the name's capitals when the new file is spelled differently", async () => {
    const { source, memory, manifest } = await setup();
    await manage(source).upload("", [upload("ra2md.ini", "x")]);
    expect(memory.files.has("game/slot-1/RA2MD.INI")).toBe(true);
    expect(Object.keys((await manifest.getGame("ra2md", 1))!.files)).not.toContain("ra2md.ini");
  });

  it("clears the game's saved copy, which would hide the new file", async () => {
    const { source, memory } = await setup();
    memory.files.set("save/slot-1-ra2md/RA2MD.INI", new Uint8Array(2));
    const report = await manage(source).upload("", [upload("RA2MD.INI", "[Video]")]);
    expect(memory.files.has("save/slot-1-ra2md/RA2MD.INI")).toBe(false);
    expect(report.notes.join(" ")).toMatch(/RA2MD\.INI/);
  });

  it("adds a new file to every edition that reads it, stored once", async () => {
    const { source, manifest, memory } = await setup(["ra2md", "ra2"]);
    const report = await manage(source).upload("", [upload("extra.mix", "mix")]);
    expect(report.added).toEqual(["extra.mix"]);
    expect([...memory.files.keys()].filter((path) => path.endsWith("extra.mix"))).toEqual([
      "game/slot-1/extra.mix",
    ]);
    for (const id of ["ra2md", "ra2"] as const)
      expect((await manifest.getGame(id, 1))!.files["extra.mix"]).toMatchObject({
        size: 3,
        done: true,
        home: "slot-1",
      });
  });

  it("adds a game's own file to that game only", async () => {
    const { source, manifest } = await setup(["ra2md", "ra2"]);
    await manage(source).upload("", [upload("expandmd99.mix", "mix")]);
    expect((await manifest.getGame("ra2md", 1))!.files["expandmd99.mix"]).toBeDefined();
    expect((await manifest.getGame("ra2", 1))!.files["expandmd99.mix"]).toBeUndefined();
  });

  it("updates both editions' records when they share the replaced file", async () => {
    const { source, manifest } = await setup(["ra2md", "ra2"]);
    await manage(source).upload("", [upload("ra2.mix", "much longer content")]);
    for (const id of ["ra2md", "ra2"] as const)
      expect((await manifest.getGame(id, 1))!.files["ra2.mix"]?.size).toBe(19);
  });

  it("does not accept bundled runtime executables as imported game content", async () => {
    const { source } = await setup();
    const good = await manage(source).upload("", [upload("gamemd.exe", "runtime")]);
    expect(good.problems.join(" ")).toMatch(/does not read/);
    expect(good.added).toEqual([]);
  });

  it("adds Yuri's Revenge from edition-specific game data and reports its additions", async () => {
    const { source, manifest } = await setup(["ra2"]);
    const report = await manage(source).upload("", [upload("expandmd99.mix", "x")]);
    expect(report.added).toEqual(["expandmd99.mix"]);
    expect(report.notes.join(" ")).toMatch(/Added Yuri's Revenge/);
    expect((await manifest.getGame("ra2md", 1))!.files["ra2.mix"]).toBeDefined();
  });

  it("refuses what the game does not read, and saves outside Saves", async () => {
    const { source, memory } = await setup();
    const report = await manage(source).upload("", [
      upload("notes.docx", "x"),
      upload("SAVE0001.sav", "s"),
      upload("Ares.dll", "x"),
    ]);
    expect(report.added).toEqual([]);
    expect(report.problems).toHaveLength(3);
    expect(report.problems.join("\n")).toMatch(new RegExp(`${SAVES_DIR} folder`));
    expect([...memory.files.keys()].some((path) => /notes|SAVE0001|Ares/.test(path))).toBe(false);
  });
});

describe("managed installation files: Saves", () => {
  it("takes .sav files, where the game looks for them, and only those", async () => {
    const { source, memory } = await setup();
    const first = await manage(source).upload(SAVES_DIR, [
      upload("SAVE0001.sav", "one"),
      upload("settings.ini", "x"),
    ]);
    expect(first.added).toEqual(["SAVE0001.sav"]);
    expect(first.problems.join(" ")).toMatch(/only \.sav/);
    expect(memory.files.has("save/slot-1-ra2md/SAVE0001.sav")).toBe(true);
    const again = await manage(source).upload(SAVES_DIR, [upload("save0001.SAV", "two")]);
    expect(again.replaced).toEqual(["SAVE0001.sav"]);
    expect(memory.files.has("save/slot-1-ra2md/save0001.SAV")).toBe(false);
  });

  it("puts a save in the folder of the game it is dropped on, and refuses the folder above", async () => {
    const { source, memory } = await setup(["ra2md", "ra2"]);
    const ok = await manage(source).upload(`${SAVES_DIR}/Red Alert 2`, [
      upload("SAVE0001.sav", "x"),
    ]);
    expect(ok.added).toEqual(["SAVE0001.sav"]);
    expect(memory.files.has("save/slot-1-ra2/SAVE0001.sav")).toBe(true);
    const above = await manage(source).upload(SAVES_DIR, [upload("SAVE0002.sav", "x")]);
    expect(above.added).toEqual([]);
    expect(above.problems.join(" ")).toMatch(/open a game's folder/);
  });
});

describe("managed installation files: delete", () => {
  it("removes a file from the record and from OPFS", async () => {
    const { source, memory, manifest } = await setup();
    await manage(source).remove(["rulesmd.ini"]);
    expect(memory.files.has("game/slot-1/rulesmd.ini")).toBe(false);
    const record = (await manifest.getGame("ra2md", 1))!;
    expect(record.files["rulesmd.ini"]).toBeUndefined();
    expect(record.bytes).toBe(5 * 10);
    expect((await source.list("")).some((entry) => entry.name === "rulesmd.ini")).toBe(false);
  });

  it("removes a shared file from both editions, and from OPFS once nothing reads it", async () => {
    const { source, memory, manifest } = await setup(["ra2md", "ra2"]);
    await manage(source).remove(["ra2.mix"]);
    expect(memory.files.has("game/slot-1/ra2.mix")).toBe(false);
    for (const id of ["ra2md", "ra2"] as const)
      expect((await manifest.getGame(id, 1))!.files["ra2.mix"]).toBeUndefined();
  });

  it("clears the game's saved copy too, so the file does not come back", async () => {
    const { source, memory } = await setup();
    memory.files.set("save/slot-1-ra2md/RA2MD.INI", new Uint8Array(2));
    const notes = await manage(source).remove(["RA2MD.INI"]);
    expect(memory.files.has("save/slot-1-ra2md/RA2MD.INI")).toBe(false);
    expect(notes.join(" ")).toMatch(/RA2MD\.INI/);
  });

  it("deletes what a game saved, and leaves imported files and the folders alone", async () => {
    const { source, memory } = await setup(["ra2md", "ra2"]);
    memory.files.set("save/slot-1-ra2md/SAVE0001.sav", new Uint8Array(3));
    await manage(source).remove([`${SAVES_DIR}/Yuri's Revenge`, SAVES_DIR]);
    expect(memory.files.has("save/slot-1-ra2md/SAVE0001.sav")).toBe(true);
    await manage(source).remove([`${SAVES_DIR}/Yuri's Revenge/SAVE0001.sav`]);
    expect(memory.files.has("save/slot-1-ra2md/SAVE0001.sav")).toBe(false);
    expect(memory.files.has("game/slot-1/rulesmd.ini")).toBe(true);
  });

  it("warns that deleted game content may affect startup", async () => {
    const { source } = await setup();
    expect(manage(source).removeWarning(["multi.mix"])).toMatch(/may not start/);
    expect(manage(source).removeWarning(["rulesmd.ini"])).toMatch(/may not start/);
    expect(manage(source).removeWarning([`${SAVES_DIR}/SAVE0001.sav`])).toMatch(
      /cannot be brought back/,
    );
  });
});
