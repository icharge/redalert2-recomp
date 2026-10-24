import type { GameRecord } from "./manifest";
import { readGameFile } from "./opfs";
import type { FsLike } from "./saves";

export interface BrowseEntry {
  name: string;
  type: "folder" | "file";
  size?: number;
  modified?: number;
}

/** Deliberately read-only: the explorer has no API for changing or exporting game files. */
export interface ReadOnlyFileSource {
  label: string;
  rootLabel: string;
  list(path: string): Promise<BrowseEntry[]>;
  readText(path: string): Promise<string>;
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

function safeParts(path: string): string[] {
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

function readAsText(path: string, bytes: Uint8Array): string {
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

function assertTextFile(path: string, size: number): void {
  const extension = /\.[^./]+$/.exec(path)?.[0].toLowerCase();
  if (!extension || !TEXT_EXTENSIONS.has(extension))
    throw new Error("Only text files can be opened here.");
  if (size > MAX_TEXT_BYTES)
    throw new Error("That text file is larger than the 1 MiB viewer limit.");
}

function makeImportedFileSource(record: GameRecord): ReadOnlyFileSource {
  const files = Object.entries(record.files).filter(([name, entry]) => {
    try {
      return entry.done && safeParts(name).length > 0;
    } catch {
      return false;
    }
  });

  const findFile = (path: string) => {
    safeParts(path);
    const found = files.find(([name]) => name === path);
    if (!found) throw new Error("That file is not in this game's completed import.");
    return found;
  };

  return {
    label: `${record.title} — imported files`,
    rootLabel: `${record.title} (imported files)`,
    async list(path) {
      const parts = safeParts(path);
      const prefix = parts.length ? `${parts.join("/")}/` : "";
      const folders = new Set<string>();
      const entries = new Map<string, BrowseEntry>();
      for (const [name, file] of files) {
        if (!name.startsWith(prefix)) continue;
        const rest = name.slice(prefix.length).split("/");
        const child = rest[0];
        if (!child) continue;
        if (rest.length > 1) folders.add(child);
        else
          entries.set(child, {
            name: child,
            type: "file",
            size: file.size,
            modified: file.lastModified,
          });
      }
      for (const name of folders) entries.set(name, { name, type: "folder" });
      return [...entries.values()];
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
  makeImportedFileSource(record);

/** A safe, read-only view rooted at Emscripten's /game directory. */
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
            fs.isDir(stat.mode)
              ? { name, type: "folder" }
              : { name, type: "file", size: stat.size, modified: stat.mtime.getTime() },
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
      if (fs.isDir(stat.mode)) throw new Error("Folders cannot be opened as text files.");
      assertTextFile(path, stat.size);
      return readAsText(path, fs.readFile(fullPath));
    },
  };
}
