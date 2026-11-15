// Where each part of an install stands, for the install screen's list. Pure: it is told which files
// are in place and which one is being copied, and it reports sizes and a state per part.

import type { FileKind, ImportPlan } from "./install";

export type PartId = "game" | "movies" | "mods" | "maps" | "saves" | "settings";

export interface PartProgress {
  id: PartId;
  label: string;
  bytes: number;
  doneBytes: number;
  state: "done" | "copying" | "waiting";
}

const ORDER: { id: PartId; label: string }[] = [
  { id: "game", label: "Game content" },
  { id: "movies", label: "Movies" },
  { id: "mods", label: "Mods" },
  { id: "maps", label: "Custom maps" },
  { id: "saves", label: "Saved games" },
  { id: "settings", label: "Settings and hotkeys" },
];

const PART_OF: Record<FileKind, PartId> = {
  archive: "game",
  sound: "game",
  data: "game",
  logo: "game",
  movie: "movies",
  map: "maps",
  save: "saves",
  settings: "settings",
};

/**
 * `done`: the `plan.copy` paths in place. `current`: the file being copied now. `filesFinished`: every
 * file is in place, so the mods (brought after the files, with no progress of their own) are next.
 */
export function partProgress(
  plan: ImportPlan,
  done: ReadonlySet<string>,
  current: string | null,
  filesFinished: boolean,
): PartProgress[] {
  const files = new Map<PartId, { path: string; size: number }[]>();
  for (const file of plan.copy) {
    if (file.stub) continue;
    const id = PART_OF[file.kind];
    const list = files.get(id) ?? [];
    list.push(file);
    files.set(id, list);
  }
  const parts: PartProgress[] = [];
  for (const { id, label } of ORDER) {
    if (id === "mods") {
      const mods = plan.bringMods ? plan.mods.filter((mod) => !mod.problem) : [];
      if (mods.length === 0) continue;
      parts.push({
        id,
        label,
        bytes: mods.reduce((sum, mod) => sum + mod.bytes, 0),
        doneBytes: 0,
        state: filesFinished ? "copying" : "waiting",
      });
      continue;
    }
    const own = files.get(id);
    if (!own?.length) continue;
    const bytes = own.reduce((sum, file) => sum + file.size, 0);
    const finished = own.filter((file) => done.has(file.path));
    const doneBytes = finished.reduce((sum, file) => sum + file.size, 0);
    const state =
      finished.length === own.length
        ? "done"
        : (current !== null && own.some((file) => file.path === current)) || doneBytes > 0
          ? "copying"
          : "waiting";
    parts.push({ id, label, bytes, doneBytes, state });
  }
  return parts;
}
