import { describe, expect, it } from "vitest";
import { parseCsf } from "../csf";
import { readMixEntry, readMixIndex } from "../mix";
import { buildModPack, type BaseData } from "./build";
import { csfBytes } from "./fixtures";
import {
  Category,
  Encoding,
  FileType,
  type ModEntry,
  type ModNamedId,
  type ModOptions,
  type ModPack,
} from "./model";
import { writeMix } from "./mix-write";

const encode = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder("latin1").decode(data);

function makePack(
  entries: Partial<ModEntry>[],
  options: Partial<ModOptions> = {},
  modes: ModNamedId[] = [],
): ModPack {
  return {
    options: {
      author: "Tester",
      mail: "",
      linkTitle: "",
      link: "",
      modName: "Test Mod",
      version: "1.0",
      updateLink: "",
      game: "ra2md",
      mfs: "98",
      ...options,
    },
    modes,
    modules: [],
    entries: entries.map((entry) => ({
      category: Category.Ini,
      fname: "rulesmd.ini",
      ft: -1,
      encoding: Encoding.None,
      mode: -1,
      module: -1,
      bytes: new Uint8Array([1]),
      ...entry,
    })),
    warnings: [],
  };
}

function base(overrides: Partial<BaseData> = {}): BaseData {
  return {
    ini: async (name) =>
      name.toLowerCase() === "rulesmd.ini" ? encode("[General]\nSpeed=4\nName=Base\n") : null,
    csf: async () =>
      csfBytes([
        ["GUI:ExitGame", "Exit"],
        ["GUI:Start", "Start"],
      ]),
    sideMix: async () => null,
    ...overrides,
  };
}

function findFile(files: { name: string; bytes: Uint8Array }[], name: string) {
  const file = files.find((candidate) => candidate.name === name);
  expect(file, name).toBeTruthy();
  return file!.bytes;
}

