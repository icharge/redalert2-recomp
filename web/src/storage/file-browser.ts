import type { FileEntry, GameRecord } from "./manifest";
import { readGameFile } from "./opfs";
import { isDirectory, modifiedMs, type FsLike } from "./saves";

export interface BrowseEntry {
  name: string;
  type: "folder" | "file";
  size?: number;
  modified?: number;
  /** cannot be deleted, even when the source can be managed */
  locked?: boolean;
}

/** Read-only unless it has `manage`: the explorer has no API for exporting game files. */
export interface ReadOnlyFileSource {
  label: string;
  rootLabel: string;
  list(path: string): Promise<BrowseEntry[]>;
  readText(path: string): Promise<string>;
  /** adding, replacing and deleting files; only the Library's imported files have it */
  manage?: FileManagement;
}

export interface UploadReport {
  added: string[];
  replaced: string[];
  /** files that were not taken, with the reason */
  problems: string[];
  /** other things that happened and the player should know */
  notes: string[];
}

export interface FileManagement {
  /** the names in the folder that an upload of files with these names would replace */
  clashes(folder: string, names: string[]): Promise<string[]>;
  upload(folder: string, files: File[]): Promise<UploadReport>;
  /** what to tell the player before deleting these paths, or null for nothing beyond the confirmation */
  removeWarning(paths: string[]): string | null;
  /** deletes files, and folders with everything in them; says what else happened */
  remove(paths: string[]): Promise<string[]>;
}

const MAX_TEXT_BYTES = 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  ".bat",
  ".c",
  ".cfg",
  ".cmd",
  ".conf",
  ".cpp",
  ".css",
  ".csv",
  ".h",
  ".htm",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".log",
  ".md",
  ".py",
  ".rc",
  ".sh",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

export function safeParts(path: string): string[] {
  if (path === "") return [];
  const parts = path.split("/");
  if (
    parts.some(
      (part) =>
        part === "" || part === "." || part === ".." || part.includes("\\") || part.includes("\0"),
    )
  )
    throw new Error("That path is not part of the game files.");
  return parts;
}

export function readAsText(path: string, bytes: Uint8Array): string {
  assertTextFile(path, bytes.byteLength);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  if (text.includes("\0")) throw new Error("That file does not appear to be text.");
  return text;
}

export function assertTextFile(path: string, size: number): void {
  const extension = /\.[^./]+$/.exec(path)?.[0].toLowerCase();
  if (!extension || !TEXT_EXTENSIONS.has(extension))
    throw new Error("Only text files can be opened here.");
  if (size > MAX_TEXT_BYTES)
    throw new Error("That text file is larger than the 1 MiB viewer limit.");
}

/** The files directly in a folder, and the folders below it, from a flat list of slash-separated paths. */
export function listChildren(
  files: { name: string; size?: number; modified?: number }[],
  path: string,
): BrowseEntry[] {
  const parts = safeParts(path);
  const prefix = parts.length ? `${parts.join("/")}/` : "";
  const folders = new Set<string>();
  const entries = new Map<string, BrowseEntry>();
  for (const file of files) {
    if (!file.name.startsWith(prefix)) continue;
    const rest = file.name.slice(prefix.length).split("/");
    const child = rest[0];
    if (!child) continue;
    if (rest.length > 1) folders.add(child);
    else
      entries.set(child, {
        name: child,
        type: "file",
        ...(file.size === undefined ? {} : { size: file.size }),
        ...(file.modified === undefined ? {} : { modified: file.modified }),
      });
  }
  for (const name of folders) entries.set(name, { name, type: "folder" });
  return [...entries.values()];
}

/** The files of a game's import record that are copied whole, as the browser shows them. */
export function completedFiles(record: GameRecord): [string, FileEntry][] {
  return Object.entries(record.files).filter(([name, entry]) => {
    try {
      return entry.done && safeParts(name).length > 0;
    } catch {
      return false;
    }
  });
}

/** `getRecord` is asked on every call, so a source can follow a record that changes. */
export function importedFileSourceOf(getRecord: () => GameRecord): ReadOnlyFileSource {
  const findFile = (path: string) => {
    safeParts(path);
    const found = completedFiles(getRecord()).find(([name]) => name === path);
    if (!found) throw new Error("That file is not in this game's completed import.");
    return found;
  };

  return {
    label: `${getRecord().title} — imported files`,
    rootLabel: `${getRecord().title} (imported files)`,
    async list(path) {
      return listChildren(
        completedFiles(getRecord()).map(([name, file]) => ({
          name,
          size: file.size,
          modified: file.lastModified,
        })),
        path,
      );
    },
    async readText(path) {
      const [name, file] = findFile(path);
      assertTextFile(name, file.size);
      return readAsText(name, await readGameFile(file.home, name));
    },
  };
}

/** Browses only files listed as complete in this game's OPFS import record. */
export const importedFileSource = (record: GameRecord): ReadOnlyFileSource =>
  importedFileSourceOf(() => record);

/** A safe, read-only view rooted at Emscripten's /game directory (a file the game reads in place from the import is listed too). */
export function liveGameFileSource(fs: FsLike, title: string): ReadOnlyFileSource {
  const absolutePath = (path: string) => {
    const parts = safeParts(path);
    return parts.length ? `/game/${parts.join("/")}` : "/game";
  };
  return {
    label: `${title} — live /game files`,
    rootLabel: `${title} (/game)`,
    async list(path) {
      const dir = absolutePath(path);
      const entries: BrowseEntry[] = [];
      for (const name of fs.readdir(dir)) {
        if (name === "." || name === "..") continue;
        const childPath = `${dir}/${name}`;
        try {
          const stat = fs.stat(childPath);
          entries.push(
            isDirectory(fs, stat.mode)
              ? { name, type: "folder" }
              : { name, type: "file", size: stat.size, modified: modifiedMs(stat.mtime) },
          );
        } catch {
          // The running game may remove or replace an entry between readdir() and stat().
        }
      }
      return entries;
    },
    async readText(path) {
      const fullPath = absolutePath(path);
      const stat = fs.stat(fullPath);
      if (isDirectory(fs, stat.mode)) throw new Error("Folders cannot be opened as text files.");
      assertTextFile(path, stat.size);
      return readAsText(path, fs.readFile(fullPath));
    },
  };
}
