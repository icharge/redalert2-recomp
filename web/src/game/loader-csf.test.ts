import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCsf } from "../storage/csf";
import type { LauncherStringsConfig } from "../storage/launcher-strings";
import { startGame } from "./loader";
import { GameStore } from "./store";

const RUNTIME_STAMP = 0x12345678;
const runtimeExe = new Uint8Array(4096);
new DataView(runtimeExe.buffer).setUint16(0, 0x5a4d, true);
new DataView(runtimeExe.buffer).setUint32(0x3c, 0x80, true);
new DataView(runtimeExe.buffer).setUint32(0x80, 0x4550, true);
new DataView(runtimeExe.buffer).setUint32(0x88, RUNTIME_STAMP, true);
const runtimeBlowfish = new Uint8Array([1, 2, 3, 4]);

function makeCsf(): Uint8Array {
  const text = "Exit Game";
  const label = new TextEncoder().encode("GUI:ExitGame");
  const pair = new Uint8Array(8 + text.length * 2);
  const pv = new DataView(pair.buffer);
  pv.setUint32(0, 0x53545220, true);
  pv.setUint32(4, text.length, true);
  [...text].forEach((char, index) =>
    pv.setUint16(8 + index * 2, ~(char.codePointAt(0) ?? 0) & 0xffff, true),
  );
  const entry = new Uint8Array(12);
  const ev = new DataView(entry.buffer);
  ev.setUint32(0, 0x4c424c20, true);
  ev.setUint32(4, 1, true);
  ev.setUint32(8, label.length, true);
  const header = new Uint8Array(24);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, 0x43534620, true);
  hv.setUint32(4, 3, true);
  hv.setUint32(8, 1, true);
  hv.setUint32(12, 1, true);
  const out = new Uint8Array(24 + 12 + label.length + pair.length);
  out.set(header, 0);
  out.set(entry, 24);
  out.set(label, 36);
  out.set(pair, 36 + label.length);
  return out;
}

async function runtimeFetch(csf: Uint8Array): Promise<typeof fetch> {
  const sha256 = async (bytes: Uint8Array) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  const build = {
    games: {
      ra2md: {
        title: "Yuri's Revenge",
        exe: "gamemd.exe",
        ini: "ra2md.ini",
        build: "test-build",
        stamp: RUNTIME_STAMP,
        runtime: {
          edition: "ra2md",
          build: "test-build",
          exeSha256: await sha256(runtimeExe),
          blowfishSha256: await sha256(runtimeBlowfish),
        },
      },
    },
  };
  return ((input: unknown, init?: RequestInit) => {
    if (init?.method === "HEAD")
      return Promise.resolve(new Response("", { headers: { "content-type": "text/javascript" } }));
    const url = String(input);
    if (url.endsWith("/game/build.json")) return Promise.resolve(Response.json(build));
    if (url.endsWith("/game/runtime/ra2md/gamemd.exe"))
      return Promise.resolve(new Response(runtimeExe));
    if (url.endsWith("/game/runtime/ra2md/Blowfish.dll"))
      return Promise.resolve(new Response(runtimeBlowfish));
    if (url.endsWith("/test-game/index.json"))
      return Promise.resolve(Response.json({ files: [{ name: "ra2md.csf", size: csf.length }] }));
    if (url.endsWith("/test-game/ra2md.csf")) return Promise.resolve(new Response(csf as BodyInit));
    return Promise.resolve(new Response("", { headers: { "content-type": "text/plain" } }));
  }) as typeof fetch;
}

function testFs(files: Map<string, Uint8Array>) {
  return {
    readdir(path: string) {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length).split("/");
        if (rest[0]) names.add(rest[0]);
      }
      if (names.size === 0) throw new Error(`no directory ${path}`);
      return [...names];
    },
    mkdir() {},
    writeFile(path: string, bytes: Uint8Array) {
      files.set(path, bytes);
    },
    readFile(path: string) {
      const data = files.get(path);
      if (!data) throw new Error(`no file ${path}`);
      return data;
    },
    stat(path: string) {
      const data = files.get(path);
      if (!data) throw new Error(`no file ${path}`);
      return { mode: 0o100644, size: data.length, mtime: 1 };
    },
    symlink() {},
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.Module;
});

const override: LauncherStringsConfig = {
  version: 1,
  editions: {
    ra2md: {
      enabled: true,
      encoding: "windows-1252",
      strings: { "GUI:EXITGAME": "Exit to Launcher" },
      inject: false,
      extra: {},
    },
  },
};

describe("startGame CSF overrides", () => {
  it("applies the launcher's override before main() starts", async () => {
    const csf = makeCsf();
    vi.stubGlobal("fetch", await runtimeFetch(csf));
    const startup = startGame({
      files: { kind: "test-folder" },
      store: new GameStore(),
      readStrings: async () => override,
    });
    await vi.waitFor(() => expect(window.Module?.onRuntimeInitialized).toBeTypeOf("function"));
    const module = window.Module as Record<string, unknown> & typeof window.Module;
    const staged = new Map<string, Uint8Array>();
    module!.FS = testFs(staged) as never;
    module!.cwrap = (() => () => 0) as never;
    const callMain = vi.fn();
    module!.callMain = callMain;
    module!.onRuntimeInitialized!();
    await startup;
    const written = staged.get("/game/ra2md.csf");
    expect(written).toBeDefined();
    expect(parseCsf(written ?? new Uint8Array()).entries[0]?.values[0]?.value).toBe(
      "Exit to Launcher",
    );
    expect(callMain).toHaveBeenCalled();
  });

  it("starts the game untouched when strings.json fails", async () => {
    const csf = makeCsf();
    vi.stubGlobal("fetch", await runtimeFetch(csf));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const startup = startGame({
      files: { kind: "test-folder" },
      store: new GameStore(),
      readStrings: async () => {
        throw new Error("bad launcher file");
      },
    });
    await vi.waitFor(() => expect(window.Module?.onRuntimeInitialized).toBeTypeOf("function"));
    const module = window.Module as Record<string, unknown> & typeof window.Module;
    const staged = new Map<string, Uint8Array>();
    module!.FS = testFs(staged) as never;
    module!.cwrap = (() => () => 0) as never;
    module!.callMain = vi.fn();
    module!.onRuntimeInitialized!();
    await startup;
    expect(
      parseCsf(staged.get("/game/ra2md.csf") ?? new Uint8Array()).entries[0]?.values[0]?.value,
    ).toBe("Exit Game");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[csf]"));
    warn.mockRestore();
  });
});
