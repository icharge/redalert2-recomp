// The archive worker's side (archive.worker.ts wires it to `self`): one archive, listed once, then
// streamed in passes the page asks for. Kept apart from the worker so a test can run it in-process.

import {
  ArchiveError,
  listArchive,
  streamArchive,
  type ArchiveEntry,
  type SevenZip,
} from "./sevenzip";

export type ToArchiveHost =
  | { type: "list"; file: File }
  /** `flow`: [0] bytes sent and not yet taken by the page, [1] set when the page stops this pass */
  | { type: "stream"; pass: number; paths: string[]; flow?: SharedArrayBuffer };

export type FromArchiveHost =
  | { type: "listed"; entries: ArchiveEntry[] }
  | { type: "chunk"; pass: number; path: string; chunk: Uint8Array; last: boolean }
  | { type: "streamed"; pass: number }
  | { type: "failed"; pass?: number; message: string };

/** Bytes the page may have waiting before 7-Zip pauses for it. */
export const FLOW_LIMIT = 64 * 1024 * 1024;

/** Opens the picked file in a fresh 7-Zip, returning the module and the archive's path in it. */
export type LoadArchive = (file: File) => Promise<{ zip: SevenZip; path: string }>;

class Stopped extends Error {}

export function archiveHost(load: LoadArchive, post: (message: FromArchiveHost) => void) {
  let file: File | null = null;
  let entries: ArchiveEntry[] = [];
  // a failed or stopped command leaves 7-Zip unusable: the next one loads a fresh module
  let open: { zip: SevenZip; path: string } | null = null;
  const ready = async () => (open ??= await load(file!));

  return async function receive(message: ToArchiveHost): Promise<void> {
    if (message.type === "list") {
      file = message.file;
      open = null;
      try {
        entries = listArchive((await ready()).zip, (await ready()).path);
        post({ type: "listed", entries });
      } catch (error) {
        open = null;
        post({ type: "failed", message: text(error) });
      }
      return;
    }
    const { pass, flow } = message;
    const wanted = new Set(message.paths);
    const counter = flow ? new Int32Array(flow) : null;
    try {
      const { zip, path } = await ready();
      streamArchive(
        zip,
        path,
        entries.filter((entry) => wanted.has(entry.path)),
        (name, chunk, last) => {
          if (counter) {
            if (Atomics.load(counter, 1)) throw new Stopped();
            Atomics.add(counter, 0, chunk.length);
          }
          post({ type: "chunk", pass, path: name, chunk, last });
          // the page is behind: wait for it, or for it to stop this pass
          while (counter && Atomics.load(counter, 0) > FLOW_LIMIT) {
            if (Atomics.load(counter, 1)) throw new Stopped();
            Atomics.wait(counter, 0, Atomics.load(counter, 0), 200);
          }
        },
      );
      post({ type: "streamed", pass });
    } catch (error) {
      open = null;
      if (!(error instanceof Stopped)) post({ type: "failed", pass, message: text(error) });
    }
  };
}

function text(error: unknown): string {
  if (error instanceof ArchiveError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
