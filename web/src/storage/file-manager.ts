// The Library's file browser, with adding, replacing and deleting (docs/web/storage.md, "Managing files").
//
// It is for a whole installation, not one edition: both games' files are in one place (`game/slot-N/`),
// a file both read is stored once, and a file the player adds goes to every edition that reads it.
// Two places show up in it:
//   - the imported files: what the game loads at start, listed in each edition's record in the manifest
//     and kept in OPFS under `game/<home>/`;
//   - `Saves/`: what a game itself wrote since (saved games, `RA2MD.INI`), kept in OPFS under
//     `save/<storage>/` and laid back over the imported files at every start (saves.ts). It is one folder
//     per edition when the installation has more than one.
// A file in `Saves/` wins over the imported one of the same name, so a change to an imported file also
// clears that name from `Saves/`, or the player's change would be hidden.

import {
  assertTextFile,
  completedFiles,
  listChildren,
  readAsText,
  safeParts,
  type BrowseEntry,
  type ReadOnlyFileSource,
  type UploadReport,
} from "./file-browser";
import { classify, type BuildInfo, type GameId } from "./install";
import type { FileEntry, GameRecord, Manifest } from "./manifest";
import { gamePath, readGameFile, removeFiles, type CopyTarget } from "./opfs";
import { isSavePath, type SavedFile, type SaveStore } from "./saves";

/** The folder at the top of the browser that holds what the games have saved. */
export const SAVES_DIR = "Saves";

export interface ManagerDeps {
  manifest: Manifest;
  target: CopyTarget;
  saves: SaveStore;
  /** the games this build can run, for adding another edition from its game data */
  build: BuildInfo;
  /** the records changed: the Library shows their size, file count and editions */
  onChange?(): void;
}

const lower = (text: string) => text.toLowerCase();

