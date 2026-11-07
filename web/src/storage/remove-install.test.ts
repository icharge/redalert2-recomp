import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { Manifest } from "./manifest";
import type { CopyTarget } from "./opfs";
import { removeInstall } from "./remove-install";

/** OPFS in memory; a path in `locked` will not delete, as a file the running game holds open. */
function lockingTarget(paths: string[]) {
  const files = new Set(paths);
  const locked = new Set<string>();
  const target: CopyTarget = {
    async write() {},
    async size(path) {
      return files.has(path) ? 4 : null;
    },
    async remove(path) {
      if (locked.has(path))
        throw new DOMException(
          "An attempt was made to modify an object",
          "NoModificationAllowedError",
        );
      files.delete(path);
    },
  };
  return { target, files, locked };
}

async function installed() {
  const manifest = await Manifest.open(new IDBFactory());
  const { slot } = await manifest.createInstallation("Main", ["ra2md"]);
  const names = ["ra2.mix", "ra2md.mix", "language.mix"];
  await manifest.beginImport(
    "ra2md",
    "Yuri's Revenge",
    1,
    names.map((name) => ({ name, size: 4, lastModified: 1, needs: ["ra2md" as const] })),
    slot,
  );
  for (const name of names) await manifest.markFileDone("ra2md", name, slot);
  return { manifest, slot, paths: names.map((name) => `game/slot-${slot}/${name}`) };
}

describe("removeInstall", () => {
  it("deletes the files, then forgets the installation", async () => {
    const { manifest, slot, paths } = await installed();
    const { target, files } = lockingTarget(paths);
    await removeInstall(manifest, target, slot);
    expect(files.size).toBe(0);
    expect(await manifest.listInstallations()).toEqual([]);
    expect(await manifest.listGames()).toEqual([]);
  });

  it("keeps the installation while a file is in use, so REMOVE GAME can be tried again", async () => {
    const { manifest, slot, paths } = await installed();
    const { target, files, locked } = lockingTarget(paths);
    locked.add(`game/slot-${slot}/ra2.mix`);
    await expect(removeInstall(manifest, target, slot)).rejects.toThrow(/in use.*another tab/);
    // what could go went; the record stays, so the files left are not lost to the launcher
    expect([...files]).toEqual([`game/slot-${slot}/ra2.mix`]);
    expect(await manifest.listInstallations()).toHaveLength(1);
    expect(await manifest.listGames(slot)).toHaveLength(1);

    locked.clear();
    await removeInstall(manifest, target, slot);
    expect(files.size).toBe(0);
    expect(await manifest.listInstallations()).toEqual([]);
  });
});
