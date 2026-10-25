import { afterEach, describe, expect, it, vi } from "vitest";
import {
  argsFromQuery,
  createWolDataKey,
  GAME_SCRIPT,
  gameScript,
  gameModuleFile,
  GameNotBuilt,
  gameArguments,
  isBuilt,
  readBody,
  startGame,
  stageVideoSize,
  videoFromQuery,
  withVideoSize,
} from "./loader";
import { GameStore } from "./store";

const answer = (ok: boolean, type: string) =>
  Promise.resolve({ ok, headers: new Headers({ "content-type": type }) } as Response);

const RUNTIME_STAMP = 0x12345678;
const runtimeExe = new Uint8Array(4096);
new DataView(runtimeExe.buffer).setUint16(0, 0x5a4d, true);
new DataView(runtimeExe.buffer).setUint32(0x3c, 0x80, true);
new DataView(runtimeExe.buffer).setUint32(0x80, 0x4550, true);
new DataView(runtimeExe.buffer).setUint32(0x88, RUNTIME_STAMP, true);
const runtimeBlowfish = new Uint8Array([1, 2, 3, 4]);

async function runtimeFetch(
  fallback: (input: unknown, init?: RequestInit) => Promise<Response> = () =>
    answer(true, "text/plain"),
) {
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
  return (input: unknown, init?: RequestInit): Promise<Response> => {
    if (init?.method === "HEAD") return answer(true, "text/javascript");
    const url = String(input);
    if (url.endsWith("/game/build.json")) return Promise.resolve(Response.json(build));
    if (url.endsWith("/game/runtime/ra2md/gamemd.exe"))
      return Promise.resolve(new Response(runtimeExe));
    if (url.endsWith("/game/runtime/ra2md/Blowfish.dll"))
      return Promise.resolve(new Response(runtimeBlowfish));
    return fallback(input, init);
  };
}

function testFs(files = new Map<string, Uint8Array>()) {
  return {
    readdir: () => [],
    mkdir: () => {},
    writeFile: (path: string, bytes: Uint8Array) => files.set(path, bytes),
    symlink: () => {},
  } as never;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete window.Module;
});

describe("arguments", () => {
  it("starts the game from /game, with whatever arg= says", () => {
    expect(gameArguments()).toEqual(["--run", "--game", "/game"]);
    expect(gameArguments(["--hd-voxels"])).toEqual(["--run", "--game", "/game", "--hd-voxels"]);
    expect(gameArguments([], { enabled: true, fontId: "Tahoma-Th-1f" })).toEqual([
      "--run",
      "--game",
      "/game",
      "--thai-font-fix",
      "--thai-font-id",
      "Tahoma-Th-1f",
    ]);
  });

  it("takes arg= values from the URL query, in order", () => {
    expect(argsFromQuery("?arg=--hd-voxels&x=1&arg=--debuglog")).toEqual([
      "--hd-voxels",
      "--debuglog",
    ]);
    expect(argsFromQuery("")).toEqual([]);
  });
});

describe("WOL identity", () => {
  it("creates a fresh 128-digit key for each browser game runtime", () => {
    const host = createWolDataKey();
    const guest = createWolDataKey();
    expect(host).toHaveLength(128);
    expect([...host].every((byte) => byte >= 0x30 && byte <= 0x39)).toBe(true);
    expect(guest).not.toEqual(host);
  });
});

