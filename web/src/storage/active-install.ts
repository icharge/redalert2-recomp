import type { GameId } from "./install";
import type { GameRecord, InstallationRecord } from "./manifest";

/** The one installation the launcher shows, with its editions in the order RA2, YR (docs/web/frontend.md). */
export interface ActiveInstall {
  installation: InstallationRecord;
  editions: GameRecord[];
}

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem">;

const ACTIVE_SLOT = "ra2-active-slot";
const EDITION_ORDER: GameId[] = ["ra2", "ra2md"];

function editionsOf(slot: number, games: GameRecord[]): GameRecord[] {
  return games
    .filter((game) => game.slot === slot)
    .sort((a, b) => EDITION_ORDER.indexOf(a.id) - EDITION_ORDER.indexOf(b.id));
}

/** The remembered slot if it still exists, else the lowest slot with a complete game, else the lowest slot. */
export function pickActiveInstall(
  installations: InstallationRecord[],
  games: GameRecord[],
  remembered: number | null,
): ActiveInstall | null {
  const bySlot = [...installations].sort((a, b) => a.slot - b.slot);
  const installation =
    bySlot.find((each) => each.slot === remembered) ??
    bySlot.find((each) => games.some((game) => game.slot === each.slot && game.complete)) ??
    bySlot[0];
  return installation ? { installation, editions: editionsOf(installation.slot, games) } : null;
}

/** The remembered edition if the install has it, else Yuri's Revenge, else the first. */
export function pickEdition(editions: GameRecord[], remembered: string | null): GameRecord | null {
  return (
    editions.find((game) => game.id === remembered) ??
    editions.find((game) => game.id === "ra2md") ??
    editions[0] ??
    null
  );
}

function read(key: string, storage: Reader): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string, storage: Writer) {
  try {
    storage.setItem(key, value);
  } catch {
    // the choice then lasts until the page closes
  }
}

export function readActiveSlot(storage: Reader = localStorage): number | null {
  const value = read(ACTIVE_SLOT, storage);
  return value && /^[1-9]\d*$/.test(value) ? Number(value) : null;
}

export function writeActiveSlot(slot: number, storage: Writer = localStorage) {
  write(ACTIVE_SLOT, String(slot), storage);
}

export function readRememberedEdition(slot: number, storage: Reader = localStorage): string | null {
  return read(`ra2-edition:${slot}`, storage);
}

export function writeRememberedEdition(slot: number, id: GameId, storage: Writer = localStorage) {
  write(`ra2-edition:${slot}`, id, storage);
}
