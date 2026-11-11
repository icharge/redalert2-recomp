import { describe, expect, it, vi } from "vitest";
import type { MapResult } from "../game/mapdb";
import { finderRows, keptDownloads } from "./NativeMapFinder";

const map = (sha1: string, name: string, incomplete = false): MapResult => ({
  id: sha1,
  name,
  sha1,
  published: true,
  incomplete,
});

describe("finderRows", () => {
  it("makes one line per map: sha1, flags, name", () => {
    const rows = finderRows(
      [map("a".repeat(40), "Dustbowl", true), map("b".repeat(40), "Lake\tof\nFire")],
      new Set(["b".repeat(40)]),
    );
    expect(rows).toBe(`${"a".repeat(40)}\tu\tDustbowl\n${"b".repeat(40)}\ta\tLake of Fire`);
  });
  it("is empty for no maps", () => {
    expect(finderRows([], new Set())).toBe("");
  });
});

describe("keptDownloads", () => {
  it("downloads a map once however often it is asked for", async () => {
    const download = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const fetchMap = keptDownloads(download);
    const [first, second] = await Promise.all([fetchMap("a"), fetchMap("a")]);
    expect(download).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(await fetchMap("a")).toBe(first);
    expect(download).toHaveBeenCalledTimes(1);
  });
  it("tries a failed download again on the next ask", async () => {
    const download = vi
      .fn<(sha1: string) => Promise<Uint8Array>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Uint8Array([9]));
    const fetchMap = keptDownloads(download);
    await expect(fetchMap("a")).rejects.toThrow("offline");
    await Promise.resolve(); // the forgetting runs after the rejection
    await expect(fetchMap("a")).resolves.toEqual(new Uint8Array([9]));
    expect(download).toHaveBeenCalledTimes(2);
  });
  it("forgets the oldest download once more than the limit are kept", async () => {
    const download = vi.fn<(sha1: string) => Promise<Uint8Array>>(async () => new Uint8Array([1]));
    const fetchMap = keptDownloads(download, 2);
    await fetchMap("a");
    await fetchMap("b");
    await fetchMap("c");
    await fetchMap("a");
    expect(download).toHaveBeenCalledTimes(4);
    expect(download.mock.calls.map(([sha1]) => sha1)).toEqual(["a", "b", "c", "a"]);
  });
});
