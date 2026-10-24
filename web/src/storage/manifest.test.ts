import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { Manifest, type PlannedFile } from "./manifest";

const open = () => Manifest.open(new IDBFactory());

const plan = (...names: string[]): PlannedFile[] =>
  names.map((name, i) => ({
    name,
    size: 1000 + i,
    lastModified: 5000 + i,
    needs: name.includes("md") ? ["ra2md"] : ["ra2", "ra2md"],
  }));

describe("Manifest: an import", () => {
  it("starts with everything to copy, and is complete when the last file is done", async () => {
    const m = await open();
    const { record, resume } = await m.beginImport(
      "ra2md",
      "Yuri's Revenge",
      0x3bdf544e,
      plan("a.mix", "b.mix"),
    );
    expect(resume.done).toEqual([]);
    expect(resume.todo.map((f) => f.name)).toEqual(["a.mix", "b.mix"]);
    expect(record.complete).toBe(false);
    expect(record.bytes).toBe(1000 + 1001);

    await m.markFileDone("ra2md", "a.mix");
    expect((await m.getGame("ra2md"))?.complete).toBe(false);
    await m.markFileDone("ra2md", "b.mix");
    expect((await m.getGame("ra2md"))?.complete).toBe(true);
    expect((await m.listGames()).map((g) => g.id)).toEqual(["ra2md"]);
  });

  it("resumes: done files stay done, a changed or half-copied one is copied again", async () => {
    const m = await open();
    await m.beginImport("ra2md", "Yuri's Revenge", 1, plan("a.mix", "b.mix", "c.mix"));
    await m.markFileDone("ra2md", "a.mix");
    await m.markFileDone("ra2md", "b.mix");
    // the reload: b.mix has changed on disk since, c.mix was never finished
    const planned = plan("a.mix", "b.mix", "c.mix");
    planned[1] = { ...planned[1]!, size: 999_999 };
    const { resume, record } = await m.beginImport("ra2md", "Yuri's Revenge", 1, planned);
    expect(resume.done).toEqual(["a.mix"]);
    expect(resume.todo.map((f) => f.name)).toEqual(["b.mix", "c.mix"]);
    expect(record.files["a.mix"]?.done).toBe(true);
    expect(record.files["b.mix"]?.done).toBe(false);
    expect(record.complete).toBe(false);
  });

  it("keeps the first import time when resuming, and refuses a file it does not know", async () => {
    const m = await open();
    const first = (await m.beginImport("ra2md", "Yuri's Revenge", 1, plan("a.mix"))).record;
    const again = (await m.beginImport("ra2md", "Yuri's Revenge", 1, plan("a.mix"))).record;
    expect(again.importedAt).toBe(first.importedAt);
    await expect(m.markFileDone("ra2md", "nope.mix")).rejects.toThrow(/not part of/);
  });
});

describe("Manifest: two games sharing files", () => {
  async function both() {
    const m = await open();
    await m.beginImport("ra2md", "Yuri's Revenge", 1, plan("ra2.mix", "ra2md.mix"));
    await m.markFileDone("ra2md", "ra2.mix");
    await m.markFileDone("ra2md", "ra2md.mix");
    return m;
  }

  it("lists a file already in OPFS as done for the second game, kept where it is", async () => {
    const m = await both();
    const { record, resume } = await m.beginImport(
      "ra2",
      "Red Alert 2",
      2,
      plan("ra2.mix", "game-only.mix"),
    );
    expect(resume.done).toEqual(["ra2.mix"]);
    expect(resume.todo.map((f) => f.name)).toEqual(["game-only.mix"]);
    expect(record.files["ra2.mix"]?.home).toBe("slot-1");
    expect(record.files["game-only.mix"]?.home).toBe("slot-1");
  });

  it("removing one game deletes only what no other game reads", async () => {
    const m = await both();
    await m.beginImport("ra2", "Red Alert 2", 2, plan("ra2.mix", "game-only.mix"));
    await m.markFileDone("ra2", "game-only.mix");
    expect(await m.removeGame("ra2")).toEqual([{ home: "slot-1", name: "game-only.mix" }]);
    expect((await m.listGames()).map((g) => g.id)).toEqual(["ra2md"]);
    expect((await m.removeGame("ra2md")).map((f) => f.name).sort()).toEqual([
      "ra2.mix",
      "ra2md.mix",
    ]);
    expect(await m.listGames()).toEqual([]);
    expect(await m.removeGame("ra2md")).toEqual([]);
  });
});

