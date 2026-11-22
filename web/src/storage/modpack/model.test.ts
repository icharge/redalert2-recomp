import { describe, expect, it } from "vitest";
import { buildXif, type FixtureNode, type FixtureValue } from "./fixtures";
import {
  CATEGORY_NAMES,
  Category,
  entriesForMode,
  mergeModule,
  ModPackError,
  packFolderName,
  parseModPack,
} from "./model";
import { readXif } from "./xif";

type Values = [number, FixtureValue][];

async function parse(root: FixtureNode) {
  return parseModPack(await readXif(buildXif(root)), "file");
}

function entry(fname: string, extra: Values = []): FixtureNode {
  return {
    values: [[3, fname], [4, { int32: 16 }], [5, new Uint8Array([1, 2, 3])], ...extra],
  };
}

describe("parseModPack", () => {
  it("reads the options, modes, modules and entries", async () => {
    const pack = await parse({
      keys: [
        [
          0x100,
          {
            values: [
              [0, "Normal"],
              [1, "Hard"],
            ],
          },
        ],
        [0x101, { values: [[0, "Part 2"]] }],
        [
          Category.Ini,
          {
            keys: [
              [0, entry("rulesmd.ini")],
              [1, entry("artmd.ini", [[28, { int32: 1 }]])],
            ],
          },
        ],
        [Category.Shp, { keys: [[0, entry("tank.shp")]] }],
      ],
      values: [
        [7, "Author"],
        [11, { int32: 6 }],
        [12, "My Mod"],
        [21, "2.10"],
        [24, { int32: 2 }],
        [30, "98"],
      ],
    });
    expect(pack.options).toMatchObject({
      author: "Author",
      modName: "My Mod",
      version: "2.10",
      game: "ra2md",
      mfs: "98",
    });
    expect(pack.modes).toEqual([
      { id: 0, name: "Normal" },
      { id: 1, name: "Hard" },
    ]);
    expect(pack.modules).toEqual([{ id: 0, name: "Part 2" }]);
    expect(pack.entries.map((value) => value.fname)).toEqual([
      "rulesmd.ini",
      "artmd.ini",
      "tank.shp",
    ]);
    expect(pack.entries[1]!.mode).toBe(1);
    expect(pack.warnings).toEqual([]);
  });

  it("imports a Red Alert 2 pack as ra2", async () => {
    const pack = await parse({
      values: [
        [11, { int32: 5 }],
        [12, "RA2 Mod"],
      ],
    });
    expect(pack.options.game).toBe("ra2");
  });

  it("refuses a future format version", async () => {
    await expect(parse({ values: [[24, { int32: 3 }]] })).rejects.toThrow(ModPackError);
  });

  it("warns about an unknown category and leaves it out", async () => {
    const pack = await parse({
      keys: [
        [42, { keys: [[0, entry("x.ini")]] }],
        [Category.Ini, { keys: [[0, entry("rules.ini")]] }],
      ],
    });
    expect(pack.entries).toHaveLength(1);
    expect(pack.warnings[0]).toMatch(/unknown category 42/);
  });

  it("strips a path from a file name", async () => {
    const pack = await parse({
      keys: [[Category.Ini, { keys: [[0, entry("C:\\mods\\rules.ini")]] }]],
    });
    expect(pack.entries[0]!.fname).toBe("rules.ini");
  });

  it("keeps the last of two names that differ only in case", async () => {
    const pack = await parse({
      keys: [
        [
          Category.Ini,
          {
            keys: [
              [
                0,
                {
                  values: [
                    [3, "rules.ini"],
                    [5, new Uint8Array([1])],
                  ],
                },
              ],
              [
                1,
                {
                  values: [
                    [3, "RULES.INI"],
                    [5, new Uint8Array([2])],
                  ],
                },
              ],
            ],
          },
        ],
      ],
    });
    expect(pack.entries).toHaveLength(1);
    expect(pack.entries[0]!.bytes).toEqual(new Uint8Array([2]));
    expect(pack.warnings[0]).toMatch(/appears twice/);
  });

  it("leaves out an entry with no data", async () => {
    const pack = await parse({
      keys: [[Category.Ini, { keys: [[0, { values: [[3, "rules.ini"]] }]] }]],
    });
    expect(pack.entries).toEqual([]);
    expect(pack.warnings[0]).toMatch(/no data/);
  });

  it("filters entries by mode", async () => {
    const pack = await parse({
      keys: [
        [
          Category.Ini,
          {
            keys: [
              [0, entry("always.ini")],
              [1, entry("hard.ini", [[28, { int32: 1 }]])],
            ],
          },
        ],
      ],
    });
    expect(entriesForMode(pack, -1).map((value) => value.fname)).toEqual(["always.ini"]);
    expect(entriesForMode(pack, 1).map((value) => value.fname)).toEqual(["always.ini", "hard.ini"]);
  });

  it("merges a module's entries and warnings", async () => {
    const pack = await parse({
      keys: [[Category.Ini, { keys: [[0, entry("rules.ini")]] }]],
    });
    const module = await parse({
      keys: [[Category.Shp, { keys: [[0, entry("part2.shp")]] }]],
      values: [[99, "warn"]],
    });
    mergeModule(pack, module);
    expect(pack.entries.map((value) => value.fname)).toEqual(["rules.ini", "part2.shp"]);
  });

  it("makes a safe folder name", async () => {
    const pack = await parse({
      keys: [[Category.Ini, { keys: [[0, entry("rules.ini")]] }]],
      values: [[12, "  ../My: Mod?  "]],
    });
    expect(packFolderName(pack)).toBe("My Mod");
    const accented = await parse({ values: [[12, "Café Mod"]] });
    expect(packFolderName(accented)).toBe("Café Mod");
    const empty = await parse({ values: [[12, "..."]] });
    expect(packFolderName(empty)).toBe("XCC Mod");
  });

  it("names a category it will route", () => {
    expect(CATEGORY_NAMES[Category.Side3]).toBe("side 3");
  });
});
