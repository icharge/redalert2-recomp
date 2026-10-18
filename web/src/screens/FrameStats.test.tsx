import { describe, expect, it } from "vitest";
import { describeFrameStats, frameRates, rememberStats, statsWanted } from "./FrameStats";

const totals = (pictures: number, ticks: number, drawMs: number) => ({ pictures, ticks, drawMs });

describe("frameRates", () => {
  it("divides what happened between two samples by the seconds between them", () => {
    expect(frameRates(totals(100, 200, 50), totals(160, 320, 62), 2)).toEqual({
      pictures: 30,
      ticks: 60,
      drawMs: 0.1,
    });
  });

  it("is zero, not NaN, before a second has passed or a frame has drawn", () => {
    expect(frameRates(totals(0, 0, 0), totals(0, 0, 0), 0)).toEqual({
      pictures: 0,
      ticks: 0,
      drawMs: 0,
    });
  });
});

describe("describeFrameStats", () => {
  const rates = { pictures: 59.6, ticks: 60.2, drawMs: 1.234 };

  it("says the game is in a menu when it runs no frames", () => {
    expect(describeFrameStats(rates, { fps: 0, ms: 0 }, { w: 800, h: 600 })).toEqual([
      "game: in a menu",
      "page 60 pictures/s, 60 frames/s",
      "draw 1.23 ms a frame",
      "800 x 600",
    ]);
  });

  it("gives the game's rate and frame time in a battle", () => {
    const lines = describeFrameStats(rates, { fps: 62, ms: 16 }, { w: 2580, h: 1080 });
    expect(lines[0]).toBe("game 62 fps (16 ms a frame)");
    expect(lines[3]).toBe("2580 x 1080");
  });

  it("has a line for a game with no picture yet", () => {
    expect(describeFrameStats(rates, { fps: null, ms: null }, null)[3]).toBe("no picture yet");
  });
});

describe("statsWanted", () => {
  const storage = (value: string | null) => ({ getItem: () => value });

  it("is asked for by ?stats or by the last choice", () => {
    expect(statsWanted("?stats", null)).toBe(true);
    expect(statsWanted("?stats=1&arg=x", null)).toBe(true);
    expect(statsWanted("", storage("1"))).toBe(true);
    expect(statsWanted("", storage("0"))).toBe(false);
    expect(statsWanted("", null)).toBe(false);
  });

  it("survives a storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(statsWanted("", broken)).toBe(false);
    expect(() =>
      rememberStats(true, {
        setItem: () => {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
  });
});
