import { afterEach, describe, expect, it, vi } from "vitest";
import {
  argsFromQuery,
  GAME_SCRIPT,
  GameNotBuilt,
  gameArguments,
  isBuilt,
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
