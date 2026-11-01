import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Blowfish, mixHash, readMixEntry, readMixIndex } from "./mix";

interface Entry {
  name: string;
  data: Uint8Array;
}

function makeMix(entries: Entry[], format: "old" | "new" = "new"): Uint8Array {
  const indexHeader = 6;
  const entrySize = 12;
  const indexSize = indexHeader + entries.length * entrySize;
  const bodyOffset = format === "old" ? 0 : 4;
  const bodyStart = bodyOffset + indexSize;
  let bodySize = 0;
  const bodyParts: Uint8Array[] = [];
  const indexEntries: Uint8Array[] = [];
  for (const entry of entries) {
    const header = new Uint8Array(entrySize);
    const view = new DataView(header.buffer);
    view.setUint32(0, mixHash(entry.name), true);
    view.setUint32(4, bodySize, true);
    view.setUint32(8, entry.data.length, true);
    indexEntries.push(header);
    bodyParts.push(entry.data);
    bodySize += entry.data.length;
  }
  const index = new Uint8Array(indexSize);
  const indexView = new DataView(index.buffer);
  indexView.setUint16(0, entries.length, true);
  let at = indexHeader;
  for (const entry of indexEntries) {
    index.set(entry, at);
    at += entrySize;
  }
  const headerSize = format === "old" ? 0 : 4;
  const out = new Uint8Array(headerSize + indexSize + bodySize);
  if (format === "new") {
    // the new header's first word is zero, then the flags word
    new DataView(out.buffer).setUint16(2, 0, true);
  } else {
    new DataView(out.buffer).setUint16(0, entries.length, true);
    // old format: the count is the first word, and the index starts at 6
    out.set(index.subarray(2), 2);
    out.set(concat(bodyParts), 6 + entries.length * entrySize);
    return out;
  }
  out.set(index, 4);
  out.set(concat(bodyParts), bodyStart);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const csf = new TextEncoder().encode(" FSC fake body");
const rules = new TextEncoder().encode("[General]\n");

describe("mixHash", () => {
  it("matches the shipped CSF entry ids", () => {
    expect(mixHash("ra2.csf")).toBe(2138029279);
    expect(mixHash("ra2md.csf")).toBe(3179499641);
  });

  it("pads short names the Westwood way", () => {
    // "ra2.csf" is 7 bytes; the padding makes it 8 before the CRC.
    expect(mixHash("ra2.csf")).not.toBe(mixHash("ra2.csf "));
  });
});

describe("readMixEntry", () => {
  it("reads an unencrypted new-format archive", () => {
    const data = makeMix([
      { name: "rules.ini", data: rules },
      { name: "ra2md.csf", data: csf },
    ]);
    expect(readMixIndex(data).kind).toBe("new");
    expect(Array.from(readMixEntry(data, "ra2md.csf") ?? [])).toEqual(Array.from(csf));
    expect(Array.from(readMixEntry(data, "RULES.INI") ?? [])).toEqual(Array.from(rules));
    expect(readMixEntry(data, "missing.csf")).toBeNull();
  });

  it("reads an old-format archive", () => {
    const data = makeMix([{ name: "ra2.csf", data: csf }], "old");
    expect(readMixIndex(data).kind).toBe("old");
    expect(Array.from(readMixEntry(data, "ra2.csf") ?? [])).toEqual(Array.from(csf));
  });

  it("rejects a truncated index", () => {
    const data = makeMix([{ name: "ra2md.csf", data: csf }]);
    expect(() => readMixEntry(data.subarray(0, 12), "ra2md.csf")).toThrow();
  });

  it("rejects an entry that points outside the archive", () => {
    const data = makeMix([{ name: "ra2md.csf", data: csf }]);
    const view = new DataView(data.buffer);
    view.setUint32(10 + 4, 0xffff, true);
    expect(() => readMixEntry(data, "ra2md.csf")).toThrow(/past the end/);
  });
});

describe("Blowfish", () => {
  it("decrypts the standard zero test vector", () => {
    // The standard Blowfish vector: zero key, zero plaintext, ciphertext
    // 4EF997456198DD78. Decrypting that ciphertext must give zero.
    const cipher = new Blowfish(new Uint8Array(8));
    expect(cipher.decryptBlock(0x4ef99745, 0x6198dd78)).toEqual([0, 0]);
  });
});

const REAL_ARCHIVES = [
  ["C:/Users/Norrapat/projects/redalert2-recomp/game/language.mix", "ra2.csf", 485776],
  ["C:/Users/Norrapat/projects/redalert2-recomp/game/langmd.mix", "ra2md.csf", 573269],
] as const;

describe("real language archives", () => {
  for (const [path, name, size] of REAL_ARCHIVES) {
    it.skipIf(!existsSync(path))(`extracts ${name} from ${path.split("/").pop()}`, () => {
      const data = new Uint8Array(readFileSync(path));
      expect(readMixEntry(data, name)?.length).toBe(size);
    });
  }
});
