import { describe, expect, it } from "vitest";
import {
  BROWSER_VIDEO_SIZE,
  LAUNCHER_VIDEO_SIZES,
  browserVideoSize,
  launcherVideoOptions,
  nativeVideoSize,
  readVideoChoice,
  readVideoPreference,
  writeVideoPreference,
} from "./video-preferences";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}

describe("nativeVideoSize", () => {
  it("scales the screen's CSS pixels by the device pixel ratio", () => {
    expect(nativeVideoSize({ width: 1280, height: 720 }, 1.5)).toEqual({ w: 1920, h: 1080 });
  });

  it("treats a missing ratio as 1 and an unreadable screen as no size", () => {
    expect(nativeVideoSize({ width: 1920, height: 1080 }, Number.NaN)).toEqual({
      w: 1920,
      h: 1080,
    });
    expect(nativeVideoSize(null, 2)).toEqual({ w: 0, h: 0 });
  });
});

describe("launcherVideoOptions", () => {
  it("marks the catalog entry that matches the desktop", () => {
    const options = launcherVideoOptions({ w: 1920, h: 1080 });
    expect(options).toHaveLength(LAUNCHER_VIDEO_SIZES.length);
    expect(options.filter((option) => option.native)).toEqual([{ w: 1920, h: 1080, native: true }]);
  });

  it("adds a desktop size the catalog lacks, in order", () => {
    const options = launcherVideoOptions({ w: 2880, h: 1800 });
    const native = options.find((option) => option.native);
    expect(native).toEqual({ w: 2880, h: 1800, native: true });
    expect(options.map(({ w, h }) => w * 10000 + h)).toEqual(
      [...options].map(({ w, h }) => w * 10000 + h).sort((a, b) => a - b),
    );
  });

  it("does not mark anything when the screen is unreadable", () => {
    expect(launcherVideoOptions({ w: 0, h: 0 }).some((option) => option.native)).toBe(false);
  });
});

describe("browserVideoSize", () => {
  it("scales the window's CSS pixels by the device pixel ratio, rounded to even", () => {
    expect(browserVideoSize({ width: 1279, height: 719 }, 1.5)).toEqual({ w: 1918, h: 1078 });
    expect(browserVideoSize({ width: 1280, height: 720 }, 2)).toEqual({ w: 2560, h: 1440 });
  });

  it("treats a missing ratio as 1, clamps the mode range, and has no size without a window", () => {
    expect(browserVideoSize({ width: 1280, height: 720 }, Number.NaN)).toEqual({
      w: 1280,
      h: 720,
    });
    expect(browserVideoSize({ width: 100, height: 100 }, 1)).toEqual({ w: 320, h: 200 });
    expect(browserVideoSize({ width: 9000, height: 9000 }, 1)).toEqual({ w: 8192, h: 8192 });
    expect(browserVideoSize(null, 2)).toEqual({ w: 0, h: 0 });
  });
});

const DEFAULT = { w: 1920, h: 1080 };

describe("video preferences", () => {
  it("remembers a size the launcher offered, including a native size outside the catalog", () => {
    const storage = memoryStorage();
    writeVideoPreference("slot-1-ra2md", { w: 2880, h: 1800 }, storage);
    expect(readVideoPreference("slot-1-ra2md", storage)).toEqual({ w: 2880, h: 1800 });
  });

  it("defaults to 1920×1080 when nothing is saved", () => {
    expect(readVideoPreference("slot-1-ra2md", memoryStorage())).toEqual(DEFAULT);
  });

  it("keeps the game's own setting when that was chosen", () => {
    const storage = memoryStorage();
    writeVideoPreference("slot-1-ra2md", null, storage);
    expect(readVideoPreference("slot-1-ra2md", storage)).toBeNull();
  });

  it("falls back to 1920×1080 for sizes the game could not use", () => {
    const storage = memoryStorage();
    storage.setItem("ra2.video.slot-1-ra2md", JSON.stringify({ w: 10, h: 10 }));
    expect(readVideoPreference("slot-1-ra2md", storage)).toEqual(DEFAULT);
    storage.setItem("ra2.video.slot-1-ra2md", "not json");
    expect(readVideoPreference("slot-1-ra2md", storage)).toEqual(DEFAULT);
  });

  it("remembers Match browser size and resolves it to the window", () => {
    const storage = memoryStorage();
    writeVideoPreference("slot-1-ra2md", BROWSER_VIDEO_SIZE, storage);
    expect(readVideoChoice("slot-1-ra2md", storage)).toBe(BROWSER_VIDEO_SIZE);
    expect(readVideoPreference("slot-1-ra2md", storage, { w: 1280, h: 720 })).toEqual({
      w: 1280,
      h: 720,
    });
  });

  it("keeps fixed sizes and Use game setting as distinct choices", () => {
    const storage = memoryStorage();
    writeVideoPreference("slot-1-ra2md", { w: 2880, h: 1800 }, storage);
    expect(readVideoChoice("slot-1-ra2md", storage)).toEqual({ w: 2880, h: 1800 });
    writeVideoPreference("slot-1-ra2md", null, storage);
    expect(readVideoChoice("slot-1-ra2md", storage)).toBeNull();
  });
});
