import { describe, expect, it } from "vitest";
import { readMixEntry } from "../mix";
import type { BaseData } from "./build";
import { buildXif, type FixtureNode, type FixtureValue } from "./fixtures";
import { buildPackSource, isPackName, sourceFromFiles, unwrapExe } from "./load";

const encode = (text: string) => new TextEncoder().encode(text);
const base: BaseData = {
  ini: async () => null,
  csf: async () => null,
  sideMix: async () => null,
};

function pack(entries: [string, string][], modules = false, mode?: number): Uint8Array {
  const fileValues = (fname: string, text: string): [number, FixtureValue][] => {
    const values: [number, FixtureValue][] = [
      [3, fname],
      [4, { int32: 16 }],
      [5, encode(text)],
    ];
    if (mode !== undefined) values.push([28, { int32: mode }]);
    return values;
  };
  const category: FixtureNode = { keys: [] };
  entries.forEach(([fname, text], index) => {
    category.keys!.push([index, { values: fileValues(fname, text) }]);
  });
  const keys: [number, FixtureNode][] = [];
  if (modules) keys.push([0x101, { values: [[0, "Part 2"]] }]);
  if (mode !== undefined) keys.push([0x100, { values: [[mode, "Hard"]] }]);
  keys.push([2, category]);
  return buildXif({
    keys,
    values: [
      [11, { int32: 6 }],
      [12, "My Mod"],
    ],
  });
}

async function readFile(file: { stream(): ReadableStream<Uint8Array> }): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

async function generated(source: {
  list(): Promise<{ path: string; stream(): ReadableStream<Uint8Array> }[]>;
}) {
  const out: Record<string, Uint8Array> = {};
  for (const file of await source.list()) out[file.path] = await readFile(file);
  return out;
}

function wrapExe(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(32 + payload.length + 4);
  out.set([0x4d, 0x5a], 0); // MZ, enough for the test
  out.set(payload, 32);
  new DataView(out.buffer).setInt32(out.length - 4, payload.length, true);
  return out;
}

describe("buildPackSource", () => {
  it("turns a .xmlf into a mod folder", async () => {
    const source = sourceFromFiles("folder", {
      "MyMod.xmlf": pack([["rules.ini", "[General]\n"]]),
    });
    const built = await buildPackSource(source, base);
    expect(built).not.toBeNull();
    expect(built!.name).toBe("My Mod");
    const files = await generated(built!.source);
    const mix = files["expandmd98.mix"]!;
    expect([...readMixEntry(mix, "rules.ini")!]).toEqual([...encode("[General]\n")]);
  });

  it("opens a pack wrapped in an exe", async () => {
    const source = sourceFromFiles("folder", { "MyMod.exe": wrapExe(pack([["rules.ini", "x"]])) });
    const built = await buildPackSource(source, base);
    expect(built).not.toBeNull();
    expect((await generated(built!.source))["expandmd98.mix"]).toBeTruthy();
  });

  it("returns null when the source has no pack", async () => {
    const source = sourceFromFiles("folder", { "rules.ini": encode("[General]\n") });
    expect(await buildPackSource(source, base)).toBeNull();
  });

  it("refuses an exe without the XIF trailer", async () => {
    const source = sourceFromFiles("folder", { "MyMod.exe": new Uint8Array(64) });
    await expect(buildPackSource(source, base)).rejects.toThrow(/not an XCC mod pack/);
  });

  it("merges the sibling module files", async () => {
    const source = sourceFromFiles("folder", {
      "MyMod.xmlf": pack([["rules.ini", "a"]], true),
      "MyMod 00.xmlf": pack([["part2.ini", "b"]]),
    });
    const built = await buildPackSource(source, base);
    const mix = (await generated(built!.source))["expandmd98.mix"]!;
    expect(readMixEntry(mix, "rules.ini")).not.toBeNull();
    expect(readMixEntry(mix, "part2.ini")).not.toBeNull();
  });

  it("warns when the pack's modules were not supplied", async () => {
    const source = sourceFromFiles("folder", { "MyMod.xmlf": pack([["rules.ini", "a"]], true) });
    const built = await buildPackSource(source, base);
    expect(built!.warnings.join("\n")).toMatch(/module/);
  });

  it("imports a mode the pack's files live in", async () => {
    const source = sourceFromFiles("folder", {
      "MyMod.xmlf": pack([["rules.ini", "a"]], false, 2),
    });
    const built = await buildPackSource(source, base);
    expect((await generated(built!.source))["expandmd98.mix"]).toBeTruthy();
  });
});

describe("unwrapExe", () => {
  it("keeps the XIF bytes", () => {
    const payload = pack([["rules.ini", "x"]]);
    expect([...unwrapExe(wrapExe(payload))]).toEqual([...payload]);
  });

  it("refuses a short file", () => {
    expect(() => unwrapExe(new Uint8Array([1, 2, 3]))).toThrow(/too short/);
  });
});

describe("isPackName", () => {
  it("accepts the two pack extensions only", () => {
    expect(isPackName("a.xmlf")).toBe(true);
    expect(isPackName("A.EXE")).toBe(true);
    expect(isPackName("a.zip")).toBe(false);
    expect(isPackName("a.xmcf")).toBe(false);
  });
});
