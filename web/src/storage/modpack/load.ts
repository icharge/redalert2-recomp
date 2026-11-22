// Finds an XCC mod pack in an imported folder or a dropped file, reads it (and
// its sibling module files), and returns the flat folder the mod importer takes.
// Independent implementation; MIT.

import type { FolderSource, SourceFile } from "../importer";
import { buildModPack, type BaseData, type BuiltPack } from "./build";
import { mergeModule, packFolderName, parseModPack, type ModPack } from "./model";
import { readXif } from "./xif";

const MAX_PACK_BYTES = 512 * 1024 * 1024;

export interface PackSource {
  /** the generated mod folder, ready for `importMod` */
  source: FolderSource;
  warnings: string[];
  name: string;
}

/** Whether a file can hold an XCC mod pack. */
export function isPackName(name: string): boolean {
  return /\.(xmlf|exe)$/i.test(name);
}

/**
 * Converts a pack into the flat folder a mod import takes. Returns null when
 * the source holds no pack (an ordinary mod folder), so the caller can import
 * it as it is.
 */
export async function buildPackSource(
  source: FolderSource,
  base: BaseData,
): Promise<PackSource | null> {
  const files = await source.list();
  const top = files.filter((file) => !/[\\/]/.test(file.path) && isPackName(file.path));
  if (!top.length) return null;
  const main = chooseMain(top, source.name);
  const stem = main.path.replace(/\.[^.]+$/, "");
  let pack: ModPack;
  try {
    pack = await readPack(main, stem);
  } catch (error) {
    // A folder may hold an ordinary .exe. Only a chosen .xmlf makes the error
    // decisive; otherwise try another candidate, and give up quietly when none
    // of them is a pack.
    const alternatives = top.filter((file) => file !== main);
    if (!/\.xmlf$/i.test(main.path) && alternatives.length) {
      const fallback = await tryCandidates(alternatives);
      return fallback ? finish(fallback.file, fallback.pack, top, base) : null;
    }
    if (!/\.xmlf$/i.test(main.path)) {
      // A file the player handed over as a pack gets the real reason; an
      // unrelated .exe in an ordinary folder is not an error.
      if (files.length === 1) throw error;
      return null;
    }
    throw error;
  }
  return finish(main, pack, top, base);
}

async function tryCandidates(
  files: SourceFile[],
): Promise<{ file: SourceFile; pack: ModPack } | null> {
  for (const file of files) {
    try {
      const stem = file.path.replace(/\.[^.]+$/, "");
      return { file, pack: await readPack(file, stem) };
    } catch {
      // Not a pack: try the next candidate.
    }
  }
  return null;
}

async function finish(
  main: SourceFile,
  pack: ModPack,
  top: SourceFile[],
  base: BaseData,
): Promise<PackSource> {
  const stem = main.path.replace(/\.[^.]+$/, "");
  const modules = top
    .filter((file) => file !== main && moduleName(file.path, stem) !== null)
    .sort((a, b) => (moduleName(a.path, stem) ?? 0) - (moduleName(b.path, stem) ?? 0));
  for (const module of modules) {
    try {
      mergeModule(pack, await readPack(module, module.path.replace(/\.[^.]+$/, "")));
    } catch (error) {
      pack.warnings.push(`${module.path} could not be read (${message(error)}); it was left out.`);
    }
  }
  if (pack.modules.length && !modules.length)
    pack.warnings.push(
      "The pack has module files that were not supplied; import the folder with them to include their content.",
    );

  const built = await buildModPack(pack, base);
  if (!built.files.length)
    throw new Error(
      built.warnings[0] ??
        "This pack has no files this launcher can bring. It may only contain launcher art.",
    );
  const name = packFolderName(pack, stem);
  return { source: builtSource(name, built), warnings: built.warnings, name };
}

/** A `FolderSource` over files already in memory. */
export function sourceFromFiles(name: string, files: Record<string, Uint8Array>): FolderSource {
  return {
    name,
    list: async () =>
      Object.entries(files).map(([path, bytes]) => ({
        path,
        size: bytes.length,
        lastModified: 0,
        head: async (count: number) => bytes.subarray(0, count),
        stream: () => streamOf(bytes),
      })),
  };
}

function builtSource(name: string, built: BuiltPack): FolderSource {
  return {
    name,
    list: async () =>
      built.files.map((file) => ({
        path: file.name,
        size: file.bytes.length,
        lastModified: 0,
        head: async (count: number) => file.bytes.subarray(0, count),
        stream: () => streamOf(file.bytes),
      })),
  };
}

function chooseMain(files: SourceFile[], sourceName: string): SourceFile {
  const mains = files.filter((file) => !/ \d\d\.[^.]+$/i.test(file.path));
  const list = mains.length ? mains : files;
  const xmlf = list.find((file) => /\.xmlf$/i.test(file.path));
  const named = list.find((file) => file.path.replace(/\.[^.]+$/, "") === sourceName);
  return xmlf ?? named ?? list[0]!;
}

/** The module number of `<stem> NN.xmlf`, or null. */
function moduleName(path: string, stem: string): number | null {
  const match = /^(.*) (\d\d)\.xmlf$/i.exec(path);
  if (!match || match[1]!.toLowerCase() !== stem.toLowerCase()) return null;
  return Number(match[2]);
}

async function readPack(file: SourceFile, nameHint: string): Promise<ModPack> {
  if (file.size > MAX_PACK_BYTES) throw new Error(`${file.path} is too large to be a mod pack.`);
  const bytes = await readAll(file);
  const payload = /\.exe$/i.test(file.path) ? unwrapExe(bytes, file.path) : bytes;
  return parseModPack(await readXif(payload), nameHint);
}

/**
 * An XCC mod EXE is the launcher executable, the XIF bytes, then an int32 with
 * the XIF length. Returns the XIF slice.
 */
export function unwrapExe(bytes: Uint8Array, name = "The file"): Uint8Array {
  if (bytes.length < 12) throw new Error(`${name} is too short to be a mod pack.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getInt32(bytes.length - 4, true);
  if (size < 4 || size + 4 > bytes.length)
    throw new Error(`${name} is not an XCC mod pack (its trailer is missing).`);
  const start = bytes.length - 4 - size;
  if (
    bytes[start] !== 0x58 ||
    bytes[start + 1] !== 0x49 ||
    bytes[start + 2] !== 0x46 ||
    bytes[start + 3] !== 0x1a
  )
    throw new Error(`${name} is not an XCC mod pack (its payload is not XIF).`);
  return bytes.subarray(start, bytes.length - 4);
}

async function readAll(file: SourceFile): Promise<Uint8Array> {
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > MAX_PACK_BYTES) throw new Error(`${file.path} is too large to be a mod pack.`);
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice());
      controller.close();
    },
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