describe("buildModPack", () => {
  it("merges an INI difference into the expand mix", async () => {
    const pack = makePack([
      {
        category: Category.Ini,
        fname: "rulesmd.ini",
        encoding: Encoding.Diff,
        bytes: encode("[General]\nSpeed=7\nNew=1\n"),
      },
    ]);
    const built = await buildModPack(pack, base());
    const mix = findFile(built.files, "expandmd98.mix");
    const rules = readMixEntry(mix, "rulesmd.ini")!;
    expect(text(rules)).toContain("Speed=7");
    expect(text(rules)).toContain("New=1");
    expect(text(rules)).toContain("Name=Base");
  });

  it("decodes an SHP into the ecache mix", async () => {
    const shp = new Uint8Array([4, 0, 4, 0, 2, 0, 1, 2, 1, 2, 0, 0, 5, 4, 0, 4, 0]);
    const pack = makePack([
      {
        category: Category.Shp,
        fname: "tank.shp",
        ft: FileType.ShpTs,
        encoding: Encoding.Shp,
        decodedSize: 64,
        bytes: shp,
      },
    ]);
    const built = await buildModPack(pack, base());
    const mix = findFile(built.files, "ecachemd98.mix");
    const decoded = readMixEntry(mix, "tank.shp")!;
    expect(decoded.length).toBe(64);
    expect(new DataView(decoded.buffer, decoded.byteOffset).getUint16(2, true)).toBe(4);
  });

  it("merges a string-table difference over the base", async () => {
    const pack = makePack([
      {
        category: Category.StringTable,
        fname: "ra2md.csf",
        ft: FileType.Csf,
        encoding: Encoding.Diff,
        bytes: csfBytes([["GUI:ExitGame", "Leave"]]),
      },
    ]);
    const built = await buildModPack(pack, base());
    const csf = parseCsf(findFile(built.files, "ra2md.csf"));
    expect(csf.entries.find((entry) => entry.label === "GUI:ExitGame")?.values[0]?.value).toBe(
      "Leave",
    );
    expect(csf.entries.find((entry) => entry.label === "GUI:Start")?.values[0]?.value).toBe(
      "Start",
    );
  });

  it("leaves a difference out when its base file is missing", async () => {
    const pack = makePack([
      {
        category: Category.Ini,
        fname: "rulesmd.ini",
        encoding: Encoding.Diff,
        bytes: encode("[General]\nSpeed=7\n"),
      },
    ]);
    const built = await buildModPack(pack, base({ ini: async () => null }));
    expect(built.files.some((file) => file.name === "expandmd98.mix")).toBe(false);
    expect(built.warnings.some((warning) => warning.includes("difference"))).toBe(true);
  });

  it("imports the lowest mode when only modes have files", async () => {
    const pack = makePack(
      [
        {
          category: Category.Ini,
          fname: "rulesmd.ini",
          mode: 2,
          bytes: encode("[General]\nSpeed=7\n"),
        },
      ],
      {},
      [{ id: 2, name: "Hard" }],
    );
    const built = await buildModPack(pack, base());
    expect(built.files.some((file) => file.name === "expandmd98.mix")).toBe(true);
    expect(built.warnings.some((warning) => warning.includes("Hard"))).toBe(true);
  });

  it("warns about what it cannot bring and leaves it out", async () => {
    const pack = makePack([
      { category: Category.Sound, fname: "shot.wav", ft: FileType.Wav, bytes: new Uint8Array([1]) },
      {
        category: Category.Launcher,
        fname: "banner.jpeg",
        ft: FileType.Jpeg,
        bytes: new Uint8Array([1]),
      },
      {
        category: Category.Screen,
        fname: "load.jpg",
        ft: FileType.Jpeg,
        bytes: new Uint8Array([1]),
      },
      { category: Category.Map, fname: "map.xif", ft: FileType.Xif, bytes: new Uint8Array([1]) },
    ]);
    const built = await buildModPack(pack, base());
    expect(built.files).toEqual([]);
    expect(built.warnings.join("\n")).toMatch(/sounds/);
    expect(built.warnings.join("\n")).toMatch(/launcher art/);
    expect(built.warnings.join("\n")).toMatch(/JPEG art/);
    expect(built.warnings.join("\n")).toMatch(/map project/);
  });

  it("merges sidebar changes with the stock side archive", async () => {
    const stock = writeMix([{ name: "old.shp", bytes: new Uint8Array([1, 2]) }]);
    const pack = makePack([
      {
        category: Category.Side1,
        fname: "new.shp",
        ft: FileType.ShpTs,
        bytes: new Uint8Array([3, 4]),
      },
    ]);
    const built = await buildModPack(pack, base({ sideMix: async () => stock }));
    const expand = findFile(built.files, "expandmd98.mix");
    const side = readMixEntry(expand, "sidec01.mix")!;
    expect(readMixEntry(side, "old.shp")).toEqual(new Uint8Array([1, 2]));
    expect(readMixEntry(side, "new.shp")).toEqual(new Uint8Array([3, 4]));
    expect(readMixIndex(side).entries).toHaveLength(2);
  });

  it("uses the Red Alert 2 names for a Red Alert 2 pack", async () => {
    const pack = makePack(
      [{ category: Category.Ini, fname: "rules.ini", bytes: encode("[General]\nSpeed=7\n") }],
      { game: "ra2" },
    );
    const built = await buildModPack(pack, base({ ini: async () => null }));
    expect(built.files.some((file) => file.name === "expand98.mix")).toBe(true);
  });

  it("keeps a loose missions file and screen palette out of the mix", async () => {
    const pack = makePack([
      { category: Category.Ini, fname: "missionsmd.pkt", bytes: new Uint8Array([1]) },
      { category: Category.Screen, fname: "glsmd.pal", bytes: new Uint8Array([2]) },
    ]);
    const built = await buildModPack(pack, base());
    expect(findFile(built.files, "missionsmd.pkt")).toEqual(new Uint8Array([1]));
    expect(findFile(built.files, "glsmd.pal")).toEqual(new Uint8Array([2]));
    expect(built.files.some((file) => file.name === "expandmd98.mix")).toBe(false);
  });
});