describe("Manifest: settings", () => {
  it("keeps a value by name, and nothing for a name never set", async () => {
    const m = await open();
    expect(await m.getSetting("volume")).toBeUndefined();
    await m.setSetting("volume", 0.4);
    await m.setSetting("scale", { mode: "sharp" });
    expect(await m.getSetting("volume")).toBe(0.4);
    expect(await m.getSetting("scale")).toEqual({ mode: "sharp" });
  });
});

describe("installation slots", () => {
  it("does not reuse retained legacy mod and save namespaces when there are no old games", async () => {
    const factory = new IDBFactory();
    const legacy = await new Promise<IDBDatabase>((resolve) => {
      const opening = factory.open("ra2-web", 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore("games", { keyPath: "id" });
        opening.result.createObjectStore("settings");
      };
      opening.onsuccess = () => resolve(opening.result);
    });
    await new Promise<void>((resolve) => {
      const tx = legacy.transaction("settings", "readwrite");
      tx.objectStore("settings").put([{ name: "Old mod", files: [], bytes: 0 }], "mods:ra2md");
      tx.oncomplete = () => resolve();
    });
    legacy.close();
    const m = await Manifest.open(factory);
    const installation = await m.createInstallation("New copy");
    const { record } = await m.beginImport("ra2md", "Yuri's Revenge", 1, [], installation.slot);
    expect(record.storage).toBe("slot-1-ra2md");
    expect(await m.getSetting(`mods:${record.storage}`)).toBeUndefined();
  });
  it("keeps separate copies of the same edition and never reuses a deleted slot", async () => {
    const m = await open();
    const first = await m.createInstallation("Original");
    const second = await m.createInstallation("Modded");
    await m.beginImport("ra2md", "Yuri's Revenge", 1, plan("ra2.mix"), first.slot);
    await m.markFileDone("ra2md", "ra2.mix", first.slot);
    const next = await m.beginImport("ra2md", "Yuri's Revenge", 1, plan("ra2.mix"), second.slot);
    expect(next.resume.done).toEqual([]);
    expect(next.record.storage).not.toBe((await m.getGame("ra2md", first.slot))?.storage);
    expect(next.record.files["ra2.mix"]?.home).not.toBe(
      (await m.getGame("ra2md", first.slot))?.files["ra2.mix"]?.home,
    );
    expect(await m.listGames()).toHaveLength(2);
    expect((await m.listGames(first.slot)).map((game) => game.id)).toEqual(["ra2md"]);
    expect(await m.getInstallation(999)).toBeUndefined();
    expect(await m.removeInstallation(first.slot)).toEqual([{ home: "slot-1", name: "ra2.mix" }]);
    expect(await m.getGame("ra2md", second.slot)).toBeDefined();
    expect((await m.createInstallation("Third")).slot).toBe(3);
  });

  it("migrates old imports into one installation without changing their storage references", async () => {
    const factory = new IDBFactory();
    const legacy = await new Promise<IDBDatabase>((resolve) => {
      const opening = factory.open("ra2-web", 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore("games", { keyPath: "id" });
        opening.result.createObjectStore("settings");
      };
      opening.onsuccess = () => resolve(opening.result);
    });
    await new Promise<void>((resolve) => {
      const tx = legacy.transaction(["games", "settings"], "readwrite");
      for (const id of ["ra2", "ra2md"])
        tx.objectStore("games").put({
          id,
          title: id,
          exeStamp: 1,
          importedAt: 123,
          bytes: 1000,
          complete: true,
          files: { "ra2.mix": { ...plan("ra2.mix")[0], done: true, home: "ra2md" } },
        });
      tx.objectStore("settings").put([{ name: "My mod", files: [], bytes: 0 }], "mods:ra2md");
      tx.oncomplete = () => resolve();
    });
    legacy.close();
    const m = await Manifest.open(factory);
    expect((await m.listInstallations()).map((entry) => entry.slot)).toEqual([1]);
    expect((await m.listGames(1)).map((entry) => [entry.id, entry.storage])).toEqual([
      ["ra2", "ra2"],
      ["ra2md", "ra2md"],
    ]);
    expect((await m.getGame("ra2", 1))?.files["ra2.mix"]?.home).toBe("ra2md");
    expect(await m.getSetting("mods:ra2md")).toEqual([{ name: "My mod", files: [], bytes: 0 }]);
    expect(await m.removeGame("ra2", 1)).toEqual([]);
    expect(await m.removeInstallation(1)).toEqual([{ home: "ra2md", name: "ra2.mix" }]);
  });
});
