import { describe, expect, it } from "vitest";
import type { MapResult } from "../game/mapdb";
import { finderRows } from "./NativeMapFinder";

const map = (sha1: string, name: string, incomplete = false): MapResult => ({
  id: sha1,
  name,
  sha1,
  published: true,
  incomplete,
});

describe("finderRows", () => {
  it("makes one line per map: sha1, flags, name", () => {
    const rows = finderRows(
      [map("a".repeat(40), "Dustbowl", true), map("b".repeat(40), "Lake\tof\nFire")],
      new Set(["b".repeat(40)]),
    );
    expect(rows).toBe(`${"a".repeat(40)}\tu\tDustbowl\n${"b".repeat(40)}\ta\tLake of Fire`);
  });
  it("is empty for no maps", () => {
    expect(finderRows([], new Set())).toBe("");
  });
});
