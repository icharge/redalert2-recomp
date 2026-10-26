import { describe, expect, it } from "vitest";
import { presenterKind } from "./choose-presenter";

describe("presenterKind", () => {
  it("selects WebGL2 by default when available", () => {
    expect(presenterKind(new URLSearchParams(""), true)).toBe("gl");
  });

  it("allows forcing the 2D presenter", () => {
    expect(presenterKind(new URLSearchParams("presenter=2d"), true)).toBe("2d");
  });

  it("uses 2D when WebGL2 is unavailable", () => {
    expect(presenterKind(new URLSearchParams(""), false)).toBe("2d");
  });
});
