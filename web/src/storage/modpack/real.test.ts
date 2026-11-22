import { existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readMixEntry } from "../mix";
import { createBaseData, type InstallFiles, type RangeSource } from "./base";
import { buildModPack } from "./build";
import { Encoding, Category, FileType, type ModPack } from "./model";

// Uses this machine's own install when it is there; nothing retail is committed.
const GAME = process.env.RA2_GAME_DIR ?? "C:/Users/Norrapat/projects/redalert2-recomp/game";

function installFiles(dir: string): InstallFiles {
  return {
    async find(name): Promise<RangeSource | null> {
      const entry = readdirSync(dir).find(
        (candidate) => candidate.toLowerCase() === name.toLowerCase(),
      );
      if (!entry) return null;
      const path = `${dir}/${entry}`;
      const fd = openSync(path, "r");
      const size = statSync(path).size;
      return {
        size,
        read: async (start, length) => {
          const buffer = Buffer.alloc(length);
          readSync(fd, buffer, 0, length, start);
          return new Uint8Array(buffer);
        },
      };
    },
  };
}

describe("a real install", () => {
  it.skipIf(!existsSync(`${GAME}/ra2md.mix`))(
    "merges a pack's rulesmd.ini difference over the shipped file",
    async () => {
      const base = createBaseData("ra2md", installFiles(GAME));
      const rules = await base.ini("rulesmd.ini");
      expect(rules?.length).toBeGreaterThan(100_000);
      const text = new TextDecoder("latin1").decode(rules!);

      let section = "";
      let chosen: { section: string; key: string } | null = null;
      for (const line of text.split(/\r?\n/)) {
        const header = /^\[([^\]]+)\]/.exec(line);
        if (header) {
          section = header[1]!.trim();
          continue;
        }
        const pair = /^([^=;#\s][^=]*)=/.exec(line);
        if (pair && section) {
          chosen = { section, key: pair[1]!.trim() };
          break;
        }
      }
      expect(chosen).not.toBeNull();

      const pack: ModPack = {
        options: {
          author: "",
          mail: "",
          linkTitle: "",
          link: "",
          modName: "Real Base Test",
          version: "1",
          updateLink: "",
          game: "ra2md",
          mfs: "98",
        },
        modes: [],
        modules: [],
        warnings: [],
        entries: [
          {
            category: Category.Ini,
            fname: "rulesmd.ini",
            ft: FileType.Ini,
            encoding: Encoding.Diff,
            mode: -1,
            module: -1,
            bytes: new TextEncoder().encode(`[${chosen!.section}]\n${chosen!.key}=12345\n`),
          },
        ],
      };
      const built = await buildModPack(pack, base);
      const mix = built.files.find((file) => file.name === "expandmd98.mix");
      expect(mix).toBeTruthy();
      const merged = readMixEntry(mix!.bytes, "rulesmd.ini")!;
      const mergedText = new TextDecoder("latin1").decode(merged);
      expect(mergedText).toContain(`${chosen!.key}=12345`);
      expect(merged.length).toBeGreaterThan(100_000);
    },
  );
});
