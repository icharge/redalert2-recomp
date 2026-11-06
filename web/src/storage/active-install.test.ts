import { describe, expect, it } from "vitest";
import type { GameId } from "./install";
import type { GameRecord, InstallationRecord } from "./manifest";
import {
  pickActiveInstall,
  pickEdition,
  readActiveSlot,
  readRememberedEdition,
  writeActiveSlot,
  writeRememberedEdition,
} from "./active-install";

const inst = (slot: number): InstallationRecord => ({
  slot,
  name: `Game ${slot}`,
  importedAt: slot,
});
const g = (slot: number, id: GameId, extra: Partial<GameRecord> = {}): GameRecord => ({
  id,
  slot,
  storage: `${id}-${slot}`,
  title: id,
  exeStamp: 0,
  importedAt: 0,
  bytes: 0,
  complete: true,
  files: {},
  ...extra,
});

function memory(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe("pickActiveInstall", () => {
  it("uses the remembered slot", () =>
    expect(
      pickActiveInstall([inst(1), inst(2)], [g(1, "ra2md"), g(2, "ra2")], 2)?.installation.slot,
    ).toBe(2));
  it("ignores a remembered slot that is gone", () =>
    expect(pickActiveInstall([inst(1)], [g(1, "ra2md")], 5)?.installation.slot).toBe(1));
  it("prefers the lowest slot with a complete game", () =>
    expect(
      pickActiveInstall([inst(1), inst(2)], [g(1, "ra2md", { complete: false }), g(2, "ra2")], null)
        ?.installation.slot,
    ).toBe(2));
  it("falls back to the lowest slot when none is complete", () =>
    expect(
      pickActiveInstall([inst(2), inst(1)], [g(1, "ra2", { complete: false })], null)?.installation
        .slot,
    ).toBe(1));
  it("returns null with no installations", () =>
    expect(pickActiveInstall([], [], null)).toBeNull());
  it("orders editions RA2 then YR", () =>
    expect(
      pickActiveInstall([inst(1)], [g(1, "ra2md"), g(1, "ra2")], null)?.editions.map((e) => e.id),
    ).toEqual(["ra2", "ra2md"]));
  it("keeps only the slot's own editions", () =>
    expect(
      pickActiveInstall([inst(1), inst(2)], [g(1, "ra2"), g(2, "ra2md")], 1)?.editions.map(
        (e) => e.slot,
      ),
    ).toEqual([1]));
});

describe("pickEdition", () => {
  it("falls back to YR, then to the first", () => {
    expect(pickEdition([g(1, "ra2"), g(1, "ra2md")], null)?.id).toBe("ra2md");
    expect(pickEdition([g(1, "ra2")], "ra2md")?.id).toBe("ra2");
  });
  it("uses the remembered edition", () =>
    expect(pickEdition([g(1, "ra2"), g(1, "ra2md")], "ra2")?.id).toBe("ra2"));
  it("returns null with no editions", () => expect(pickEdition([], "ra2")).toBeNull());
});

describe("remembered choices", () => {
  it("round-trips the active slot", () => {
    const storage = memory();
    expect(readActiveSlot(storage)).toBeNull();
    writeActiveSlot(3, storage);
    expect(storage.getItem("ra2-active-slot")).toBe("3");
    expect(readActiveSlot(storage)).toBe(3);
  });
  it("ignores a bad active slot", () => {
    const storage = memory();
    storage.setItem("ra2-active-slot", "x");
    expect(readActiveSlot(storage)).toBeNull();
  });
  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readActiveSlot(broken)).toBeNull();
    expect(() => writeActiveSlot(1, broken)).not.toThrow();
    expect(readRememberedEdition(1, broken)).toBeNull();
  });
  it("keeps the edition per slot under ra2-edition:<slot>", () => {
    const storage = memory();
    writeRememberedEdition(2, "ra2", storage);
    expect(storage.getItem("ra2-edition:2")).toBe("ra2");
    expect(readRememberedEdition(2, storage)).toBe("ra2");
  });
});