/** Everything a game wrote that the player may see: not mod copies, not the host's own files. */
async function writtenFiles(deps: ManagerDeps, record: GameRecord): Promise<SavedFile[]> {
  return (await deps.saves.list(record.storage)).filter(
    (file) => !file.path.startsWith("mods/") && !file.path.startsWith(".host/"),
  );
}

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The files of an installation, one list for all its editions. */
export function managedInstallationSource(
  title: string,
  slot: number,
  initial: GameRecord[],
  deps: ManagerDeps,
): ReadOnlyFileSource {
  let records = [...initial].sort((a, b) => a.id.localeCompare(b.id));
  const savePath = (record: GameRecord, path: string) => `save/${record.storage}/${path}`;
  const insideSaves = (parts: string[]) => lower(parts[0] ?? "") === lower(SAVES_DIR);

  async function reload() {
    records = (await deps.manifest.listGames(slot)).sort((a, b) => a.id.localeCompare(b.id));
    deps.onChange?.();
  }

  /** every imported file of every edition, once per name */
  function importedUnion(): { name: string; entry: FileEntry }[] {
    const union = new Map<string, FileEntry>();
    for (const record of records)
      for (const [name, entry] of completedFiles(record))
        if (!union.has(name)) union.set(name, entry);
    return [...union].map(([name, entry]) => ({ name, entry }));
  }

  /**
   * Where a path under `Saves/` is: the edition's record and the path inside its saves. With one edition
   * `Saves/` is that edition's; with more there is a folder for each, named like the game.
   */
  function savesPlace(parts: string[]): "editions" | { record: GameRecord; inner: string } | null {
    if (records.length === 1) return { record: records[0]!, inner: parts.slice(1).join("/") };
    if (parts.length === 1) return "editions";
    const record = records.find((entry) => lower(entry.title) === lower(parts[1] ?? ""));
    return record ? { record, inner: parts.slice(2).join("/") } : null;
  }

  /** the saved copies of these imported names, which would hide a change to the imported file */
  async function clearHiding(record: GameRecord, names: string[]): Promise<string[]> {
    const wanted = new Set(names.map(lower));
    const hiding = (await writtenFiles(deps, record)).filter((file) =>
      wanted.has(lower(file.path)),
    );
    for (const file of hiding) await deps.target.remove(savePath(record, file.path));
    return hiding.length
      ? [
          `Cleared ${record.title}'s own copy of ${hiding.map((file) => file.path).join(", ")} ` +
            "(its saved settings), which would have hidden the change.",
        ]
      : [];
  }

  async function uploadToSaves(
    record: GameRecord,
    folder: string,
    files: File[],
  ): Promise<UploadReport> {
    const report: UploadReport = { added: [], replaced: [], problems: [], notes: [] };
    const existing = await writtenFiles(deps, record);
    for (const file of files) {
      const name = file.name;
      if (folder !== "") {
        report.problems.push(`${name}: saved games go in the top of ${record.title}'s folder.`);
      } else if (!/^[^/\\\0]+\.sav$/i.test(name)) {
        report.problems.push(`${name}: only .sav files can be added to ${SAVES_DIR}.`);
      } else {
        const same = existing.find((entry) => lower(entry.path) === lower(name));
        const path = same?.path ?? name;
        try {
          await deps.target.write(savePath(record, path), file.stream());
          if ((await deps.target.size(savePath(record, path))) !== file.size)
            throw new Error("it changed while it was copied. Try again");
          (same ? report.replaced : report.added).push(path);
        } catch (error) {
          report.problems.push(`${name}: ${failure(error)}.`);
        }
      }
    }
    return report;
  }

  /** The file is for an edition this installation lacks: add the edition, sharing the files it reads. */
  async function addEdition(
    id: GameId,
    key: string,
    file: File,
    needs: GameId[],
    report: UploadReport,
  ) {
    const game = deps.build.games[id];
    if (!game) throw new Error("this build cannot run that game");
    const home = `slot-${slot}`;
    await deps.target.write(gamePath(home, key), file.stream());
    if ((await deps.target.size(gamePath(home, key))) !== file.size)
      throw new Error("it changed while it was copied. Try again");
    const files: Record<string, FileEntry> = {};
    for (const record of records)
      for (const [name, entry] of Object.entries(record.files))
        if (entry.done && entry.needs.includes(id) && !files[name]) files[name] = { ...entry };
    files[key] = { size: file.size, lastModified: file.lastModified, done: true, needs, home };
    await deps.manifest.addEdition(slot, id, game.title, game.stamp, files);
    report.added.push(key);
    report.notes.push(
      `Added ${game.title} to this installation. It shares the game data already here.`,
    );
    if (id === "ra2md" && !Object.keys(files).some((name) => lower(name) === "rulesmd.ini"))
      report.notes.push(
        "Yuri's Revenge also needs edition-specific game data, including rulesmd.ini and expandmd01.mix.",
      );
  }

  async function uploadImported(folder: string[], files: File[]): Promise<UploadReport> {
    const report: UploadReport = { added: [], replaced: [], problems: [], notes: [] };
    for (const file of files) {
      const name = file.name;
      if (!name || /[/\\\0]/.test(name) || name === "." || name === "..") {
        report.problems.push(`${name || "(no name)"}: not a usable file name.`);
        continue;
      }
      const wanted = [...folder, name].join("/");
      const kind = classify(wanted);
      if (!kind) {
        report.problems.push(`${name}: the game does not read a file like this from here.`);
        continue;
      }
      if (kind.kind === "save" || isSavePath(wanted)) {
        report.problems.push(`${name}: saved games go in the ${SAVES_DIR} folder.`);
        continue;
      }
      const editions = records.filter((record) => kind.needs.includes(record.id));
      let adding: GameId | null = null;
      if (!editions.length) {
        adding =
          kind.needs.find(
            (id) => deps.build.games[id] && !records.some((record) => record.id === id),
          ) ?? null;
        if (!adding) {
          report.problems.push(`${name}: no game in this installation reads it.`);
          continue;
        }
      }
      try {
        const existing = records.flatMap((record) => {
          const key = Object.keys(record.files).find((entry) => lower(entry) === lower(wanted));
          return key ? [{ record, key, entry: record.files[key]! }] : [];
        });
        if (adding) {
          await addEdition(adding, existing[0]?.key ?? wanted, file, kind.needs, report);
        } else {
          const key = existing[0]?.key ?? wanted;
          const targets = records.flatMap((record) => {
            const had = existing.find((entry) => entry.record === record);
            if (had) return [{ record, key: had.key, entry: had.entry as FileEntry | undefined }];
            return kind.needs.includes(record.id)
              ? [{ record, key, entry: undefined as FileEntry | undefined }]
              : [];
          });
          // each place the file is kept gets it once, however many editions list it there
          const written = new Set<string>();
          for (const target of targets) {
            const home = target.entry?.home ?? `slot-${slot}`;
            const path = gamePath(home, target.key);
            if (written.has(path)) continue;
            written.add(path);
            await deps.target.write(path, file.stream());
            if ((await deps.target.size(path)) !== file.size)
              throw new Error("it changed while it was copied. Try again");
          }
          for (const target of targets) {
            const entry: FileEntry = {
              size: file.size,
              lastModified: file.lastModified,
              done: true,
              needs: target.entry?.needs ?? kind.needs,
              home: target.entry?.home ?? `slot-${slot}`,
            };
            await deps.manifest.putFiles(slot, [{ id: target.record.id, name: target.key, entry }]);
          }
          (existing.length ? report.replaced : report.added).push(key);
          for (const target of targets)
            report.notes.push(...(await clearHiding(target.record, [target.key])));
        }
      } catch (error) {
        report.problems.push(`${name}: ${failure(error)}.`);
      }
      await reload();
    }
    return report;
  }

  return {
    label: `${title} — files`,
    rootLabel: `${title} (files)`,
    async list(path) {
      const parts = safeParts(path);
      if (insideSaves(parts)) {
        const place = savesPlace(parts);
        if (!place) return [];
        if (place === "editions")
          return records.map((record): BrowseEntry => ({
            name: record.title,
            type: "folder",
            locked: true,
          }));
        return listChildren(
          (await writtenFiles(deps, place.record)).map((file) => ({
            name: file.path,
            ...(file.size === undefined ? {} : { size: file.size }),
            ...(file.modified === undefined ? {} : { modified: file.modified }),
          })),
          place.inner,
        );
      }
      const entries = listChildren(
        importedUnion().map(({ name, entry }) => ({
          name,
          size: entry.size,
          modified: entry.lastModified,
        })),
        path,
      );
      if (parts.length > 0) return entries;
      const withoutSaves = entries.filter((entry) => lower(entry.name) !== lower(SAVES_DIR));
      return [...withoutSaves, { name: SAVES_DIR, type: "folder", locked: true }];
    },
    async readText(path) {
      const parts = safeParts(path);
      if (insideSaves(parts)) {
        const place = savesPlace(parts);
        if (!place || place === "editions" || !place.inner)
          throw new Error("That is not a file in the games' saves.");
        const found = (await writtenFiles(deps, place.record)).find(
          (file) => file.path === place.inner,
        );
        if (!found) throw new Error("That file is not in the game's saves.");
        assertTextFile(place.inner, found.size ?? 0);
        return readAsText(place.inner, await found.read());
      }
      const found = importedUnion().find(({ name }) => name === path);
      if (!found) throw new Error("That file is not in this game's completed import.");
      assertTextFile(found.name, found.entry.size);
      return readAsText(found.name, await readGameFile(found.entry.home, found.name));
    },
    manage: {
      async clashes(folder, names) {
        const parts = safeParts(folder);
        let taken: string[];
        let prefix: string;
        if (insideSaves(parts)) {
          const place = savesPlace(parts);
          if (!place || place === "editions") return [];
          taken = (await writtenFiles(deps, place.record)).map((file) => file.path);
          prefix = place.inner;
        } else {
          taken = importedUnion().map(({ name }) => name);
          prefix = parts.join("/");
        }
        const inFolder = new Set(
          taken
            .filter((name) => (prefix ? name.startsWith(`${prefix}/`) : !name.includes("/")))
            .map((name) => lower(name.slice(prefix ? prefix.length + 1 : 0))),
        );
        return names.filter((name) => inFolder.has(lower(name)));
      },
      async upload(folder, files) {
        const parts = safeParts(folder);
        if (!insideSaves(parts)) return uploadImported(parts, files);
        const place = savesPlace(parts);
        if (!place || place === "editions")
          return {
            added: [],
            replaced: [],
            problems: files.map(
              (file) =>
                `${file.name}: open a game's folder in ${SAVES_DIR} to add its saved games.`,
            ),
            notes: [],
          };
        return uploadToSaves(place.record, place.inner, files);
      },
      removeWarning(paths) {
        const names = paths.map(lower);
        const saves = lower(SAVES_DIR);
        if (names.every((name) => name === saves || name.startsWith(`${saves}/`)))
          return "Deleted saves and settings cannot be brought back.";
        return "The game may not start without files it reads. Upload a file again to put it back.";
      },
      async remove(paths) {
        const notes: string[] = [];
        const imported = new Set<string>();
        for (const path of paths) {
          const parts = safeParts(path);
          if (insideSaves(parts)) {
            const place = savesPlace(parts);
            if (!place || place === "editions" || !place.inner) continue;
            for (const file of await writtenFiles(deps, place.record))
              if (file.path === place.inner || file.path.startsWith(`${place.inner}/`))
                await deps.target.remove(savePath(place.record, file.path));
          } else {
            for (const { name } of importedUnion())
              if (name === path || name.startsWith(`${path}/`)) imported.add(name);
          }
        }
        if (imported.size) {
          const doomed = new Map<string, { home: string; name: string }>();
          for (const record of records) {
            const mine = [...imported].filter((name) => name in record.files);
            if (!mine.length) continue;
            for (const file of await deps.manifest.deleteFiles(slot, record.id, mine))
              doomed.set(`${file.home}/${file.name}`, file);
            notes.push(...(await clearHiding(record, mine)));
          }
          await removeFiles(deps.target, [...doomed.values()]);
          await reload();
        } else deps.onChange?.();
        return notes;
      },
    },
  };
}
