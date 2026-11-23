import { describe, expect, it } from "vitest";
import { parseCsf, rewriteCsf, type CsfEncoding } from "./csf";

/** Windows-874: Thai U+0E01..U+0E3A at 0xA1.., U+0E3F..U+0E5B at 0xDF..; ASCII as itself. */
function cp874Byte(char: string): number | undefined {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return code;
  if (code >= 0x0e01 && code <= 0x0e3a) return 0xa0 + (code - 0x0e00);
  if (code >= 0x0e3f && code <= 0x0e5b) return 0xdf + (code - 0x0e3f);
  return undefined;
}

function codeUnits(text: string, encoding: CsfEncoding): number[] {
  const units: number[] = [];
  for (const char of text) {
    if (encoding === "windows-874") {
      const byte = cp874Byte(char);
      if (byte === undefined) throw new Error(`no CP874 mapping for ${char}`);
      units.push(byte);
    } else {
      const code = char.codePointAt(0) ?? 0;
      if (code > 0xff) throw new Error(`no CP1252 mapping for ${char}`);
      units.push(code);
    }
  }
  return units;
}

interface FixtureValue {
  text: string;
  extra?: Uint8Array;
}

interface FixtureEntry {
  label: string;
  values: FixtureValue[];
}

function makeCsf(
  entries: FixtureEntry[],
  options: { encoding?: CsfEncoding; trailing?: Uint8Array } = {},
): Uint8Array {
  const encoding = options.encoding ?? "windows-1252";
  const chunks: Uint8Array[] = [];
  const header = new Uint8Array(24);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x43534620, true);
  view.setUint32(4, 3, true);
  view.setUint32(8, entries.length, true);
  view.setUint32(
    12,
    entries.reduce((sum, entry) => sum + entry.values.length, 0),
    true,
  );
  view.setUint32(16, 0, true);
  view.setUint32(20, 0, true);
  chunks.push(header);

  for (const entry of entries) {
    const label = new TextEncoder().encode(entry.label);
    const valueBytes: Uint8Array[] = [];
    for (const value of entry.values) {
      const units = codeUnits(value.text, encoding);
      const size = 8 + units.length * 2 + (value.extra ? 4 + value.extra.length : 0);
      const out = new Uint8Array(size);
      const outView = new DataView(out.buffer);
      outView.setUint32(0, value.extra ? 0x53545257 : 0x53545220, true);
      outView.setUint32(4, units.length, true);
      let at = 8;
      for (const unit of units) {
        outView.setUint16(at, ~unit & 0xffff, true);
        at += 2;
      }
      if (value.extra) {
        outView.setUint32(at, value.extra.length, true);
        at += 4;
        out.set(value.extra, at);
      }
      valueBytes.push(out);
    }
    const entryHeader = new Uint8Array(12);
    const entryView = new DataView(entryHeader.buffer);
    entryView.setUint32(0, 0x4c424c20, true);
    entryView.setUint32(4, entry.values.length, true);
    entryView.setUint32(8, label.length, true);
    chunks.push(entryHeader, label, ...valueBytes);
  }
  if (options.trailing) chunks.push(options.trailing);
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const baseEntries: FixtureEntry[] = [
  { label: "GUI:ExitGame", values: [{ text: "Exit Game" }] },
  {
    label: "VOX:ceva001",
    values: [{ text: "I am ready.", extra: new TextEncoder().encode("ceva001e") }],
  },
  { label: "STT:MainButtonExitGame", values: [{ text: "Quit Red Alert 2." }] },
];