describe("isBuilt", () => {
  it("loads both runtimes under the configured context path", async () => {
    vi.stubEnv("BASE_URL", "/emu/");
    const fetcher = vi.fn(() => answer(true, "text/javascript"));
    expect(await isBuilt(fetcher as unknown as typeof fetch, "ra2md")).toBe(true);
    expect(fetcher).toHaveBeenLastCalledWith("/emu/game/ra2md.js", { method: "HEAD" });
    expect(gameScript("ra2")).toBe("/emu/game/ra2.js");
    expect(gameModuleFile("ra2md", "/emu/game/", "ra2.wasm")).toBe("/emu/game/ra2md.wasm");
    expect(gameModuleFile("ra2md", "/emu/game/", "ra2.data")).toBe("/emu/game/ra2md.data");
    expect(gameModuleFile("ra2", "/emu/game/", "ra2.wasm")).toBe("/emu/game/ra2.wasm");
    vi.unstubAllEnvs();
  });
  it("is true when ra2.js comes back as JavaScript", async () => {
    const fetcher = vi.fn(() => answer(true, "text/javascript"));
    expect(await isBuilt(fetcher as unknown as typeof fetch)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(GAME_SCRIPT, { method: "HEAD" });
  });

  it("is false when the dev server answers a missing file with the page", async () => {
    expect(await isBuilt((() => answer(true, "text/html")) as unknown as typeof fetch)).toBe(false);
  });

  it("is false for a 404, and for no network", async () => {
    expect(await isBuilt((() => answer(false, "text/plain")) as unknown as typeof fetch)).toBe(
      false,
    );
    expect(
      await isBuilt((() => Promise.reject(new Error("offline"))) as unknown as typeof fetch),
    ).toBe(false);
  });

  it("checks Red Alert 2's separately built module", async () => {
    const fetcher = vi.fn(() => answer(true, "text/javascript"));
    expect(gameScript("ra2")).toBe("/game/ra2.js");
    expect(await isBuilt(fetcher as unknown as typeof fetch, "ra2")).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("/game/ra2.js", { method: "HEAD" });
    expect(new GameNotBuilt("ra2").message).toContain("RA2_TARGET=game");
  });

  it("uses the edition-specific Yuri Wasm filename", () => {
    expect(gameScript("ra2md")).toBe("/game/ra2md.js");
    expect(gameModuleFile("ra2md", "/game/", "ra2.wasm")).toBe("/game/ra2md.wasm");
  });
});

describe("readBody", () => {
  const streamOf = (...chunks: number[][]) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
          controller.close();
        },
      }),
    );

  it("collects a stream into one array of the size it was told, counting as it goes", async () => {
    const seen: number[] = [];
    const bytes = await readBody(streamOf([1, 2], [3], [4, 5]), 5, (n) => seen.push(n));
    expect([...bytes]).toEqual([1, 2, 3, 4, 5]);
    expect(seen).toEqual([2, 3, 5]);
  });

  it("copes with a file longer or shorter than the size said", async () => {
    expect([...(await readBody(streamOf([1, 2, 3, 4]), 2, () => {}))]).toEqual([1, 2, 3, 4]);
    expect([...(await readBody(streamOf([1]), 4, () => {}))]).toEqual([1]);
  });

  it("takes a body that cannot be streamed whole", async () => {
    const response = {
      body: null,
      arrayBuffer: () => Promise.resolve(new Uint8Array([7, 8]).buffer),
    };
    const seen: number[] = [];
    expect([...(await readBody(response as unknown as Response, 2, (n) => seen.push(n)))]).toEqual([
      7, 8,
    ]);
    expect(seen).toEqual([2]);
  });
});

