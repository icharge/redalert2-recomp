import { describe, expect, it } from "vitest";
import { liveBytes, liveViews } from "./memory-views";

describe("liveViews", () => {
  it("refreshes views a grown memory left stale before handing them out", () => {
    const small = new SharedArrayBuffer(16);
    const grown = new SharedArrayBuffer(64);
    const module = { HEAPU8: new Uint8Array(small), HEAP32: new Int32Array(small) };
    const refresh = () => {
      module.HEAPU8 = new Uint8Array(grown);
      module.HEAP32 = new Int32Array(grown);
    };
    const views = liveViews(module, refresh);
    expect(views.HEAPU8.length).toBe(64);
    expect(views.HEAP32.buffer).toBe(grown);
  });

  it("uses the views as they are when there is nothing to refresh them with", () => {
    const buffer = new SharedArrayBuffer(16);
    const module = { HEAPU8: new Uint8Array(buffer), HEAP32: new Int32Array(buffer) };
    expect(liveViews(module, undefined).HEAPU8).toBe(module.HEAPU8);
  });

  it("throws before the memory is up", () => {
    expect(() => liveViews({}, () => {})).toThrow("the game's memory is not up yet");
  });
});

describe("liveBytes", () => {
  it("needs only the byte view, refreshed", () => {
    const grown = new SharedArrayBuffer(64);
    const module: { HEAPU8?: Uint8Array } = { HEAPU8: new Uint8Array(16) };
    const bytes = liveBytes(module, () => {
      module.HEAPU8 = new Uint8Array(grown);
    });
    expect(bytes.buffer).toBe(grown);
  });
});
