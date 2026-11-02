import { describe, expect, it } from "vitest";
import {
  LAUNCHER_VIDEO_SIZES,
  launcherVideoOptions,
  nativeVideoSize,
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

const NATIVE = { w: 1920, h: 1080 };

describe("video preferences", () => {
  it("remembers a size the launcher offered, including a native size outside the catalog", () => {
    const storage = memoryStorage();
    writeVideoPreference("slot-1-ra2md", { w: 2880, h: 1800 }, storage);
    expect(readVideoPreference("slot-1-ra2md", storage, NATIVE)).toEqual({ w: 2880, h: 1800 });
  });

  it("defaults to the desktop's own size when nothing is saved", () => {
    expect(readVideoPreference("slot-1-ra2md", memoryStorage(), NATIVE)).toEqual(NATIVE);
  });

  it("keeps the game's own setting when that was chosen", () => {
    const storage = memoryStorage();
    writeVideoPreference("slot-1-ra2md", null, storage);
    expect(readVideoPreference("slot-1-ra2md", storage, NATIVE)).toBeNull();
  });

  it("falls back to the desktop's own size for sizes the game could not use", () => {
    const storage = memoryStorage();
    storage.setItem("ra2.video.slot-1-ra2md", JSON.stringify({ w: 10, h: 10 }));
    expect(readVideoPreference("slot-1-ra2md", storage, NATIVE)).toEqual(NATIVE);
    storage.setItem("ra2.video.slot-1-ra2md", "not json");
    expect(readVideoPreference("slot-1-ra2md", storage, NATIVE)).toEqual(NATIVE);
  });

  it("uses the game's setting when the desktop cannot be read", () => {
    expect(readVideoPreference("slot-1-ra2md", memoryStorage(), null)).toBeNull();
  });
});
