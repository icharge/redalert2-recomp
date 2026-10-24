import { afterEach, describe, expect, it, vi } from "vitest";
import {
  argsFromQuery,
  GAME_SCRIPT,
  gameScript,
  GameNotBuilt,
  gameArguments,
  isBuilt,
  readBody,
  startGame,
  videoFromQuery,
  withVideoSize,
} from "./loader";
import { GameStore } from "./store";

const answer = (ok: boolean, type: string) =>
  Promise.resolve({ ok, headers: new Headers({ "content-type": type }) } as Response);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("arguments", () => {
  it("starts the game from /game, with whatever arg= says", () => {
    expect(gameArguments()).toEqual(["--run", "--game", "/game"]);
    expect(gameArguments(["--hd-voxels"])).toEqual(["--run", "--game", "/game", "--hd-voxels"]);
    expect(gameArguments([], { enabled: true, fontId: "Tahoma-Th-1f" })).toEqual([
      "--run", "--game", "/game", "--thai-font-fix", "--thai-font-id", "Tahoma-Th-1f",
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

describe("isBuilt", () => {
  it("loads both runtimes under the configured context path", async () => {
    vi.stubEnv("BASE_URL", "/emu/");
    const fetcher = vi.fn(() => answer(true, "text/javascript"));
    expect(await isBuilt(fetcher as unknown as typeof fetch, "ra2md")).toBe(true);
    expect(fetcher).toHaveBeenLastCalledWith("/emu/game/ra2.js", { method: "HEAD" });
    expect(gameScript("ra2")).toBe("/emu/game/ra2/ra2.js");
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
    expect(gameScript("ra2")).toBe("/game/ra2/ra2.js");
    expect(await isBuilt(fetcher as unknown as typeof fetch, "ra2")).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("/game/ra2/ra2.js", { method: "HEAD" });
    expect(new GameNotBuilt("ra2").message).toContain("RA2_TARGET=game");
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
  it("rejects an aborted startup so leaving the page cannot wait forever", async () => {
    vi.stubGlobal("fetch", () => answer(true, "text/javascript"));
    const outcome = startGame({ files: { kind: "already-there" }, store: new GameStore() }).then(
      () => "resolved", (error: Error) => error.message);
    await vi.waitFor(() => expect(window.Module?.onAbort).toBeTypeOf("function"));
    window.Module!.onAbort!("bad wasm");
    expect(await Promise.race([outcome, new Promise((resolve) => setTimeout(() => resolve("still pending"), 100))])).toContain("bad wasm");
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
});
