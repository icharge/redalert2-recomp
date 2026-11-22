import { describe, expect, it } from "vitest";
import { readMixEntry, readMixIndex } from "../mix";
import { writeMix, writeMixEntries } from "./mix-write";

const text = (value: string) => new TextEncoder().encode(value);

describe("writeMix", () => {
  it("writes a mix its reader can read back", () => {
    const data = writeMix([
      { name: "rulesmd.ini", bytes: text("[General]\nSpeed=7\n") },
      { name: "tank.shp", bytes: new Uint8Array([1, 2, 3]) },
    ]);
    const index = readMixIndex(data);
    expect(index.kind).toBe("new");
    expect(index.flags).toBe(0);
    expect(index.entries).toHaveLength(2);
    expect([...readMixEntry(data, "rulesmd.ini")!]).toEqual([...text("[General]\nSpeed=7\n")]);
    expect([...readMixEntry(data, "tank.shp")!]).toEqual([1, 2, 3]);
    expect(readMixEntry(data, "absent.ini")).toBeNull();
  });

  it("keeps entries sorted by id", () => {
    const data = writeMix([
      { name: "b.ini", bytes: new Uint8Array([2]) },
      { name: "a.ini", bytes: new Uint8Array([1]) },
    ]);
    const ids = readMixIndex(data).entries.map((entry) => entry.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("keeps the last of two files with the same name", () => {
    const data = writeMix([
      { name: "rules.ini", bytes: new Uint8Array([1]) },
      { name: "rules.ini", bytes: new Uint8Array([2]) },
    ]);
    expect(readMixEntry(data, "rules.ini")).toEqual(new Uint8Array([2]));
  });

  it("writes an empty mix", () => {
    const data = writeMix([]);
    expect(data.length).toBe(10);
    expect(readMixIndex(data).entries).toEqual([]);
  });

  it("writes entries that already have an id", () => {
    const data = writeMixEntries([{ id: 7, bytes: new Uint8Array([9]) }]);
    const index = readMixIndex(data);
    expect(index.entries[0]!.id).toBe(7);
    expect([...data.subarray(index.bodyOffset)]).toEqual([9]);
  });
});
