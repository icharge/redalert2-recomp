// The maps the player downloaded (src/game/mapdb.ts), kept in the origin-private file system under
// `downloaded-maps/yr/<sha1>.yrm`, so they survive a reload. The game gets them back at start-up:
// the loader writes each into /game before the game's one map scan (loader.ts). They belong to no
// install, so every Yuri's Revenge game on this origin lists them. docs/web/online-maps-research.md.

const FOLDER = "downloaded-maps";
const GAME = "yr";
const FILE = /^([0-9a-f]{40})\.yrm$/;

export interface DownloadedMap {
  sha1: string;
  bytes: Uint8Array;
}

async function folder(create: boolean, root?: FileSystemDirectoryHandle) {
  const top = root ?? (await navigator.storage.getDirectory());
  const parent = await top.getDirectoryHandle(FOLDER, { create });
  return parent.getDirectoryHandle(GAME, { create });
}

export async function saveDownloadedMap(
  sha1: string,
  bytes: Uint8Array,
  root?: FileSystemDirectoryHandle,
): Promise<void> {
  if (!/^[0-9a-f]{40}$/.test(sha1)) throw new Error("Not a map hash");
  const dir = await folder(true, root);
  const file = await dir.getFileHandle(`${sha1}.yrm`, { create: true });
  const writable = await file.createWritable();
  await writable.write(bytes as BlobPart);
  await writable.close();
}

export async function removeDownloadedMap(
  sha1: string,
  root?: FileSystemDirectoryHandle,
): Promise<void> {
  const dir = await folder(false, root).catch(() => null);
  await dir?.removeEntry(`${sha1}.yrm`).catch(() => undefined);
}

/** Every saved map; none (not an error) when the folder was never made or OPFS is not there. */
export async function loadDownloadedMaps(
  root?: FileSystemDirectoryHandle,
): Promise<DownloadedMap[]> {
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await folder(false, root);
  } catch {
    return [];
  }
  const maps: DownloadedMap[] = [];
  for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    const match = FILE.exec(name);
    if (!match || handle.kind !== "file") continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    maps.push({ sha1: match[1]!, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  return maps;
}
