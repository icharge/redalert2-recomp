import { describe, expect, it, vi } from "vitest";
import {
  editionStrings,
  expandLauncherText,
  launcherExtras,
  parseLauncherStrings,
  readLauncherStrings,
  validateLauncherStrings,
} from "./launcher-strings";
import shippedStrings from "../../public/strings.json?raw";

describe("validateLauncherStrings", () => {
  it("accepts the shipped shape and normalizes labels", () => {
    const value = validateLauncherStrings({
      version: 1,
      ra2: { strings: { "gui:exitgame": "Exit to Launcher" } },
      ra2md: { encoding: "windows-874", inject: true, strings: { "GUI:ExitGame": "ออกเกม" } },
    });
    expect(value.editions.ra2?.strings).toEqual({ "GUI:EXITGAME": "Exit to Launcher" });
    expect(value.editions.ra2md?.encoding).toBe("windows-874");
    expect(value.editions.ra2md?.inject).toBe(true);
  });

  it("rejects a bad version, encoding, value, label, or extra", () => {
    expect(() => validateLauncherStrings({ version: 2 })).toThrow(/version/);
    expect(() => validateLauncherStrings({ ra2: { encoding: "utf-8" } })).toThrow(/encoding/);
    expect(() => validateLauncherStrings({ ra2: { strings: { "GUI:X": 1 } } })).toThrow(/text/);
    expect(() => validateLauncherStrings({ ra2: { strings: { "GUI:é": "x" } } })).toThrow(/ASCII/);
    expect(() => validateLauncherStrings({ ra2: { extra: { "GUI:X": "f" } } })).toThrow(/hex/);
    expect(() => validateLauncherStrings(null)).toThrow(/object/);
  });

  it("ignores editions it does not know", () => {
    const value = validateLauncherStrings({ ra2: {}, "tiberian-sun": { strings: {} } });
    expect(Object.keys(value.editions)).toEqual(["ra2"]);
  });
});

describe("parseLauncherStrings", () => {
  it("round-trips the Exit Game override", () => {
    const value = parseLauncherStrings(
      '{"version":1,"ra2md":{"strings":{"GUI:ExitGame":"Exit to Launcher"}}}',
    );
    expect(value.editions.ra2md?.strings).toEqual({ "GUI:EXITGAME": "Exit to Launcher" });
  });

  it("reports invalid JSON and an oversized file", () => {
    expect(() => parseLauncherStrings("{")).toThrow(/valid JSON/);
    expect(() => parseLauncherStrings("x".repeat(256 * 1024 + 1))).toThrow(/256 KiB/);
  });
});

describe("readLauncherStrings", () => {
  it("fetches and parses strings.json", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('{"version":1,"ra2":{"strings":{"GUI:ExitGame":"Exit to Launcher"}}}'),
    );
    const value = await readLauncherStrings(fetcher as unknown as typeof fetch, "/strings.json");
    expect(fetcher).toHaveBeenCalledWith("/strings.json", { cache: "no-cache" });
    expect(editionStrings(value, "ra2")?.strings).toEqual({
      "GUI:EXITGAME": "Exit to Launcher",
    });
  });

  it("treats a missing file as no overrides", async () => {
    const value = await readLauncherStrings(
      (async () => new Response("", { status: 404 })) as typeof fetch,
      "/strings.json",
    );
    expect(value.editions).toEqual({});
  });

  it("rejects a server error", async () => {
    await expect(
      readLauncherStrings(
        (async () => new Response("", { status: 500 })) as typeof fetch,
        "/strings.json",
      ),
    ).rejects.toThrow(/500/);
  });
});

describe("edition helpers", () => {
  it("selects an edition and converts extra hex to bytes", () => {
    const value = validateLauncherStrings({
      ra2: { extra: { "VOX:X": "00ff10" } },
    });
    const edition = editionStrings(value, "ra2");
    expect(edition).not.toBeNull();
    const extras = launcherExtras(edition!);
    expect(Object.keys(extras)).toEqual(["VOX:X"]);
    expect(Array.from(extras["VOX:X"] ?? [])).toEqual([0, 255, 16]);
    expect(editionStrings(value, "ra2md")).toBeNull();
  });
});

describe("expandLauncherText", () => {
  it("fills {version} and leaves other braces alone", () => {
    expect(
      expandLauncherText(
        { "GUI:VERSION": "YN {version} /", "TXT:OTHER": "{name} and {version}{version}" },
        { version: "0.1.0" },
      ),
    ).toEqual({ "GUI:VERSION": "YN 0.1.0 /", "TXT:OTHER": "{name} and 0.1.00.1.0" });
  });
});

describe("the shipped strings.json", () => {
  it("labels the main menu's version with the launcher's version, then the game's", () => {
    const value = parseLauncherStrings(shippedStrings);
    for (const game of ["ra2", "ra2md"] as const) {
      const strings = expandLauncherText(editionStrings(value, game)!.strings, {
        version: "0.1.0",
      });
      // The game appends " <its own version>" to this text: "YN 0.1.0 / 1.006".
      expect(strings["GUI:VERSION"]).toBe("YN 0.1.0 /");
    }
  });
});
