import { describe, expect, it } from "vitest";
import { csfName, findBaseCsf, hostIniPath, languageMixName } from "./csf-source";
import { mixHash } from "./mix";

class MemFs {
  files = new Map<string, Uint8Array>();
  put(path: string, text: string | Uint8Array): void {
    this.files.set(path, typeof text === "string" ? new TextEncoder().encode(text) : text);
  }
  readdir(path: string): string[] {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length).split("/");
      if (rest[0]) names.add(rest[0]);
    }
    if (names.size === 0) throw new Error(`no directory ${path}`);
    return [...names];
  }
  readFile(path: string): Uint8Array {
    const data = this.files.get(path);
    if (!data) throw new Error(`no file ${path}`);
    return data;
  }
  stat(path: string): { size: number } | undefined {
    const data = this.files.get(path);
    return data ? { size: data.length } : undefined;
  }
}

function makeMix(name: string, data: Uint8Array): Uint8Array {
  const bodyStart = 4 + 6 + 12;
  const out = new Uint8Array(bodyStart + data.length);
  const view = new DataView(out.buffer);
  // new format, unencrypted: word 0 is zero, flags at 2, count at 4
  view.setUint16(4, 1, true);
  view.setUint32(10, mixHash(name), true);
  view.setUint32(14, 0, true);
  view.setUint32(18, data.length, true);
  out.set(data, bodyStart);
  return out;
}

const csf = new TextEncoder().encode(" FSC mod");

describe("findBaseCsf", () => {
  it("names the files per edition", async () => {
    expect(csfName("ra2")).toBe("ra2.csf");
    expect(csfName("ra2md")).toBe("ra2md.csf");
    expect(languageMixName("ra2")).toBe("language.mix");
    expect(languageMixName("ra2md")).toBe("langmd.mix");
    expect(hostIniPath("ra2md")).toBe("/game/.host/ra2md.ini");
  });

  it("prefers the active mod's loose CSF", async () => {
    const fs = new MemFs();
    fs.put("/game/.host/ra2md.ini", "[mods]\nactive=Thai\n");
    fs.put("/game/mods/Thai/ra2md.csf", new Uint8Array([1]));
    fs.put("/game/ra2md.csf", new Uint8Array([2]));
    fs.put("/game/langmd.mix", makeMix("ra2md.csf", new Uint8Array([3])));
    const found = await findBaseCsf(fs, "ra2md");
    expect(found?.source).toBe("mod");
    expect(found?.path).toBe("/game/mods/Thai/ra2md.csf");
    expect(Array.from(found?.data ?? [])).toEqual([1]);
  });

  it("finds the mod folder and file case-insensitively", async () => {
    const fs = new MemFs();
    fs.put("/game/.host/ra2md.ini", "[mods]\nactive=thai\n");
    fs.put("/game/mods/THAI/RA2MD.CSF", new Uint8Array([7]));
    const found = await findBaseCsf(fs, "ra2md");
    expect(found?.source).toBe("mod");
    expect(Array.from(found?.data ?? [])).toEqual([7]);
  });

  it("ignores a mod when active=none", async () => {
    const fs = new MemFs();
    fs.put("/game/.host/ra2md.ini", "[mods]\nactive=none\n");
    fs.put("/game/mods/Thai/ra2md.csf", new Uint8Array([1]));
    fs.put("/game/ra2md.csf", new Uint8Array([2]));
    const found = await findBaseCsf(fs, "ra2md");
    expect(found?.source).toBe("loose");
    expect(Array.from(found?.data ?? [])).toEqual([2]);
  });

  it("falls back to the loose CSF before the language MIX", async () => {
    const fs = new MemFs();
    fs.put("/game/ra2.csf", new Uint8Array([4]));
    fs.put("/game/language.mix", makeMix("ra2.csf", new Uint8Array([5])));
    const found = await findBaseCsf(fs, "ra2");
    expect(found?.source).toBe("loose");
    expect(Array.from(found?.data ?? [])).toEqual([4]);
  });

  it("extracts the CSF from the language MIX", async () => {
    const fs = new MemFs();
    fs.put("/game/langmd.mix", makeMix("ra2md.csf", csf));
    const found = await findBaseCsf(fs, "ra2md");
    expect(found?.source).toBe("mix");
    expect(found?.path).toBe("/game/langmd.mix:ra2md.csf");
    expect(Array.from(found?.data ?? [])).toEqual(Array.from(csf));
  });

  it("scans other small MIX files after the language MIX", async () => {
    const fs = new MemFs();
    fs.put("/game/expandmd01.mix", makeMix("ra2md.csf", csf));
    const found = await findBaseCsf(fs, "ra2md");
    expect(found?.source).toBe("mix");
    expect(found?.path).toBe("/game/expandmd01.mix:ra2md.csf");
  });

  it("returns null when no table is present", async () => {
    const fs = new MemFs();
    fs.put("/game/ra2md.ini", "[Options]\n");
    expect(await findBaseCsf(fs, "ra2md")).toBeNull();
  });
});
