// The copy into the origin-private file system (docs/web/storage.md, "The copy").
//
// Each file is streamed, never read whole, so a 280 MB .mix does not sit in memory. The copy talks to a
// `CopyTarget`; `opfsTarget()` is the real one and a test can give it a Map. After each file the manifest
// records it as done, so a reload or Cancel resumes from the next one.

import type { PlannedFile } from "./manifest";
import type { SaveStore } from "./saves";

/** Where files go: paths like `game/ra2md/ra2.mix`. */
export interface CopyTarget {
  /** Writes the stream to the path, replacing what was there. An aborted write leaves nothing half-written. */
  write(path: string, stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<void>;
  /** The size of the file at the path, or null. */
  size(path: string): Promise<number | null>;
  remove(path: string): Promise<void>;
}

/** A file to copy: the plan's entry, where it goes, and how to read it. */
export interface CopyJob extends PlannedFile {
  /** the game's folder it is kept in */
  home: string;
  open(): ReadableStream<Uint8Array>;
}

export interface CopyProgress {
  file: string;
  /** bytes of every file copied so far, this one's so far included */
  doneBytes: number;
  totalBytes: number;
  doneFiles: number;
  totalFiles: number;
}

export class CopyCancelled extends Error {
  constructor() {
    super("The copy was cancelled.");
    this.name = "CopyCancelled";
  }
}

export const gamePath = (home: string, name: string) => `game/${home}/${name}`;

/** Passes a stream through, telling `onBytes` how many have gone by. */
function counting(
  stream: ReadableStream<Uint8Array>,
  onBytes: (total: number) => void,
): ReadableStream<Uint8Array> {
  let total = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        onBytes(total);
        controller.enqueue(chunk);
      },
    }),
  );
}

export interface CopyOptions {
  jobs: CopyJob[];
  target: CopyTarget;
  /** records a file as copied */
  markDone(name: string): Promise<void>;
  /** bytes already in place from an earlier run, so the bar starts where it was */
  alreadyBytes?: number;
  alreadyFiles?: number;
  onProgress?(progress: CopyProgress): void;
  signal?: AbortSignal;
}

/**
 * Copies the files one after another. Throws `CopyCancelled` on abort, and an Error naming the file if
 * what arrived is not the size the folder said (a file that changed under the copy). Progress goes out at
 * most about ten times a second, and at the end of each file.
 */
export async function copyInstall(options: CopyOptions): Promise<void> {
  const { jobs, target, markDone, signal } = options;
  const totalBytes = (options.alreadyBytes ?? 0) + jobs.reduce((sum, job) => sum + job.size, 0);
  const totalFiles = (options.alreadyFiles ?? 0) + jobs.length;
  let doneBytes = options.alreadyBytes ?? 0;
  let doneFiles = options.alreadyFiles ?? 0;
  const report = (file: string, inFile: number) =>
    options.onProgress?.({
      file,
      doneBytes: doneBytes + inFile,
      totalBytes,
      doneFiles,
      totalFiles,
    });

  for (const job of jobs) {
    if (signal?.aborted) throw new CopyCancelled();
    const path = gamePath(job.home, job.name);
    let last = 0;
    report(job.name, 0);
    try {
      await target.write(
        path,
        counting(job.open(), (received) => {
          const now = performance.now();
          if (now - last > 100) {
            last = now;
            report(job.name, received);
          }
        }),
        signal,
      );
    } catch (error) {
      if (signal?.aborted) throw new CopyCancelled();
      throw error;
    }
    const written = await target.size(path);
    if (written !== job.size) {
      await target.remove(path);
      throw new Error(
        `${job.name} came to ${written ?? 0} bytes, not ${job.size}: it changed while it was copied. Try again.`,
      );
    }
    await markDone(job.name);
    doneBytes += job.size;
    doneFiles++;
    report(job.name, 0);
  }
}

/** Deletes files from the target, ignoring ones that are not there. */
export async function removeFiles(
  target: CopyTarget,
  files: { home: string; name: string }[],
): Promise<void> {
  for (const file of files) await target.remove(gamePath(file.home, file.name));
}

/** The origin-private file system, as a `CopyTarget`. */
export function opfsTarget(root?: Promise<FileSystemDirectoryHandle>): CopyTarget {
  let opened: Promise<FileSystemDirectoryHandle> | undefined;
  // not before it is used: a page with no OPFS (a test, an old browser) can still make a target
  const base = () => (opened ??= root ?? navigator.storage.getDirectory());
  async function folder(
    parts: string[],
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | null> {
    let dir = await base();
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch (error) {
        if (!create && error instanceof DOMException && error.name === "NotFoundError") return null;
        throw error;
      }
    }
    return dir;
  }
  const split = (path: string) => {
    const parts = path.split("/");
    return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] ?? "" };
  };
  return {
    async write(path, stream, signal) {
      const { dirs, name } = split(path);
      const dir = await folder(dirs, true);
      if (!dir) throw new Error(`no folder for ${path}`);
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await stream.pipeTo(writable, signal ? { signal } : {});
    },
    async size(path) {
      const { dirs, name } = split(path);
      const dir = await folder(dirs, false);
      if (!dir) return null;
      try {
        return (await (await dir.getFileHandle(name)).getFile()).size;
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") return null;
        throw error;
      }
    },
    async remove(path) {
      const { dirs, name } = split(path);
      const dir = await folder(dirs, false);
      if (!dir) return;
      try {
        await dir.removeEntry(name);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
      }
    },
  };
}

/** A folder in OPFS by path (`game/ra2md`), or null if there is none. */
async function openFolder(
  root: Promise<FileSystemDirectoryHandle>,
  path: string,
): Promise<FileSystemDirectoryHandle | null> {
  let dir = await root;
  for (const part of path.split("/").filter(Boolean)) {
    try {
      dir = await dir.getDirectoryHandle(part);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return null;
      throw error;
    }
  }
  return dir;
}

/** One file of a game as it was imported, for the loader. Throws if it is not there. */
export async function readGameFile(
  home: string,
  name: string,
  root: Promise<FileSystemDirectoryHandle> = navigator.storage.getDirectory(),
): Promise<Uint8Array> {
  const parts = `game/${home}/${name}`.split("/");
  const dir = await openFolder(root, parts.slice(0, -1).join("/"));
  if (!dir) throw new Error(`${name} is not in this browser's copy of the game (reimport it).`);
  const file = await (await dir.getFileHandle(parts[parts.length - 1] ?? "")).getFile();
  return new Uint8Array(await file.arrayBuffer());
}

/** What the game saved last time, in OPFS under `save/<game>/`. */
export function opfsSaveStore(
  root: Promise<FileSystemDirectoryHandle> = navigator.storage.getDirectory(),
): SaveStore {
  return {
    async list(game) {
      const out: { path: string; read(): Promise<Uint8Array> }[] = [];
      const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
        const entries = (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
        for await (const entry of entries) {
          if (entry.kind === "directory") {
            await walk(entry as FileSystemDirectoryHandle, `${prefix}${entry.name}/`);
          } else {
            const handle = entry as FileSystemFileHandle;
            out.push({
              path: prefix + entry.name,
              read: async () => new Uint8Array(await (await handle.getFile()).arrayBuffer()),
            });
          }
        }
      };
      const dir = await openFolder(root, `save/${game}`);
      if (dir) await walk(dir, "");
      return out;
    },
  };
}