describe("parseCsf", () => {
  it("parses labels, plain values, and WRTS extras", () => {
    const file = parseCsf(makeCsf(baseEntries));
    expect(file.entries.map((entry) => entry.label)).toEqual([
      "GUI:ExitGame",
      "VOX:ceva001",
      "STT:MainButtonExitGame",
    ]);
    expect(file.entries[0]?.values[0]?.value).toBe("Exit Game");
    expect(Array.from(file.entries[1]?.values[0]?.extra ?? [])).toEqual(
      Array.from(new TextEncoder().encode("ceva001e")),
    );
    expect(file.entries[2]?.values[0]?.extra).toBeNull();
  });

  it("keeps trailing bytes", () => {
    const file = parseCsf(makeCsf(baseEntries, { trailing: new Uint8Array([1, 2, 3]) }));
    expect(Array.from(file.trailing)).toEqual([1, 2, 3]);
  });

  it("rejects a file without the CSF signature", () => {
    const data = makeCsf(baseEntries);
    data[0] = 0;
    expect(() => parseCsf(data)).toThrow(/not a CSF/);
  });

  it("rejects a truncated label", () => {
    const data = makeCsf(baseEntries);
    expect(() => parseCsf(data.subarray(0, 30))).toThrow(/truncated|ends/);
  });

  it("rejects an overlong label", () => {
    const data = makeCsf([{ label: "X".repeat(256), values: [{ text: "x" }] }]);
    expect(() => parseCsf(data)).toThrow(/longer than/);
  });
});

