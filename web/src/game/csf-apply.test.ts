import { describe, expect, it } from "vitest";
import { parseCsf } from "../storage/csf";
import { mixHash } from "../storage/mix";
import { startSaveSync } from "../storage/saves";
import type { LauncherEditionStrings, LauncherStringsConfig } from "../storage/launcher-strings";
import { applyCsfOverrides, type CsfApplyFs } from "./csf-apply";

class MemFs implements CsfApplyFs {
  files = new Map<string, Uint8Array>();
  times = new Map<string, number>();
  private clock = 1;
  put(path: string, data: Uint8Array | string): void {
    this.files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
    this.times.set(path, this.clock++);
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
  writeFile(path: string, data: Uint8Array): void {
    this.files.set(path, data);
    this.times.set(path, this.clock++);
  }
  mkdir(): void {
    // Directories are implicit in this Map-backed file system.
  }
  stat(path: string): { mode: number; size: number; mtime: number } {
    const data = this.files.get(path);
    if (!data) throw new Error(`no file ${path}`);
    return { mode: 0o100644, size: data.length, mtime: this.times.get(path) ?? 0 };
  }
}

function makeCsf(entries: { label: string; text: string }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const header = new Uint8Array(24);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x43534620, true);
  view.setUint32(4, 3, true);
  view.setUint32(8, entries.length, true);
  view.setUint32(12, entries.length, true);
  chunks.push(header);
  for (const entry of entries) {
    const label = new TextEncoder().encode(entry.label);
    const units = [...entry.text].map((char) => char.codePointAt(0) ?? 0);
    const pair = new Uint8Array(8 + units.length * 2);
    const pairView = new DataView(pair.buffer);
    pairView.setUint32(0, 0x53545220, true);
    pairView.setUint32(4, units.length, true);
    units.forEach((unit, index) => pairView.setUint16(8 + index * 2, ~unit & 0xffff, true));
    const entryHeader = new Uint8Array(12);
    const entryView = new DataView(entryHeader.buffer);
    entryView.setUint32(0, 0x4c424c20, true);
    entryView.setUint32(4, 1, true);
    entryView.setUint32(8, label.length, true);
    chunks.push(entryHeader, label, pair);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function makeMix(name: string, data: Uint8Array): Uint8Array {
  const bodyStart = 4 + 6 + 12;
  const out = new Uint8Array(bodyStart + data.length);
  const view = new DataView(out.buffer);
  view.setUint16(4, 1, true);
  view.setUint32(10, mixHash(name), true);
  view.setUint32(14, 0, true);
  view.setUint32(18, data.length, true);
  out.set(data, bodyStart);
  return out;
}

const overrides = (
  strings: Record<string, string>,
  extra: Partial<LauncherEditionStrings> = {},
): LauncherStringsConfig => ({
  version: 1,
  editions: {
    ra2md: {
      enabled: true,
      encoding: "windows-1252",
      strings,
      inject: false,
      extra: {},
      ...extra,
    },
  },
});

describe("applyCsfOverrides", () => {
  it("rewrites the import's loose CSF", async () => {
    const fs = new MemFs();
    fs.put("/game/ra2md.csf", makeCsf([{ label: "GUI:ExitGame", text: "Exit Game" }]));
    const result = await applyCsfOverrides(fs, "ra2md", {
      readStrings: async () => overrides({ "GUI:EXITGAME": "Exit to Launcher" }),
    });
    expect(result.applied).toBe(true);
    expect(result.path).toBe("/game/ra2md.csf");
    expect(result.source).toBe("loose");
    const written = parseCsf(fs.readFile("/game/ra2md.csf"));
    expect(written.entries[0]?.values[0]?.value).toBe("Exit to Launcher");
  });

  it("fills {version} in the override text", async () => {
    const fs = new MemFs();
    fs.put("/game/ra2md.csf", makeCsf([{ label: "GUI:Version", text: "Version" }]));
    const result = await applyCsfOverrides(fs, "ra2md", {
      readStrings: async () => overrides({ "GUI:VERSION": "YN {version} /" }),
      version: "9.8.7",
    });
    expect(result.applied).toBe(true);
    const written = parseCsf(fs.readFile("/game/ra2md.csf"));
    expect(written.entries[0]?.values[0]?.value).toBe("YN 9.8.7 /");
  });

  it("rewrites the active mod's CSF, not the root file", async () => {
    const fs = new MemFs();
    fs.put("/game/.host/ra2md.ini", "[mods]\nactive=Thai\n");
    fs.put("/game/mods/Thai/ra2md.csf", makeCsf([{ label: "GUI:ExitGame", text: "Exit Game" }]));
    fs.put("/game/ra2md.csf", makeCsf([{ label: "GUI:ExitGame", text: "Root" }]));
    const result = await applyCsfOverrides(fs, "ra2md", {
      readStrings: async () => overrides({ "GUI:EXITGAME": "Exit to Launcher" }),
    });
    expect(result.path).toBe("/game/mods/Thai/ra2md.csf");
    expect(result.source).toBe("mod");
    expect(parseCsf(fs.readFile("/game/mods/Thai/ra2md.csf")).entries[0]?.values[0]?.value).toBe(
      "Exit to Launcher",
    );
    expect(parseCsf(fs.readFile("/game/ra2md.csf")).entries[0]?.values[0]?.value).toBe("Root");
  });

  it("writes a loose CSF when the base came from the language MIX", async () => {
    const fs = new MemFs();
    fs.put(
      "/game/langmd.mix",
      makeMix("ra2md.csf", makeCsf([{ label: "GUI:ExitGame", text: "Exit Game" }])),
    );
    const result = await applyCsfOverrides(fs, "ra2md", {
      readStrings: async () => overrides({ "GUI:EXITGAME": "Exit to Launcher" }),
    });
    expect(result.applied).toBe(true);
    expect(result.path).toBe("/game/ra2md.csf");
    expect(result.source).toBe("mix");
    expect(parseCsf(fs.readFile("/game/ra2md.csf")).entries[0]?.values[0]?.value).toBe(
      "Exit to Launcher",
    );
  });

  it("does nothing without overrides or when disabled", async () => {
    const fs = new MemFs();
    const base = makeCsf([{ label: "GUI:ExitGame", text: "Exit Game" }]);
    fs.put("/game/ra2md.csf", base);
    const none = await applyCsfOverrides(fs, "ra2md", {
      readStrings: async () => ({ version: 1, editions: {} }),
    });
    expect(none.applied).toBe(false);
    expect(fs.readFile("/game/ra2md.csf")).toBe(base);

    const disabled = await applyCsfOverrides(fs, "ra2md", {
      readStrings: async () =>
        overrides({ "GUI:EXITGAME": "Exit to Launcher" }, { enabled: false }),
    });
    expect(disabled.applied).toBe(false);
    expect(fs.readFile("/game/ra2md.csf")).toBe(base);
  });

  it("warns and leaves the files alone when the base is missing", async () => {
    const fs = new MemFs();
    fs.put("/game/ra2md.ini", "[Options]\n");
    const result = await applyCsfOverrides(fs, "ra2md", {
      readStrings: async () => overrides({ "GUI:EXITGAME": "Exit to Launcher" }),
    });
    expect(result.applied).toBe(false);
    expect(result.warning).toMatch(/no CSF/);
    expect(fs.files.has("/game/ra2md.csf")).toBe(false);
  });

  it("applies the labels it has and reports the ones it does not", async () => {
    const fs = new MemFs();
    fs.put("/game/ra2md.csf", makeCsf([{ label: "GUI:ExitGame", text: "Exit Game" }]));
    const result = await applyCsfOverrides(fs, "ra2md", {
      readStrings: async () =>
        overrides({ "GUI:EXITGAME": "Exit to Launcher", "GUI:Missing": "Nope" }),
    });
    expect(result.applied).toBe(true);
    expect(result.missing).toEqual(["GUI:MISSING"]);
    expect(result.warning).toMatch(/not in this table/);
  });

  it("warns when Thai text is written without the Thai font fix", async () => {
    const fs = new MemFs();
    fs.put("/game/ra2md.csf", makeCsf([{ label: "GUI:ExitGame", text: "Exit Game" }]));
    const result = await applyCsfOverrides(fs, "ra2md", {
      thaiFontFixEnabled: false,
      readStrings: async () => overrides({ "GUI:EXITGAME": "ออกเกม" }, { encoding: "windows-874" }),
    });
    expect(result.applied).toBe(true);
    expect(result.warning).toMatch(/Thai font fix is off/);
    expect(
      parseCsf(fs.readFile("/game/ra2md.csf"), "windows-874").entries[0]?.values[0]?.value,
    ).toBe("ออกเกม");
  });

  it("fails closed when the value cannot be encoded", async () => {
    const fs = new MemFs();
    const base = makeCsf([{ label: "GUI:ExitGame", text: "Exit Game" }]);
    fs.put("/game/ra2md.csf", base);
    const result = await applyCsfOverrides(fs, "ra2md", {
      readStrings: async () => overrides({ "GUI:EXITGAME": "ออกเกม" }),
    });
    expect(result.applied).toBe(false);
    expect(result.warning).toMatch(/not applied/);
    expect(fs.readFile("/game/ra2md.csf")).toBe(base);
  });

  it("does not let the save watcher persist the generated CSF", async () => {
    const fs = new MemFs();
    fs.put("/game/ra2md.csf", makeCsf([{ label: "GUI:ExitGame", text: "Exit Game" }]));
    await applyCsfOverrides(fs, "ra2md", {
      readStrings: async () => overrides({ "GUI:EXITGAME": "Exit to Launcher" }),
    });
    const written = new Map<string, Uint8Array>();
    const target = {
      async write(path: string, stream: ReadableStream<Uint8Array>) {
        written.set(path, new Uint8Array(await new Response(stream).arrayBuffer()));
      },
      async size() {
        return null;
      },
      async remove() {},
    };
    const sync = startSaveSync(fs, target, "ra2md", 60_000, 0);
    await sync.flush();
    sync.stop();
    expect(written.has("save/ra2md/ra2md.csf")).toBe(false);
  });
});
