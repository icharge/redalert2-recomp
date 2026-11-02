// Checks the import record against the actual OPFS copy. The record is a catalog, not the bytes:
// a browser can drop storage, a write can be interrupted, or a player can replace a file from the
// file manager. This makes the record's done flags follow what is really there, so Browse files and
// Resume import agree.

import type { Manifest } from "./manifest";
import { gamePath, type CopyTarget } from "./opfs";

export interface ReconcileResult {
  slot: number;
  /** files the record listed as copied but OPFS no longer has whole */
  missing: string[];
  /** files OPFS has whole that the record had not marked copied */
  restored: string[];
}

/** Measures an installation's copied files, marking the record to match OPFS. */
export async function reconcileInstallation(
  manifest: Manifest,
  target: Pick<CopyTarget, "size">,
  slot: number,
): Promise<ReconcileResult> {
  const games = await manifest.listGames(slot);
  const missing: string[] = [];
  const restored: string[] = [];
  for (const game of games) {
    const statuses: { name: string; done: boolean }[] = [];
    for (const [name, entry] of Object.entries(game.files)) {
      const actual = await target.size(gamePath(entry.home, name));
      const done = actual === entry.size;
      if (done === entry.done) continue;
      statuses.push({ name, done });
      (done ? restored : missing).push(name);
    }
    if (statuses.length) await manifest.setFileStatuses(game.id, statuses, slot);
  }
  return { slot, missing, restored };
}