describe("startGame", () => {
  it.each(["lobby", "next-match", "new-login", "failed-post"])(
    "keeps result identity through %s and isolates stale completions",
    async (next) => {
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      const sockets: Socket[] = [];
      class Socket extends EventTarget {
        readyState = 1;
        constructor() {
          super();
          sockets.push(this);
        }
        send(data: string): void {
          const reply = data.startsWith("cvers ")
            ? ":wol 700 * :ok"
            : data.startsWith("setlocale ")
              ? ":wol 310 * :ok"
              : data.startsWith("session ")
                ? ":wol 376 test :done"
                : null;
          if (reply) queueMicrotask(() => this.receive(reply));
        }
        receive(data: string): void {
          this.dispatchEvent(new MessageEvent("message", { data }));
        }
        close(): void {
          this.readyState = 3;
          this.dispatchEvent(new Event("close"));
        }
      }
      vi.stubGlobal("WebSocket", Socket);
      let finish!: (response: Response) => void;
      let sentPacket: Uint8Array | undefined;
      let sentUrl = "";
      vi.stubGlobal(
        "fetch",
        await runtimeFetch((input, init) => {
          if (String(input).includes("native-results")) {
            sentUrl = String(input);
            sentPacket = init?.body as Uint8Array;
            return new Promise<Response>((resolve) => {
              finish = resolve;
            });
          }
          return Promise.resolve(new Response(JSON.stringify({ sessionToken: "token" })));
        }),
      );
      const startup = startGame({ files: { kind: "already-there" }, store: new GameStore() });
      await vi.waitFor(() => expect(window.Module?.onRuntimeInitialized).toBeTypeOf("function"));
      const module = window.Module!;
      module.FS = testFs();
      module.cwrap = (() => () => 0) as never;
      module.callMain = vi.fn();
      module.HEAPU8 = new Uint8Array(2048);
      module.onRuntimeInitialized!();
      await startup;
      const receive = vi.fn();
      module.ra2WolReceiveLine = receive;
      try {
        module.ra2WolStart!("test", "password");
        await vi.waitFor(() => expect(receive).toHaveBeenCalledWith("@wolapi connected"));
        sockets[0]!.receive(":wol STARTG #room :ws://127.0.0.1:19090/gserv :g1-old 1 ticket");
        module.ra2WolSend!("part #room");
        module.ra2WolSend!("join #Lob_41_0 zotclot9");
        const packet = new Uint8Array([0, 255, 128]);
        module.ra2WolReport!(41, 1, packet);
        packet.fill(0);
        expect(sentUrl).toBe("http://127.0.0.1:19090/native-results/g1-old");
        expect(sentPacket).toEqual(new Uint8Array([0, 255, 128]));
        if (next === "next-match")
          sockets[0]!.receive(":wol STARTG #next :ws://127.0.0.1:19090/gserv :g2-new 2 ticket");
        if (next === "new-login") module.ra2WolStart!("other", "password");
        finish(
          new Response(JSON.stringify({ stored: true, gameId: "g1-old", ranked: false }), {
            status: next === "failed-post" ? 503 : 200,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (next === "lobby") expect(receive).toHaveBeenCalledWith("@wolapi gameres 41 0");
        else expect(receive).not.toHaveBeenCalledWith("@wolapi gameres 41 0");
        if (next === "failed-post") {
          expect(receive).toHaveBeenCalledWith(`@wolapi gameres 41 ${0x80004005}`);
          expect(warning).toHaveBeenCalled();
        }
      } finally {
        module.ra2WolStop!();
        warning.mockRestore();
      }
    },
  );
  it("uses the operator's build setting for WOL authentication", async () => {
    vi.stubEnv("VITE_WOL_HTTP_URL", "https://wol.test/service/");
    vi.stubEnv("VITE_WOL_SOCKET_URL", "wss://wol.test/service/wol");
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      await runtimeFetch((input) => {
        requests.push(String(input));
        return new Promise<Response>(() => {});
      }),
    );
    const startup = startGame({ files: { kind: "already-there" }, store: new GameStore() }).catch(
      () => {},
    );
    await vi.waitFor(() => expect(window.Module?.ra2WolStart).toBeTypeOf("function"));
    const module = window.Module!;
    try {
      module.ra2WolStart!("test", "password123");
      expect(requests).toEqual(["https://wol.test/service/register"]);
    } finally {
      module.ra2WolStop!();
      module.onAbort!("test cleanup");
      await startup;
    }
  });

  it.each(["join #Lob_41_0 zotclot9", "joingame #next 1 4 41 0 0 0 0", "reconnect"])(
    "closes the prior gameplay relay on %s, preserving it on PART",
    async (next) => {
      const sockets: Socket[] = [];
      class Socket extends EventTarget {
        readyState = 0;
        sent: string[] = [];
        constructor(readonly url: string) {
          super();
          sockets.push(this);
          queueMicrotask(() => {
            this.readyState = 1;
            this.dispatchEvent(new Event("open"));
          });
        }
        send(data: string) {
          this.sent.push(data.trim());
          const reply = data.startsWith("cvers ")
            ? ":wol 700 * :ok"
            : data.startsWith("setlocale ")
              ? ":wol 310 * :ok"
              : data.startsWith("session ")
                ? ":wol 376 test :done"
                : data.startsWith("ticket ")
                  ? "ok 10.1.2.3"
                  : null;
          if (reply) queueMicrotask(() => this.receive(reply));
        }
        receive(data: string) {
          this.dispatchEvent(new MessageEvent("message", { data }));
        }
        close() {
          this.readyState = 3;
          this.dispatchEvent(new Event("close"));
        }
      }
      vi.stubGlobal("WebSocket", Socket);
      vi.stubGlobal(
        "fetch",
        await runtimeFetch(() =>
          Promise.resolve(new Response(JSON.stringify({ sessionToken: "token" }))),
        ),
      );
      const startup = startGame({ files: { kind: "already-there" }, store: new GameStore() });
      await vi.waitFor(() => expect(window.Module?.onRuntimeInitialized).toBeTypeOf("function"));
      const module = window.Module!;
      module.FS = testFs();
      module.cwrap = (() => () => 0) as never;
      module.callMain = vi.fn();
      module.HEAPU8 = new Uint8Array(2048);
      module.onRuntimeInitialized!();
      await startup;
      try {
        module.ra2WolStart!("test", "password123");
        await vi.waitFor(() => expect(sockets[0]?.sent).toContain("session token"));
        const wol = sockets[0]!;
        wol.receive(":wol STARTG #room :ws://127.0.0.1:19090/gserv :g1-local 1 ticket");
        await vi.waitFor(() => expect(sockets[1]?.sent).toContain("ticket ticket"));
        const relay = sockets[1]!;
        module.ra2WolSend!("part #room");
        expect(relay.readyState).toBe(1); // WOL room exit precedes native map loading.
        if (next === "reconnect") module.ra2WolStart!("test", "password123");
        else module.ra2WolSend!(next);
        expect(relay.readyState).toBe(3);
        if (next !== "reconnect") {
          expect(wol.readyState).toBe(1);
          expect(wol.sent).toContain(next);
        }
      } finally {
        module.ra2WolStop!();
      }
    },
  );

  it("does not deliver a cancelled WOL login result back into the game", async () => {
    let answerLogin!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      await runtimeFetch(
        () =>
          new Promise<Response>((resolve) => {
            answerLogin = resolve;
          }),
      ),
    );
    const startup = startGame({ files: { kind: "already-there" }, store: new GameStore() }).catch(
      () => {},
    );
    await vi.waitFor(() => expect(window.Module?.ra2WolStart).toBeTypeOf("function"));
    const module = window.Module!;
    const receive = vi.fn();
    module.ra2WolReceiveLine = receive;
    module.ra2WolStart!("test", "password123");
    module.ra2WolStop!();
    try {
      answerLogin(new Response(JSON.stringify({ sessionToken: "token" }), { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(receive).not.toHaveBeenCalled();
    } finally {
      module.onAbort!("test cleanup");
      await startup;
    }
  });

  it("rejects an aborted startup so leaving the page cannot wait forever", async () => {
    vi.stubGlobal("fetch", await runtimeFetch());
    const outcome = startGame({ files: { kind: "already-there" }, store: new GameStore() }).then(
      () => "resolved",
      (error: Error) => error.message,
    );
    await vi.waitFor(() => expect(window.Module?.onAbort).toBeTypeOf("function"));
    window.Module!.onAbort!("bad wasm");
    expect(
      await Promise.race([
        outcome,
        new Promise((resolve) => setTimeout(() => resolve("still pending"), 100)),
      ]),
    ).toContain("bad wasm");
  });
  it("holds main() until the runtime is up and the files are in place, then starts it itself", async () => {
    vi.stubGlobal("fetch", await runtimeFetch());
    const startup = startGame({ files: { kind: "already-there" }, store: new GameStore() });
    await vi.waitFor(() => expect(window.Module?.onRuntimeInitialized).toBeTypeOf("function"));
    const module = window.Module as Record<string, unknown> & typeof window.Module;
    // WasmFS's calls into the file system abort before the runtime is up, so Emscripten must not run main()
    expect(module!.noInitialRun).toBe(true);
    expect(module).not.toHaveProperty("preRun");
    const callMain = vi.fn();
    module!.callMain = callMain;
    const staged = new Map<string, Uint8Array>();
    module!.FS = testFs(staged);
    module!.cwrap = (() => () => 0) as never;
    module!.onRuntimeInitialized!();
    const handle = await startup;
    expect(callMain).toHaveBeenCalledWith(["--run", "--game", "/game"]);
    expect(staged.get("/game/gamemd.exe")).toEqual(runtimeExe);
    expect(staged.get("/game/Blowfish.dll")).toEqual(runtimeBlowfish);
    expect(handle.saves).toBeNull();
  });
  it("says the game isn't built when there is no ra2.js", async () => {
    vi.stubGlobal("fetch", () => answer(true, "text/html"));
    const store = new GameStore();
    await expect(startGame({ files: { kind: "already-there" }, store })).rejects.toBeInstanceOf(
      GameNotBuilt,
    );
    expect(store.getSnapshot().phase).toBe("loading"); // begin() ran; Play shows the not-built message itself
  });
});

describe("video size", () => {
  it("reads ?video=WxH, and nothing else", () => {
    expect(videoFromQuery("?video=1280x720")).toEqual({ w: 1280, h: 720 });
    expect(videoFromQuery("?stats&video=800x600&arg=x")).toEqual({ w: 800, h: 600 });
    expect(videoFromQuery("?video=big")).toBeNull();
    expect(videoFromQuery("")).toBeNull();
  });

  it("sets the two keys in [Video] and leaves the file's other lines and endings", () => {
    const ini =
      "[Options]\r\nScreenWidth=1\r\n[Video]\r\nScreenWidth=2580\r\nScreenHeight=1080\r\nWindowed=no\r\n";
    expect(withVideoSize(ini, { w: 800, h: 600 })).toBe(
      "[Options]\r\nScreenWidth=1\r\n[Video]\r\nScreenWidth=800\r\nScreenHeight=600\r\nWindowed=no\r\n",
    );
  });

  it("adds the keys when [Video] lacks them, or the section when there is none", () => {
    expect(withVideoSize("[Video]\nWindowed=no", { w: 1280, h: 720 })).toBe(
      "[Video]\nScreenWidth=1280\nScreenHeight=720\nWindowed=no",
    );
    expect(withVideoSize("[Audio]\nx=1", { w: 1280, h: 720 })).toBe(
      "[Audio]\nx=1\n[Video]\nScreenWidth=1280\nScreenHeight=720",
    );
  });

  it("reapplies the launcher size after a saved RA2.INI is restored", async () => {
    const fs = new Map<string, Uint8Array>([
      [
        "/game/RA2MD.INI",
        new TextEncoder().encode("[Video]\nScreenWidth=1024\nScreenHeight=768\n"),
      ],
    ]);
    const stagedFs = {
      readdir: () => ["RA2MD.INI"],
      readFile: (path: string) => fs.get(path)!,
      writeFile: (path: string, bytes: Uint8Array) => fs.set(path, bytes),
    };
    stageVideoSize(stagedFs, "ra2md", { w: 1920, h: 1080 });
    expect(new TextDecoder().decode(fs.get("/game/RA2MD.INI"))).toContain(
      "ScreenWidth=1920\nScreenHeight=1080",
    );
  });
});
