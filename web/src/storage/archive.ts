// An archive or installer as a folder for the import (importer.ts): 7-Zip in a worker
// (archive.worker.ts) lists it, and streams the files the copy asks for in one pass, in the
// archive's own order (`order`), so a solid archive is decompressed once, not once per file.
// docs/web/storage.md, "Archives".

import type { FromArchiveHost, ToArchiveHost } from "./archive-host";
import type { FolderSource, SourceFile } from "./importer";
import { gameRoot, type ArchiveEntry } from "./sevenzip";

/** The files the import offers to open with 7-Zip. */
export const ARCHIVE_ACCEPT = ".7z,.zip,.rar,.exe";
export const isArchiveName = (name: string) => /\.(7z|zip|rar|exe)$/i.test(name);

/** What archive.ts needs of a Worker, so a test can run the host in-process. */
export interface ArchiveWorker {
  onmessage: ((event: MessageEvent<FromArchiveHost>) => void) | null;
  postMessage(message: ToArchiveHost): void;
  terminate(): void;
}

const spawnWorker = (): ArchiveWorker =>
  new Worker(new URL("./archive.worker.ts", import.meta.url), {
    type: "module",
    name: "7-Zip",
  }) as unknown as ArchiveWorker;

interface Pass {
  id: number;
  paths: Set<string>;
  chunks: Map<string, Uint8Array[]>;
  finished: Set<string>;
  waiting: Map<string, () => void>;
  error: Error | null;
  flow: Int32Array | null;
}

export type ArchiveSource = FolderSource & {
  /** stops 7-Zip and lets the worker go */
  close(): void;
};

/**
 * The picked archive as a folder: its game folder (where `ra2.mix` is), files as paths under it.
 * `flow` makes 7-Zip wait while the copy is behind; it needs a cross-origin isolated page.
 */
export function archiveSource(
  file: File,
  options: { spawn?: () => ArchiveWorker; flow?: boolean } = {},
): ArchiveSource {
  const spawn = options.spawn ?? spawnWorker;
  const flow =
    options.flow ?? (typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated);
  let worker: ArchiveWorker | null = null;
  let listed: Promise<ArchiveEntry[]> | null = null;
  let root = "";
  /** each file's place in the archive, by its path under the root */
  const place = new Map<string, number>();
  let pass: Pass | null = null;
  let passes = 0;
  const listeners = new Set<(message: FromArchiveHost) => void>();

  function host(): ArchiveWorker {
    if (worker) return worker;
    worker = spawn();
    worker.onmessage = (event) => {
      for (const listener of listeners) listener(event.data);
      receive(event.data);
    };
    return worker;
  }

  function receive(message: FromArchiveHost) {
    if (!pass || !("pass" in message) || message.pass !== pass.id) return;
    const current = pass;
    if (message.type === "chunk") {
      const path = message.path.slice(root.length);
      current.chunks.set(path, [...(current.chunks.get(path) ?? []), message.chunk]);
      if (message.last) current.finished.add(path);
      current.waiting.get(path)?.();
    } else if (message.type === "failed") {
      current.error = new Error(message.message);
      for (const wake of current.waiting.values()) wake();
    } else if (message.type === "streamed") {
      // a file 7-Zip never gave is an error for whoever waits on it
      for (const [path, wake] of current.waiting) {
        if (!current.finished.has(path))
          current.error ??= new Error(`${path} is not in ${file.name}.`);
        wake();
      }
    }
  }

  function stop() {
    if (pass?.flow) Atomics.store(pass.flow, 1, 1);
    pass = null;
  }

  /** A new pass of 7-Zip over the archive, for these files. */
  function start(paths: string[]): Pass {
    stop();
    const next: Pass = {
      id: ++passes,
      paths: new Set(paths),
      chunks: new Map(),
      finished: new Set(),
      waiting: new Map(),
      error: null,
      flow: flow ? new Int32Array(new SharedArrayBuffer(8)) : null,
    };
    pass = next;
    host().postMessage({
      type: "stream",
      pass: next.id,
      paths: paths.map((path) => root + path),
      ...(next.flow ? { flow: next.flow.buffer as SharedArrayBuffer } : {}),
    });
    return next;
  }

  /** The next piece of `path`, or null when it is whole. */
  async function next(path: string): Promise<Uint8Array | null> {
    const current = pass && pass.paths.has(path) ? pass : start([path]);
    for (;;) {
      const queue = current.chunks.get(path);
      const chunk = queue?.shift();
      if (chunk) {
        if (current.flow) {
          Atomics.sub(current.flow, 0, chunk.length);
          Atomics.notify(current.flow, 0);
        }
        return chunk;
      }
      if (current.finished.has(path)) return null;
      if (current.error) throw current.error;
      if (pass !== current) throw new Error("The archive was closed.");
      await new Promise<void>((wake) => current.waiting.set(path, wake));
      current.waiting.delete(path);
    }
  }

  function list(): Promise<ArchiveEntry[]> {
    listed ??= new Promise((resolve, reject) => {
      const listener = (message: FromArchiveHost) => {
        if (message.type === "listed") resolve(message.entries);
        else if (message.type === "failed" && message.pass === undefined)
          reject(
            new Error(
              `7-Zip cannot open ${file.name}. If it is an installer 7-Zip cannot read, install the game and pick the installed folder instead.`,
            ),
          );
        else return;
        listeners.delete(listener);
      };
      listeners.add(listener);
      host().postMessage({ type: "list", file });
    });
    return listed;
  }

  return {
    name: file.name,
    async list() {
      const entries = await list();
      root = gameRoot(entries);
      place.clear();
      const files: SourceFile[] = [];
      for (const entry of entries) {
        if (!entry.path.startsWith(root)) continue;
        const path = entry.path.slice(root.length);
        place.set(path, place.size);
        files.push({
          path,
          size: entry.size,
          lastModified: entry.modified || file.lastModified,
          async head(count) {
            const out = new Uint8Array(Math.min(count, entry.size));
            let at = 0;
            while (at < out.length) {
              const chunk = await next(path);
              if (!chunk) break;
              out.set(chunk.subarray(0, out.length - at), at);
              at += chunk.length;
            }
            stop();
            return out;
          },
          stream: () =>
            new ReadableStream<Uint8Array>({
              async pull(controller) {
                const chunk = await next(path);
                if (chunk) controller.enqueue(chunk);
                else controller.close();
              },
            }),
        });
      }
      return files;
    },
    order(paths) {
      const sorted = [...paths].sort(
        (a, b) => (place.get(a) ?? Infinity) - (place.get(b) ?? Infinity),
      );
      if (sorted.length) start(sorted);
      return sorted;
    },
    close() {
      stop();
      worker?.terminate();
      worker = null;
    },
  };
}
