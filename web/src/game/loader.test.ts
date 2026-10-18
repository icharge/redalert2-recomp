import { afterEach, describe, expect, it, vi } from "vitest";
import {
  argsFromQuery,
  GAME_SCRIPT,
  GameNotBuilt,
  gameArguments,
  isBuilt,
  readBody,
  startGame,
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
  it("says the game isn't built when there is no ra2.js", async () => {
    vi.stubGlobal("fetch", () => answer(true, "text/html"));
    const store = new GameStore();
    await expect(startGame({ files: { kind: "already-there" }, store })).rejects.toBeInstanceOf(
      GameNotBuilt,
    );
    expect(store.getSnapshot().phase).toBe("loading"); // begin() ran; Play shows the not-built message itself
  });
});