describe("rewriteCsf", () => {
  it("returns the original bytes when there is nothing to change", () => {
    const data = makeCsf(baseEntries);
    const file = parseCsf(data);
    const result = rewriteCsf(file, { strings: {} });
    expect(Array.from(result.data)).toEqual(Array.from(data));
    expect(result.missing).toEqual([]);
  });

  it("rewrites GUI:ExitGame and leaves the WRTS extra and other entries alone", () => {
    const file = parseCsf(makeCsf(baseEntries));
    const result = rewriteCsf(file, {
      strings: { "GUI:ExitGame": "Exit to Launcher" },
    });
    expect(result.missing).toEqual([]);
    const rewritten = parseCsf(result.data);
    expect(rewritten.entries[0]?.values[0]?.value).toBe("Exit to Launcher");
    expect(Array.from(rewritten.entries[1]?.values[0]?.extra ?? [])).toEqual(
      Array.from(new TextEncoder().encode("ceva001e")),
    );
    expect(Array.from(rewritten.entries[1]?.raw ?? [])).toEqual(
      Array.from(file.entries[1]?.raw ?? []),
    );
    expect(Array.from(rewritten.entries[2]?.raw ?? [])).toEqual(
      Array.from(file.entries[2]?.raw ?? []),
    );
    const header = new DataView(result.data.buffer, result.data.byteOffset);
    expect(header.getUint32(8, true)).toBe(3);
    expect(header.getUint32(12, true)).toBe(3);
  });

  it("matches labels case-insensitively", () => {
    const file = parseCsf(makeCsf(baseEntries));
    const result = rewriteCsf(file, { strings: { "gui:exitgame": "Exit Now" } });
    expect(parseCsf(result.data).entries[0]?.values[0]?.value).toBe("Exit Now");
  });

  it("reports labels that are missing and does not add them by default", () => {
    const file = parseCsf(makeCsf(baseEntries));
    const result = rewriteCsf(file, { strings: { "GUI:Missing": "Nope" } });
    expect(result.missing).toEqual(["GUI:MISSING"]);
    expect(result.injected).toEqual([]);
    expect(parseCsf(result.data).entries).toHaveLength(3);
  });

  it("injects a new label when asked", () => {
    const file = parseCsf(makeCsf(baseEntries));
    const result = rewriteCsf(file, {
      strings: { "GUI:Missing": "Nope" },
      inject: true,
    });
    expect(result.missing).toEqual([]);
    expect(result.injected).toEqual(["GUI:MISSING"]);
    const rewritten = parseCsf(result.data);
    expect(rewritten.entries).toHaveLength(4);
    expect(rewritten.entries[3]?.label).toBe("GUI:MISSING");
    expect(rewritten.entries[3]?.values[0]?.value).toBe("Nope");
    const header = new DataView(result.data.buffer, result.data.byteOffset);
    expect(header.getUint32(8, true)).toBe(4);
    expect(header.getUint32(12, true)).toBe(4);
  });

  it("replaces only the first value and keeps later pairs", () => {
    const file = parseCsf(
      makeCsf([{ label: "GUI:Multi", values: [{ text: "One" }, { text: "Two" }] }]),
    );
    const result = rewriteCsf(file, { strings: { "GUI:Multi": "Uno" } });
    const rewritten = parseCsf(result.data);
    expect(rewritten.entries[0]?.values.map((value) => value.value)).toEqual(["Uno", "Two"]);
    const header = new DataView(result.data.buffer, result.data.byteOffset);
    expect(header.getUint32(12, true)).toBe(2);
  });

  it("replaces a WRTS extra when asked", () => {
    const file = parseCsf(makeCsf(baseEntries));
    const extra = new TextEncoder().encode("ceva999e");
    const result = rewriteCsf(file, {
      strings: { "VOX:ceva001": "New line." },
      extra: { "VOX:CEVA001": extra },
    });
    const rewritten = parseCsf(result.data);
    expect(rewritten.entries[1]?.values[0]?.value).toBe("New line.");
    expect(Array.from(rewritten.entries[1]?.values[0]?.extra ?? [])).toEqual(Array.from(extra));
  });

  it("encodes Thai text in windows-874 and reads it back", () => {
    const file = parseCsf(makeCsf(baseEntries), "windows-874");
    const result = rewriteCsf(file, {
      strings: { "GUI:ExitGame": "ออกเกม" },
      encoding: "windows-874",
    });
    const rewritten = parseCsf(result.data, "windows-874");
    expect(rewritten.entries[0]?.values[0]?.value).toBe("ออกเกม");
  });

  it("writes Thai as UTF-16 code units, which the TrueType text engine draws", () => {
    const file = parseCsf(makeCsf(baseEntries), "windows-874");
    const result = rewriteCsf(file, {
      strings: { "GUI:ExitGame": "ออกเกม v1" },
      encoding: "windows-874",
    });
    // read back without the code page: only real Unicode units come out as Thai
    expect(parseCsf(result.data).entries[0]?.values[0]?.value).toBe("ออกเกม v1");
  });

  it("converts untouched Thai entries stored as windows-874 bytes, and keeps the rest's bytes", () => {
    const entries = [
      { label: "GUI:ExitGame", values: [{ text: "ออกเกม" }] },
      { label: "GUI:Options", values: [{ text: "Options" }] },
    ];
    const base = makeCsf(entries, { encoding: "windows-874" });
    const file = parseCsf(base, "windows-874");
    const result = rewriteCsf(file, { strings: {}, encoding: "windows-874" });
    const rewritten = parseCsf(result.data);
    expect(rewritten.entries[0]?.values[0]?.value).toBe("ออกเกม");
    expect(Array.from(rewritten.entries[1]?.raw ?? [])).toEqual(Array.from(file.entries[1]!.raw));
  });

  it("leaves a windows-874 table without Thai byte for byte", () => {
    const base = makeCsf(baseEntries);
    const file = parseCsf(base, "windows-874");
    const result = rewriteCsf(file, { strings: {}, encoding: "windows-874" });
    expect(result.data).toBe(base);
  });

  it("rejects a Thai value when windows-1252 is selected", () => {
    const file = parseCsf(makeCsf(baseEntries));
    expect(() => rewriteCsf(file, { strings: { "GUI:ExitGame": "ออกเกม" } })).toThrow(
      /windows-1252 cannot represent/,
    );
  });

  it("keeps trailing bytes after a rewrite", () => {
    const trailing = new Uint8Array([9, 9, 9]);
    const file = parseCsf(makeCsf(baseEntries, { trailing }));
    const result = rewriteCsf(file, { strings: { "GUI:ExitGame": "Exit to Launcher" } });
    expect(Array.from(result.data.subarray(result.data.length - 3))).toEqual(Array.from(trailing));
  });
});
