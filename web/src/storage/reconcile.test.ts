import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { Manifest } from "./manifest";
import type { CopyTarget } from "./opfs";
import { reconcileInstallation } from "./reconcile";

function target(sizes: Record<string, number>): Pick<CopyTarget, "size"> {
  return {
    async size(path) {
      return sizes[path] ?? null;
    },
  };
}

async function imported() {
  const manifest = await Manifest.open(new IDBFactory());
  const installation = await manifest.createInstallation("Reconcile");
  await manifest.beginImport(
    "ra2md",
    "Yuri's Revenge",
    1,
    [
      { name: "ra2.mix", size: 4, lastModified: 1, needs: ["ra2md"] },
      { name: "testmap.yrm", size: 12, lastModified: 1, needs: ["ra2md"] },
    ],
    installation.slot,
  );
  await manifest.markFileDone("ra2md", "ra2.mix", installation.slot);
  return { manifest, slot: installation.slot };
}

describe("reconcileInstallation", () => {
  it("marks a file OPFS already has whole as copied", async () => {
    const { manifest, slot } = await imported();
    const result = await reconcileInstallation(
      manifest,
      target({ "game/slot-1/ra2.mix": 4, "game/slot-1/testmap.yrm": 12 }),
      slot,
    );
    expect(result).toEqual({ slot, missing: [], restored: ["testmap.yrm"] });
    expect((await manifest.getGame("ra2md", slot))?.complete).toBe(true);
    manifest.close();
  });

  it("marks a copied file the copy lost as not copied", async () => {
    const { manifest, slot } = await imported();
    await reconcileInstallation(
      manifest,
      target({ "game/slot-1/ra2.mix": 4, "game/slot-1/testmap.yrm": 12 }),
      slot,
    );
    const result = await reconcileInstallation(
      manifest,
      target({ "game/slot-1/ra2.mix": 4 }),
      slot,
    );
    expect(result.missing).toEqual(["testmap.yrm"]);
    expect(result.restored).toEqual([]);
    expect((await manifest.getGame("ra2md", slot))?.complete).toBe(false);
    manifest.close();
  });

  it("does not trust a truncated copy", async () => {
    const { manifest, slot } = await imported();
    await manifest.markFileDone("ra2md", "testmap.yrm", slot);
    const result = await reconcileInstallation(
      manifest,
      target({ "game/slot-1/ra2.mix": 4, "game/slot-1/testmap.yrm": 11 }),
      slot,
    );
    expect(result.missing).toEqual(["testmap.yrm"]);
    expect(result.restored).toEqual([]);
    manifest.close();
  });
});
