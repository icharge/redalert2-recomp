import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("writes small counts in bytes and larger ones in the unit that keeps three digits", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(41.2 * 1024 * 1024)).toBe("41.2 MB");
    expect(formatBytes(412 * 1024 * 1024)).toBe("412 MB");
    expect(formatBytes(1.04 * 1024 ** 3)).toBe("1.04 GB");
  });

  it("does not fail on nonsense", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});
