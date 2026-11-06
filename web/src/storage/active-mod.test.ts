import { describe, expect, it } from "vitest";
import { decodeLatin1, encodeLatin1, type GameSettingsDeps } from "./game-settings";
import type { GameRecord } from "./manifest";
import type { ModRecord } from "./mods";
import { readActiveMod, writeActiveMod } from "./active-mod";

const yr: GameRecord = {
  id: "ra2md",
  slot: 1,
  storage: "ra2md-1",
  title: "Yuri's Revenge",
  exeStamp: 0,
  importedAt: 0,
  bytes: 0,
  complete: true,
  files: {},
};
const mod = (name: string): ModRecord => ({ name, files: [], bytes: 0 });

function store(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const deps: GameSettingsDeps = {
    readSave: async (storage, name) => {
      const text = files.get(`${storage}/${name}`);
      return text === undefined ? null : { name, data: encodeLatin1(text) };
    },
    writeSave: async (storage, name, data) =>
      void files.set(`${storage}/${name}`, decodeLatin1(data)),
    readImported: async () => {
      throw new Error("none");
    },
  };
  return { deps, files };
}

describe("active mod", () => {
  it("no host file reads Vanilla", async () => {
    const { deps } = store();
    await expect(readActiveMod(yr, [mod("Mental Omega")], deps)).resolves.toBe("");
  });

  it("reads [mods] active", async () => {
    const { deps } = store({
      "ra2md-1/.host/ra2md.ini": "[present]\nscale=sharp\n[mods]\nactive=Mental Omega\n",
    });
    await expect(readActiveMod(yr, [mod("Mental Omega")], deps)).resolves.toBe("Mental Omega");
  });

  it("a removed mod reads Vanilla", async () => {
    const { deps } = store({ "ra2md-1/.host/ra2md.ini": "[mods]\nactive=Mental Omega\n" });
    await expect(readActiveMod(yr, [mod("Other")], deps)).resolves.toBe("");
  });

  it("a non-Latin mod name is stored as UTF-8 bytes, as the host reads it", async () => {
    const { deps, files } = store();
    await writeActiveMod(yr, "ม็อดไทย", deps);
    const bytes = encodeLatin1(files.get("ra2md-1/.host/ra2md.ini")!);
    expect(new TextDecoder().decode(bytes)).toContain("active=ม็อดไทย");
    await expect(readActiveMod(yr, [mod("ม็อดไทย")], deps)).resolves.toBe("ม็อดไทย");
  });

  it("reads a non-Latin name the game wrote in UTF-8", async () => {
    const { deps } = store({
      "ra2md-1/.host/ra2md.ini": decodeLatin1(new TextEncoder().encode("[mods]\nactive=ม็อดไทย\n")),
    });
    await expect(readActiveMod(yr, [mod("ม็อดไทย")], deps)).resolves.toBe("ม็อดไทย");
  });

  it("write then read round-trips, keeping the other host values", async () => {
    const { deps, files } = store({ "ra2md-1/.host/ra2md.ini": "[present]\nscale=sharp\n" });
    await writeActiveMod(yr, "Mental Omega", deps);
    await expect(readActiveMod(yr, [mod("Mental Omega")], deps)).resolves.toBe("Mental Omega");
    expect(files.get("ra2md-1/.host/ra2md.ini")).toContain("scale=sharp");
  });

  it('writing "" leaves active= empty', async () => {
    const { deps, files } = store({ "ra2md-1/.host/ra2md.ini": "[mods]\nactive=Mental Omega\n" });
    await writeActiveMod(yr, "", deps);
    expect(files.get("ra2md-1/.host/ra2md.ini")).toMatch(/^active=$/m);
    await expect(readActiveMod(yr, [mod("Mental Omega")], deps)).resolves.toBe("");
  });
});
