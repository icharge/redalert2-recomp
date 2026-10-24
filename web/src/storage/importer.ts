// The import, from a folder the player picked to files in OPFS and a record in the manifest
// (docs/web/storage.md). Three steps: look at the folder (`prepareImport`), copy (`runImport`), and the
// folder sources that feed them. The screen (screens/Import.tsx) only shows what these report.

import {
  checkExe,
  checkSpace,
  planImport,
  type BuildInfo,
  type Check,
  type GameId,
  type ImportOptions,
  type ImportPlan,
  type SpaceCheck,
} from "./install";
import type { Manifest, PlannedFile } from "./manifest";
import { copyInstall, type CopyJob, type CopyProgress, type CopyTarget } from "./opfs";
import { EMPTY_ARCHIVE } from "./install";

/** One file of the folder the player picked. */
export interface SourceFile {
  /** relative to the folder, `/` between parts */
  path: string;
  size: number;
  lastModified: number;
  /** the first `bytes` of the file */
  head(bytes: number): Promise<Uint8Array>;
  /** the whole file, as a stream */
  stream(): ReadableStream<Uint8Array>;
}

export interface FolderSource {
  /** what the folder is called, for the screen */
  name: string;
  list(): Promise<SourceFile[]>;
}

function fromFile(path: string, file: File): SourceFile {
  return {
    path,
    size: file.size,
    lastModified: file.lastModified,
    head: async (bytes) => new Uint8Array(await file.slice(0, bytes).arrayBuffer()),
    stream: () => file.stream(),
  };
}

/** A folder from `showDirectoryPicker()`: its top level, and `Saved Games/`. Nothing else is opened. */
export function directorySource(handle: FileSystemDirectoryHandle): FolderSource {
  async function walk(dir: FileSystemDirectoryHandle, prefix: string, out: SourceFile[]) {
    // lib.dom has no iterator for a directory handle yet
    const entries = (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
    for await (const entry of entries) {
      if (entry.kind === "file") {
        out.push(fromFile(prefix + entry.name, await (entry as FileSystemFileHandle).getFile()));
      } else if (prefix === "" && entry.name.toLowerCase() === "saved games") {
        await walk(entry as FileSystemDirectoryHandle, "Saved Games/", out);
      }
    }
  }
  return {
    name: handle.name,
    async list() {
      const out: SourceFile[] = [];
      await walk(handle, "", out);
      return out;
    },
  };
}

/**
 * Files from `<input webkitdirectory>` or a drop, which carry `webkitRelativePath` ("Folder/a/b"). The
 * folder's own name is taken off the front.
 */
export function fileListSource(files: Iterable<File>): FolderSource {
  const all = [...files];
  const name = all[0]?.webkitRelativePath.split("/")[0] ?? "the folder";
  return {
    name,
    async list() {
      return all.map((file) => {
        const relative = file.webkitRelativePath.split("/").slice(1).join("/") || file.name;
        return fromFile(relative, file);
      });
    },
  };
}

function bytesStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data.slice());
      controller.close();
    },
  });
}

export interface Prepared {
  name: string;
  plan: ImportPlan;
  /** each game's exe against the lifted build: ok, or what is wrong */
  exes: Partial<Record<GameId, Check>>;
  space: SpaceCheck;
  /** the folder's files, by path, for the copy */
  files: Map<string, SourceFile>;
}

/** Looks at a folder: what would be copied, whether the exe is the right build, whether it fits. */
export async function prepareImport(
  source: FolderSource,
  build: BuildInfo,
  options: ImportOptions,
  estimate: { quota?: number; usage?: number },
): Promise<Prepared> {
  const list = await source.list();
  const files = new Map(list.map((file) => [file.path, file]));
  const plan = planImport(list, build, options);
  const exes: Prepared["exes"] = {};
  for (const id of plan.games) {
    const game = build.games[id];
    const exe = list.find((file) => file.path.toLowerCase() === game?.exe.toLowerCase());
    if (game && exe) exes[id] = checkExe(await exe.head(4096), game.stamp, game.exe);
  }
  return {
    name: source.name,
    plan,
    exes,
    space: checkSpace(estimate, plan.bytes, plan.movieBytes),
    files,
  };
}

/** Why this folder cannot be imported, or null if it can. */
export function blocker(prepared: Prepared): string | null {
  if (prepared.plan.error) return prepared.plan.error;
  for (const check of Object.values(prepared.exes)) if (!check.ok) return check.message;
  if (!prepared.space.fits)
    return `There is not enough room in the browser's storage (${Math.ceil(prepared.space.short / 1048576)} MB short). ${prepared.space.advice ?? ""}`.trim();
  return null;
}

export interface RunOptions {
  prepared: Prepared;
  build: BuildInfo;
  manifest: Manifest;
  target: CopyTarget;
  onProgress?(progress: CopyProgress): void;
  signal?: AbortSignal;
  /** Explicitly resume an incomplete installation; otherwise create a new slot. */
  slot?: number;
}

/**
 * Copies a prepared folder. Games go one after another; a file two games read is copied once, with
 * the first, and the second finds it done. An import that was cancelled or reloaded takes up where it
 * stopped: the manifest knows which files are in OPFS whole and unchanged.
 */
