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
    expect(record.files["ra2.mix"]?.home).toBe("ra2md");
    expect(record.files["game-only.mix"]?.home).toBe("ra2");
  });

  it("removing one game deletes only what no other game reads", async () => {
    const m = await both();
    await m.beginImport("ra2", "Red Alert 2", 2, plan("ra2.mix", "game-only.mix"));
    await m.markFileDone("ra2", "game-only.mix");
    expect(await m.removeGame("ra2")).toEqual([{ home: "ra2", name: "game-only.mix" }]);
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
