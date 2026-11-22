import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mixHash } from "../mix";
import {
  createBaseData,
  bufferSource,
  readMixEntryRange,
  readMixIndexRange,
  type InstallFiles,
} from "./base";
import { csfBytes } from "./fixtures";
import { writeMix } from "./mix-write";

const encode = (text: string) => new TextEncoder().encode(text);

function files(map: Record<string, Uint8Array>): InstallFiles {
  return {
    async find(name) {
      const key = Object.keys(map).find(
        (candidate) => candidate.toLowerCase() === name.toLowerCase(),
      );
      return key ? bufferSource(map[key]!) : null;
    },
  };
}

function oldMix(entries: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const body = entries.reduce((sum, entry) => sum + entry.bytes.length, 0);
  const out = new Uint8Array(6 + entries.length * 12 + body);
  const view = new DataView(out.buffer);
  view.setUint16(0, entries.length, true);
  let at = 0;
  entries.forEach((entry, index) => {
    const offset = 6 + index * 12;
    view.setUint32(offset, mixHash(entry.name), true);
    view.setUint32(offset + 4, at, true);
    view.setUint32(offset + 8, entry.bytes.length, true);
    out.set(entry.bytes, 6 + entries.length * 12 + at);
    at += entry.bytes.length;
  });
  return out;
}

describe("readMixIndexRange", () => {
  it("reads a new-format index and one entry by range", async () => {
    const data = writeMix([
      { name: "rulesmd.ini", bytes: encode("[General]\n") },
      { name: "ra2md.csf", bytes: new Uint8Array([1, 2, 3]) },
    ]);
    const source = bufferSource(data);
    const index = await readMixIndexRange(source);
    expect(index.kind).toBe("new");
    expect(index.entries).toHaveLength(2);
    expect([...(await readMixEntryRange(source, index, "rulesmd.ini"))!]).toEqual([
      ...encode("[General]\n"),
    ]);
    expect(await readMixEntryRange(source, index, "missing.ini")).toBeNull();
  });

  it("reads an old-format index", async () => {
    const data = oldMix([{ name: "ra2.csf", bytes: new Uint8Array([9]) }]);
    const source = bufferSource(data);
    const index = await readMixIndexRange(source);
    expect(index.kind).toBe("old");
    expect([...(await readMixEntryRange(source, index, "ra2.csf"))!]).toEqual([9]);
  });

  it("refuses a truncated index", async () => {
    const data = writeMix([{ name: "a.ini", bytes: new Uint8Array([1]) }]);
    await expect(readMixIndexRange(bufferSource(data.subarray(0, 6)))).rejects.toThrow();
  });
});

describe("createBaseData", () => {
  const rules = encode("[General]\nSpeed=4\n");
  const csf = csfBytes([["GUI:ExitGame", "Exit"]]);
  const side = new Uint8Array([7, 8, 9]);
  const localmd = writeMix([{ name: "rulesmd.ini", bytes: rules }]);
  const map: Record<string, Uint8Array> = {
    "ra2md.mix": writeMix([{ name: "localmd.mix", bytes: localmd }]),
    "langmd.mix": writeMix([{ name: "ra2md.csf", bytes: csf }]),
    "ra2.mix": writeMix([{ name: "sidec01.mix", bytes: side }]),
  };
  const data = createBaseData("ra2md", files(map));

  it("reads a base INI from the local mix inside ra2md.mix", async () => {
    expect([...(await data.ini("rulesmd.ini"))!]).toEqual([...rules]);
    expect([...(await data.ini("RULESMD.INI"))!]).toEqual([...rules]);
  });

  it("prefers a loose file over the archive", async () => {
    const loose = createBaseData(
      "ra2md",
      files({
        ...map,
        "rulesmd.ini": encode("[General]\nSpeed=9\n"),
      }),
    );
    expect([...(await loose.ini("rulesmd.ini"))!]).toEqual([...encode("[General]\nSpeed=9\n")]);
  });

  it("reads the string table from the language mix", async () => {
    expect([...(await data.csf())!]).toEqual([...csf]);
  });

  it("reads a stock side archive", async () => {
    expect([...(await data.sideMix(1))!]).toEqual([...side]);
  });

  it("answers null when a file is missing", async () => {
    const empty = createBaseData("ra2md", files({}));
    expect(await empty.ini("rulesmd.ini")).toBeNull();
    expect(await empty.csf()).toBeNull();
    expect(await empty.sideMix(1)).toBeNull();
  });

  it("uses the Red Alert 2 names for a Red Alert 2 install", async () => {
    const ra2 = createBaseData(
      "ra2",
      files({
        "ra2.mix": writeMix([
          { name: "local.mix", bytes: writeMix([{ name: "rules.ini", bytes: rules }]) },
        ]),
        "language.mix": writeMix([{ name: "ra2.csf", bytes: csf }]),
      }),
    );
    expect([...(await ra2.ini("rules.ini"))!]).toEqual([...rules]);
    expect([...(await ra2.csf())!]).toEqual([...csf]);
  });
});

const REAL_RA2MD = "C:/Users/Norrapat/projects/redalert2-recomp/game/ra2md.mix";

describe("real archive by range", () => {
  it.skipIf(!existsSync(REAL_RA2MD))(
    "reads ra2md.mix's encrypted index without the body",
    async () => {
      const fd = openSync(REAL_RA2MD, "r");
      try {
        const size = statSync(REAL_RA2MD).size;
        const source = {
          size,
          read: async (start: number, length: number) => {
            const buffer = Buffer.alloc(length);
            readSync(fd, buffer, 0, length, start);
            return new Uint8Array(buffer);
          },
        };
        const index = await readMixIndexRange(source);
        expect(index.kind).toBe("new");
        expect(index.entries.length).toBeGreaterThan(20);
        const local = await readMixEntryRange(source, index, "localmd.mix");
        expect(local?.length).toBeGreaterThan(1_000_000);
        const inner = await readMixIndexRange(bufferSource(local!));
        expect(
          (await readMixEntryRange(bufferSource(local!), inner, "rulesmd.ini"))!.length,
        ).toBeGreaterThan(100_000);
      } finally {
        closeSync(fd);
      }
    },
  );
});