export async function runImport(options: RunOptions): Promise<number> {
  const { prepared, build, manifest, target, signal } = options;
  const problem = blocker(prepared);
  if (problem) throw new Error(problem);
  const installation =
    options.slot === undefined
      ? await manifest.createInstallation(prepared.name, prepared.plan.games)
      : await manifest.getInstallation(options.slot);
  if (!installation) throw new Error("That installation does not exist.");
  const slot = installation.slot;
  const existing = await manifest.listGames(slot);
  const expected = installation.editions ?? existing.map((game) => game.id);
  if (existing.length && expected.every((id) => existing.some((game) => game.id === id && game.complete)))
    throw new Error("That installation is already complete. Import it into a new slot instead.");
  if (
    expected.some((id) => !prepared.plan.games.includes(id)) || existing.some(
      (game) =>
        !prepared.plan.games.includes(game.id) || build.games[game.id]?.stamp !== game.exeStamp,
    )
  )
    throw new Error("Choose the original folder to resume this installation.");
  let doneBytes = 0;
  let doneFiles = 0;
  const totalBytes = prepared.plan.copy.reduce((sum, file) => sum + file.size, 0);
  const totalFiles = prepared.plan.copy.length;
  const counted = new Set<string>();
  for (const id of prepared.plan.games) {
    const game = build.games[id];
    if (!game) continue;
    const planned: PlannedFile[] = prepared.plan.copy
      .filter((file) => file.needs.includes(id))
      .map((file) => ({
        name: file.path,
        size: file.size,
        lastModified: prepared.files.get(file.path)?.lastModified ?? 0,
        needs: file.needs,
      }));
    const exeStamp = game.stamp;
    const { record, resume } = await manifest.beginImport(id, game.title, exeStamp, planned, slot);
    // what an earlier run already finished counts toward the bar, once
    for (const name of resume.done) {
      if (counted.has(name)) continue;
      counted.add(name);
      doneBytes += record.files[name]?.size ?? 0;
      doneFiles++;
    }
    const jobs: CopyJob[] = resume.todo.map((file) => {
      const source = prepared.files.get(file.name);
      if (!source) throw new Error(`${file.name} is no longer in the folder.`);
      counted.add(file.name);
      const stub = prepared.plan.copy.find((entry) => entry.path === file.name)?.stub;
      return {
        ...file,
        home: record.files[file.name]?.home ?? id,
        open: () => (stub ? bytesStream(EMPTY_ARCHIVE) : source.stream()),
      };
    });
    const before = { bytes: doneBytes, files: doneFiles };
    await copyInstall({
      jobs,
      target,
      signal,
      alreadyBytes: before.bytes,
      alreadyFiles: before.files,
      markDone: (name) => manifest.markFileDone(id, name, slot),
      onProgress: (progress) =>
        options.onProgress?.({
          ...progress,
          totalBytes: Math.max(totalBytes, progress.totalBytes),
          totalFiles: Math.max(totalFiles, progress.totalFiles),
        }),
    });
    doneBytes += jobs.reduce((sum, job) => sum + job.size, 0);
    doneFiles += jobs.length;
  }
  return slot;
}

// ---- a dropped folder ---------------------------------------------------------------------------

interface LegacyEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(ok: (file: File) => void, fail: (error: unknown) => void): void;
  createReader?(): {
    readEntries(ok: (entries: LegacyEntry[]) => void, fail: (error: unknown) => void): void;
  };
}

/** Every entry of a legacy directory (readEntries answers in batches until it gives none). */
async function readAll(entry: LegacyEntry): Promise<LegacyEntry[]> {
  const reader = entry.createReader?.();
  const out: LegacyEntry[] = [];
  if (!reader) return out;
  for (;;) {
    const batch = await new Promise<LegacyEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (batch.length === 0) return out;
    out.push(...batch);
  }
}

/** A folder from the old entry API (`webkitGetAsEntry`): Firefox and Safari, and Chromium without handles. */
export function entrySource(root: LegacyEntry): FolderSource {
  async function walk(dir: LegacyEntry, prefix: string, out: SourceFile[]) {
    for (const entry of await readAll(dir)) {
      if (entry.isFile && entry.file) {
        const file = await new Promise<File>((ok, fail) => entry.file?.(ok, fail));
        out.push(fromFile(prefix + entry.name, file));
      } else if (entry.isDirectory && prefix === "" && entry.name.toLowerCase() === "saved games") {
        await walk(entry, "Saved Games/", out);
      }
    }
  }
  return {
    name: root.name,
    async list() {
      const out: SourceFile[] = [];
      await walk(root, "", out);
      return out;
    },
  };
}

/** The folder the player dropped, or null if what they dropped is not a folder. */
export async function droppedSource(items: DataTransferItemList): Promise<FolderSource | null> {
  const item = items[0];
  if (!item) return null;
  const withHandle = item as DataTransferItem & {
    getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
  };
  if (withHandle.getAsFileSystemHandle) {
    const handle = await withHandle.getAsFileSystemHandle();
    if (handle?.kind === "directory") return directorySource(handle as FileSystemDirectoryHandle);
    return null;
  }
  const entry = (
    item as DataTransferItem & { webkitGetAsEntry?(): LegacyEntry | null }
  ).webkitGetAsEntry?.();
  return entry?.isDirectory ? entrySource(entry) : null;
}
