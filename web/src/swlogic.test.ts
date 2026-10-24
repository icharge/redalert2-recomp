import { describe, expect, it } from "vitest";
import {
  buildIdOf,
  gameCacheName,
  isGameBuildFile,
  shouldReloadForIsolation,
  staleGameCaches,
  withIsolation,
} from "./swlogic";

describe("isGameBuildFile", () => {
  it("matches only build assets inside its own deployment base", () => {
    expect(isGameBuildFile("/emu/game/ra2.wasm", "/emu/")).toBe(true);
    expect(isGameBuildFile("/emu/game/ra2/ra2.js", "/emu/")).toBe(true);
    expect(isGameBuildFile("/game/ra2.wasm", "/emu/")).toBe(false);
    expect(isGameBuildFile("/emulator/game/ra2.wasm", "/emu/")).toBe(false);
    expect(isGameBuildFile("/emu/game/1", "/emu/")).toBe(false);
    expect(staleGameCaches(["ra2-game-old00000", "ra2-scope-%2Femu%2F-game-old00000"], "abc12345", "/emu/")).toEqual(["ra2-scope-%2Femu%2F-game-old00000"]);
  });
  it("is the three files of a build, and nothing else of the game", () => {
    for (const name of ["ra2.js", "ra2.wasm", "ra2.data"])
      expect(isGameBuildFile(`/game/${name}`)).toBe(true);
    for (const name of ["ra2.js", "ra2.wasm", "ra2.data"])
      expect(isGameBuildFile(`/game/ra2/${name}`)).toBe(true);
    for (const name of [
      "/game/build.json",
      "/game/ra2.wasm.map",
      "/ra2.wasm",
      "/game/sub/ra2.js",
      "/game/ra2/sub/ra2.js",
      "/assets/index.js",
    ])
      expect(isGameBuildFile(name), name).toBe(false);
  });
});

describe("the build's id", () => {
  it("reads it from build.json, and takes only a hex id", () => {
    expect(buildIdOf({ games: {}, build: "48287c6ce1430abe" })).toBe("48287c6ce1430abe");
    expect(buildIdOf({ games: {} })).toBeNull();
    expect(buildIdOf({ build: "../../evil" })).toBeNull();
    expect(buildIdOf({ build: 5 })).toBeNull();
    expect(buildIdOf(null)).toBeNull();
    expect(buildIdOf("text")).toBeNull();
  });

  it("names a cache by the id, and finds the other builds' caches to drop", () => {
    expect(gameCacheName("abc12345")).toBe("ra2-game-abc12345");
    expect(
      staleGameCaches(
        ["ra2-game-old00000", "ra2-game-abc12345", "ra2-meta", "workbox-precache-v2"],
        "abc12345",
      ),
    ).toEqual(["ra2-game-old00000"]);
  });
});

describe("withIsolation", () => {
  it("adds the headers threads need and keeps the body, status and other headers", async () => {
    const wrapped = withIsolation(
      new Response("page", { status: 200, headers: { "Content-Type": "text/html" } }),
    );
    expect(wrapped.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(wrapped.headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp");
    expect(wrapped.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(wrapped.headers.get("Content-Type")).toBe("text/html");
    expect(wrapped.status).toBe(200);
    expect(await wrapped.text()).toBe("page");
  });

  it("keeps an error status, and leaves an opaque response alone", () => {
    expect(withIsolation(new Response("no", { status: 404 })).status).toBe(404);
    const opaque = { type: "opaque", status: 0 } as unknown as Response;
    expect(withIsolation(opaque)).toBe(opaque);
  });
});

describe("shouldReloadForIsolation", () => {
  it("reloads once, when a worker is in charge and the page was loaded without the headers", () => {
    expect(shouldReloadForIsolation(false, false, true)).toBe(true);
    expect(shouldReloadForIsolation(true, false, true)).toBe(false);
    expect(shouldReloadForIsolation(false, true, true)).toBe(false);
    expect(shouldReloadForIsolation(false, false, false)).toBe(false);
  });
});
