import { describe, expect, it } from "vitest";
import { checkBrowser, missingRequired } from "./features";

describe("checkBrowser", () => {
  it("passes a cross-origin isolated browser with OPFS", () => {
    const requirements = checkBrowser({
      crossOriginIsolated: true,
      SharedArrayBuffer,
      navigator: { storage: { getDirectory: () => {} } },
    });
    expect(requirements.every((r) => r.ok)).toBe(true);
    expect(missingRequired(requirements)).toEqual([]);
  });

  it("requires threads: SharedArrayBuffer and a cross-origin isolated page", () => {
    expect(
      missingRequired(checkBrowser({ crossOriginIsolated: false, SharedArrayBuffer })).map(
        (r) => r.id,
      ),
    ).toEqual(["threads"]);
    expect(missingRequired(checkBrowser({ crossOriginIsolated: true })).map((r) => r.id)).toEqual([
      "threads",
    ]);
  });

  it("does not require storage to start the game", () => {
    const requirements = checkBrowser({
      crossOriginIsolated: true,
      SharedArrayBuffer,
      navigator: {},
    });
    expect(requirements.find((r) => r.id === "storage")).toMatchObject({
      ok: false,
      required: false,
    });
    expect(missingRequired(requirements)).toEqual([]);
  });
});
