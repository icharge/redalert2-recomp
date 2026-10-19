import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { Manifest } from "../storage/manifest";
import { loadVolume, saveVolume } from "./volume";

const fresh = () => {
  const factory = new IDBFactory();
  return () => Manifest.open(factory);
};

describe("the volume", () => {
  it("is full until the player sets it", async () => {
    expect(await loadVolume(fresh())).toBe(1);
  });

  it("comes back as it was set, including silence", async () => {
    const open = fresh();
    await saveVolume(0.35, open);
    expect(await loadVolume(open)).toBe(0.35);
    await saveVolume(0, open);
    expect(await loadVolume(open)).toBe(0);
  });

  it("is full when what is kept is not a volume, or storage is not there", async () => {
    const open = fresh();
    await (await open()).setSetting("volume", "loud");
    expect(await loadVolume(open)).toBe(1);
    const broken = () => Promise.reject(new Error("no storage"));
    expect(await loadVolume(broken)).toBe(1);
    await expect(saveVolume(0.5, broken)).resolves.toBeUndefined();
  });
});
