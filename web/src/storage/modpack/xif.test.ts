import { describe, expect, it } from "vitest";
import { buildXif, decodeBase64, packXifTree, type FixtureNode } from "./fixtures";
import { readXif, XifError, xifBytes, xifInt, xifKey, xifText } from "./xif";

function fromHex(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}

// A version 2 file with a raw 41-byte tree, written by hand from the layout:
// root -> key 7 (empty), value 3 = "hi\0", value 11 = int32 6.
const literal = fromHex(
  "5849461a02000000" + // id, version
    "00000000" + // size_uncompressed: raw
    "29000000" + // size_compressed: 41
    "00000000" + // size_external
    "01000000" + // key count
    "07000000" + // key id delta
    "00000000" +
    "00000000" + // child: no keys, no values
    "02000000" + // value count
    "03000000" +
    "0303000000686900" + // value 3: string "hi"
    "08000000" +
    "0206000000", // value 11 (delta 8): int32 6
);

// The same 41-byte tree, bzip2-compressed once with Python's bz2.
const bzip2Tree = decodeBase64(
  "QlpoOTFBWSZTWaFw04gAAAvBAHnAAGAgACEpqNkCDJiG45J5UVqMR9NBvC7kinChIULhpxA=",
);

describe("readXif", () => {
  it("reads a hand-written raw file", async () => {
    const root = await readXif(literal);
    expect(xifKey(root, 7)?.keys.size).toBe(0);
    expect(xifText(root.values.get(3))).toBe("hi");
    expect(xifInt(root.values.get(11))).toBe(6);
  });

  it("reads a zlib tree", async () => {
    const data = buildXif(
      {
        keys: [[1, { keys: [[9, { values: [[2, "nested"]] }]] }]],
        values: [
          [3, "name"],
          [4, { int32: -7 }],
          [5, { bin32: 0xdeadbeef }],
          [6, { float: 1.5 }],
          [7, new Uint8Array([1, 2, 3])],
        ],
      },
      { compression: "zlib" },
    );
    const root = await readXif(data);
    expect(xifKey(root, 1)?.keys.get(9)?.values.get(2)).toMatchObject({ type: 3 });
    expect(xifText(root.values.get(3))).toBe("name");
    expect(xifInt(root.values.get(4))).toBe(-7);
    expect(xifInt(root.values.get(5))).toBe(0xdeadbeef);
    expect(root.values.get(6)?.float).toBe(1.5);
    expect(xifBytes(root.values.get(7))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("reads a bzip2 tree", async () => {
    const root = await readXif(packXifTree(bzip2Tree, 41));
    expect(xifText(root.values.get(3))).toBe("hi");
    expect(xifInt(root.values.get(11))).toBe(6);
  });

  it("reads values from the external block in tree order", async () => {
    const data = buildXif({
      keys: [[1, { values: [[3, { external: new Uint8Array([10, 11]) }]] }]],
      values: [[2, { external: new Uint8Array([20, 21, 22]) }]],
    });
    const root = await readXif(data);
    expect(xifBytes(xifKey(root, 1)?.values.get(3))).toEqual(new Uint8Array([10, 11]));
    expect(xifBytes(root.values.get(2))).toEqual(new Uint8Array([20, 21, 22]));
  });

  it("reads a version 0 tree", async () => {
    const body: number[] = [];
    const int = (value: number) => {
      const bytes = new Uint8Array(4);
      new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
      body.push(...bytes);
    };
    int(1); // keys
    int(7); // absolute id
    int(0); // child keys
    int(0); // child values
    int(1); // values
    int(3); // absolute id
    int(3); // size
    body.push(0x68, 0x69, 0x00);
    const data = new Uint8Array(8 + body.length);
    const view = new DataView(data.buffer);
    view.setUint32(0, 0x1a464958, true);
    view.setUint32(4, 0, true);
    data.set(Uint8Array.from(body), 8);
    const root = await readXif(data);
    expect(xifKey(root, 7)?.keys.size).toBe(0);
    expect(xifText(root.values.get(3))).toBe("hi");
  });

  it("refuses a file that is not XIF", async () => {
    await expect(readXif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toThrow(XifError);
  });

  it("refuses a truncated file", async () => {
    await expect(readXif(literal.subarray(0, 30))).rejects.toThrow(XifError);
    await expect(readXif(literal.subarray(0, 10))).rejects.toThrow(XifError);
  });

  it("refuses a tree larger than the limit", async () => {
    const data = buildXif({ values: [[1, new Uint8Array(100)]] }, { compression: "zlib" });
    await expect(readXif(data, { maxOutput: 20 })).rejects.toThrow(/larger than the allowed limit/);
  });

  it("refuses too many nodes or too much nesting", async () => {
    let deep: FixtureNode = {};
    for (let i = 0; i < 80; i++) deep = { keys: [[1, deep]] };
    const data = buildXif(deep);
    await expect(readXif(data, { maxDepth: 10 })).rejects.toThrow(/nested too deeply/);
    await expect(
      readXif(
        buildXif({
          keys: [
            [1, {}],
            [2, {}],
          ],
        }),
        { maxNodes: 2 },
      ),
    ).rejects.toThrow(/too many nodes/);
  });

  it("does not run past the external block", async () => {
    const data = buildXif({ values: [[1, { external: new Uint8Array([1, 2, 3]) }]] });
    await expect(readXif(data, { maxExternal: 2 })).rejects.toThrow(/external data/);
  });
});
