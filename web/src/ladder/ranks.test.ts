import { describe, expect, it } from "vitest";
import { chevrons, rankTitle, RANK_TITLES } from "./ranks";

describe("ranks", () => {
  it("names the ten badges and an unranked player", () => {
    expect(RANK_TITLES).toHaveLength(10);
    expect(rankTitle(0)).toBe("Private");
    expect(rankTitle(2)).toBe("Sergeant");
    expect(rankTitle(9)).toBe("Commander-in-Chief");
    expect(rankTitle(null)).toBe("Unranked");
  });

  it("clamps a badge the table does not know", () => {
    expect(rankTitle(42)).toBe("Commander-in-Chief");
    expect(rankTitle(-1)).toBe("Private");
  });

  it("draws more chevrons for higher badges", () => {
    expect(chevrons(null)).toBe(0);
    expect(chevrons(0)).toBe(1);
    expect(chevrons(3)).toBe(2);
    expect(chevrons(9)).toBe(3);
  });
});
