// 7-Zip (the `7z-wasm` build) for the import: list an archive or an installer 7-Zip can open, and
// stream chosen files out of it in one pass. Plain functions over the module, so the worker
// (archive.worker.ts) and the tests (in Node) run the same code. docs/web/storage.md, "Archives".

import type { SevenZipModule, SevenZipModuleFactory, SevenZipModuleOptions } from "7z-wasm";

/** One file inside an archive, its path with `/` between parts. */
export interface ArchiveEntry {
  path: string;
  size: number;
  /** ms since 1970, or 0 when the archive has no date */
  modified: number;
}

type Fs = SevenZipModule["FS"] & { streams: unknown[] };

/** A 7-Zip module, with what its last command printed. A failed command leaves it unusable. */
export interface SevenZip {
  module: SevenZipModule & { FS: Fs };
  output: string[];
  /** the code the last command quit with, if it quit */
  code?: number;
  /** where the stdout device sends a write (`streamArchive`) */
  sink?: (data: Uint8Array) => void;
}

export class ArchiveError extends Error {}

export async function openSevenZip(
  factory: SevenZipModuleFactory,
  options: Partial<SevenZipModuleOptions> = {},
): Promise<SevenZip> {
  const zip: Partial<SevenZip> = { output: [] };
  zip.module = (await factory({
    ...options,
    print: (line) => zip.output!.push(line),
    printErr: (line) => zip.output!.push(line),
    quit: (code) => {
      zip.code = code;
    },
  })) as SevenZip["module"];
  return zip as SevenZip;
}

/** Runs one 7-Zip command; throws what it said when it fails. */
function run(zip: SevenZip, args: string[]): string[] {
  zip.output.length = 0;
  zip.code = undefined;
  let thrown = false;
  try {
    zip.module.callMain(args);
  } catch {
    thrown = true;
  }
  const said = zip.output.join("\n");
  if (/can ?not open .*as archive/i.test(said))
    throw new ArchiveError("7-Zip cannot open this file as an archive.");
  if (thrown || (zip.code ?? 0) !== 0 || /^ERROR/m.test(said)) {
    const reason = zip.output.filter((line) =>
      /error|cannot|can not|wrong|unsupported/i.test(line),
    );
    throw new ArchiveError(`7-Zip stopped: ${reason.join(" ").trim() || "an unknown error"}`);
  }
  return [...zip.output];
}

/** 7-Zip's `-slt` listing, as files (folders left out). Progress noise before `Path =` is skipped. */
export function parseListing(lines: string[]): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let current: { path: string; size: number; modified: number; folder: boolean } | null = null;
  const finish = () => {
    if (current && !current.folder)
      entries.push({ path: current.path, size: current.size, modified: current.modified });
    current = null;
  };
  for (const line of lines) {
    const path = /Path = (.*)$/.exec(line);
    if (path) {
      finish();
      current = { path: path[1]!.replace(/\\/g, "/"), size: 0, modified: 0, folder: false };
      continue;
    }
    if (!current) continue;
    const [key, ...rest] = line.split(" = ");
    const value = rest.join(" = ");
    if (key === "Size") current.size = Number(value) || 0;
    else if (key === "Folder") current.folder ||= value === "+";
    else if (key === "Attributes") current.folder ||= value.startsWith("D");
    else if (key === "Modified" && value) {
      const time = Date.parse(`${value.replace(" ", "T").replace(/\.\d+$/, "")}Z`);
      current.modified = Number.isNaN(time) ? 0 : time;
    }
  }
  finish();
  return entries;
}

/** The files of an archive, in the order 7-Zip stores (and extracts) them. */
export function listArchive(zip: SevenZip, archive: string): ArchiveEntry[] {
  return parseListing(run(zip, ["l", "-slt", "-ba", "-bsp0", "-scsUTF-8", archive]));
}

/**
 * Where the game folder starts inside an archive: the folder that holds `ra2.mix` (the shallowest),
 * else a single top folder, else the top. Ends with `/` unless it is the top.
 */
export function gameRoot(entries: ArchiveEntry[]): string {
  const mix = entries
    .filter((entry) => /(^|\/)ra2\.mix$/i.test(entry.path))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
  if (mix) return mix.path.slice(0, mix.path.length - "ra2.mix".length);
  const tops = new Set(entries.map((entry) => entry.path.split("/")[0]));
  const [top] = tops;
  return tops.size === 1 && entries.every((entry) => entry.path.includes("/")) ? `${top}/` : "";
}

const SINK_MAJOR = 64;

/** Points stdout (fd 1) at a device that hands each write to `zip.sink`, or back at the tty. */
function redirect(zip: SevenZip, toSink: boolean) {
  const { FS } = zip.module;
  let made = true;
  try {
    FS.stat("/dev/sink");
  } catch {
    made = false;
  }
  if (!made) {
    const dev = FS.makedev(SINK_MAJOR, 0);
    FS.registerDevice(dev, {
      open() {},
      close() {},
      // `buffer` is the module's heap as signed bytes (HEAP8): seen as unsigned here
      write(_stream: unknown, buffer: ArrayBufferView, offset: number, length: number) {
        zip.sink?.(new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length));
        return length;
      },
    });
    FS.mkdev("/dev/sink", 0o666, dev);
  }
  FS.close(FS.streams[1] as Parameters<typeof FS.close>[0]);
  const stream = FS.open(toSink ? "/dev/sink" : "/dev/tty", "w") as { fd?: number };
  if (stream.fd !== 1) throw new ArchiveError("7-Zip's output could not be redirected.");
}

/**
 * Streams `wanted` (entries of `listArchive`, in its order) out of the archive in one pass:
 * `onChunk` gets each file's bytes in order, `last` on its final piece (an empty file gets one empty,
 * last piece). The pieces are copies. A throw from `onChunk` stops 7-Zip, and leaves the module unusable.
 */
export function streamArchive(
  zip: SevenZip,
  archive: string,
  wanted: ArchiveEntry[],
  onChunk: (path: string, chunk: Uint8Array, last: boolean) => void,
): void {
  if (wanted.length === 0) return;
  let index = 0;
  let left = 0;
  const skipEmpty = () => {
    while (index < wanted.length && wanted[index]!.size === 0)
      onChunk(wanted[index++]!.path, new Uint8Array(0), true);
    left = wanted[index]?.size ?? 0;
  };
  skipEmpty();
  zip.sink = (data) => {
    let at = 0;
    while (at < data.length) {
      const entry = wanted[index];
      if (!entry) throw new ArchiveError("7-Zip gave more than the archive lists.");
      const take = Math.min(left, data.length - at);
      left -= take;
      onChunk(entry.path, data.slice(at, at + take), left === 0);
      at += take;
      if (left === 0) {
        index++;
        skipEmpty();
      }
    }
  };
  zip.module.FS.writeFile("/list.txt", wanted.map((entry) => entry.path).join("\n") + "\n");
  redirect(zip, true);
  try {
    run(zip, ["x", "-so", "-bd", "-y", "-spd", "-scsUTF-8", archive, "@/list.txt"]);
  } finally {
    zip.sink = undefined;
    redirect(zip, false);
  }
  if (index < wanted.length)
    throw new ArchiveError(`The archive ended before ${wanted[index]!.path} was whole.`);
}
