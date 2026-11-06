import { describe, expect, it } from "vitest";
import { EDITION_BRAND, LOGO_SRC } from "./brand";

describe("EDITION_BRAND", () => {
  it("names each edition", () => {
    expect(EDITION_BRAND.ra2.title).toBe("Red Alert 2");
    expect(EDITION_BRAND.ra2md.title).toBe("Yuri’s Revenge");
  });

  it("marks only Yuri's Revenge as the expansion", () => {
    expect(EDITION_BRAND.ra2md.kicker).toBe("EXPANSION");
    expect(EDITION_BRAND.ra2.kicker).toBeNull();
  });

  it("points at the brand images", () => {
    expect(EDITION_BRAND.ra2.icon).toBe("brand/ra2-icon.png");
    expect(EDITION_BRAND.ra2md.background).toBe("brand/bg-yr.webp");
    expect(LOGO_SRC).toBe("brand/yurinet.png");
  });
});
