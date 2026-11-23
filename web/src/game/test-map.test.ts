import { describe, expect, it } from "vitest";
import {
  TEST_MAP_DIRECTORY,
  stageTestMap,
  testMapArguments,
  testMapRequest,
  testMapReturnUrl,
} from "./test-map";

function folder(files: Record<string, string>) {
  return {
    kind: "directory",
    async *entries() {
      for (const [name, text] of Object.entries(files))
        yield [
          name,
          { kind: "file", getFile: async () => new Blob([text]) } as unknown as FileSystemHandle,
        ] as [string, FileSystemHandle];
    },
  };
}

function root(files: Record<string, string> | null) {
  return {
    async getDirectoryHandle(name: string) {
      if (name !== TEST_MAP_DIRECTORY || !files) throw new DOMException("missing", "NotFoundError");
      return folder(files);
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe("FA2EX Test Map", () => {
  it("is a Test Map launch only with ?testmap=1", () => {
    expect(testMapRequest("?testmap=1&edition=ra2md&return=%2Ffa2%2F")).toEqual({
      returnTo: "/fa2/",
    });
    expect(testMapRequest("?edition=ra2md")).toBeNull();
  });

  it("goes back only to a path on this origin", () => {
    const home = "/emu/";
    expect(testMapRequest("?testmap=1&return=https%3A%2F%2Fevil.example", home)?.returnTo).toBe(
      home,
    );
    expect(testMapRequest("?testmap=1&return=%2F%2Fevil.example", home)?.returnTo).toBe(home);
    expect(testMapRequest("?testmap=1&return=%2F%5Cevil.example", home)?.returnTo).toBe(home);
    expect(testMapRequest("?testmap=1", home)?.returnTo).toBe(home);
  });

  it("tells the editor how the test went", () => {
    expect(testMapReturnUrl({ returnTo: "/fa2/" }, "done")).toBe("/fa2/?testmap=done");
    expect(testMapReturnUrl({ returnTo: "/fa2/?tab=2#map" }, "failed")).toBe(
      "/fa2/?tab=2&testmap=failed#map",
    );
  });

  it("passes the settings file to the game", () => {
    expect(testMapArguments()).toEqual(["--test-map", "/game/fa2ex-test.ini"]);
  });

  it("copies FA2EX's files into /game", async () => {
    const written: Record<string, string> = {};
    const fs = {
      writeFile: (path: string, data: Uint8Array) => {
        written[path] = new TextDecoder().decode(data);
      },
    };
    const names = await stageTestMap(
      fs,
      root({ "fa2ex-test.yrm": "[Basic]", "fa2ex-test.ini": "[Settings]" }),
    );
    expect(names.sort()).toEqual(["fa2ex-test.ini", "fa2ex-test.yrm"]);
    expect(written).toEqual({
      "/game/fa2ex-test.yrm": "[Basic]",
      "/game/fa2ex-test.ini": "[Settings]",
    });
  });

  it("explains a missing hand-off", async () => {
    const fs = { writeFile: () => {} };
    await expect(stageTestMap(fs, root(null))).rejects.toThrow(/did not leave a map/);
    await expect(stageTestMap(fs, root({ "fa2ex-test.yrm": "x" }))).rejects.toThrow(
      /settings are missing/,
    );
  });
});
