// Community maps from CnCNet's MapDB 2 for Yuri's Revenge (docs/web/online-maps-research.md).
// The page asks its own origin under /maps-api/, which the server forwards to mapdb2.cncnet.org
// (MapDB sends no CORS header). A map is a zip holding one `<sha1>.map`; the name is the SHA1 of
// the file, which is checked before the game sees it.

import { saveDownloadedMap } from "../storage/downloaded-maps";
import type { GameHandle } from "./loader";

const API = `${import.meta.env.BASE_URL}maps-api`;
/** A map file larger than this is refused (the biggest seen is a few hundred KB). */
export const MAX_MAP_BYTES = 8 * 1024 * 1024;

export interface MapResult {
  id: string;
  name: string;
  /** SHA1 of the map file: what the download is named by */
  sha1: string;
  published: boolean;
  /** the upload was never completed or is a temporary one; most of the database is */
  incomplete: boolean;
}

interface RawMap {
  id: string;
  map_name: string;
  latest_map_file_hash: string | null;
  is_published: boolean;
  incomplete_upload: boolean;
  is_temporary: boolean;
}

const SHA1 = /^[0-9a-f]{40}$/;

export async function searchMaps(
  query: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<MapResult[]> {
  const url = `${API}/maps/search/?game_slug=yr&limit=30&search=${encodeURIComponent(query)}`;
  const response = await fetcher(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`The map database answered ${response.status}`);
  const body = (await response.json()) as { results?: RawMap[] };
  const found: MapResult[] = [];
  for (const raw of body.results ?? []) {
    const sha1 = (raw.latest_map_file_hash ?? "").toLowerCase();
    if (!SHA1.test(sha1)) continue;
    found.push({
      id: raw.id,
      name: raw.map_name,
      sha1,
      published: raw.is_published,
      incomplete: raw.incomplete_upload || raw.is_temporary,
    });
  }
  return found;
}

const u16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u32 = (b: Uint8Array, at: number) =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("The map file is too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** The first file in a zip, stored or deflated (a map zip has only the one). */
export async function firstZipEntry(
  zip: Uint8Array,
  limit = MAX_MAP_BYTES,
): Promise<{ name: string; bytes: Uint8Array }> {
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 65535); at--) {
    if (u32(zip, at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("This is not a zip file");
  const count = u16(zip, end + 10);
  let at = u32(zip, end + 16);
  if (count < 1 || u32(zip, at) !== 0x02014b50) throw new Error("The zip is empty");
  const method = u16(zip, at + 10);
  const packed = u32(zip, at + 20);
  const size = u32(zip, at + 24);
  const nameLength = u16(zip, at + 28);
  const local = u32(zip, at + 42);
  const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
  if (size > limit) throw new Error("The map file is too large");
  if (u32(zip, local) !== 0x04034b50) throw new Error("The zip is damaged");
  at = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
  const data = zip.subarray(at, at + packed);
  if (data.length !== packed) throw new Error("The zip is cut short");
  if (method === 0) return { name, bytes: data.slice() };
  if (method !== 8) throw new Error(`The zip uses compression method ${method}`);
  const bytes = await inflateRaw(data, limit);
  if (bytes.length !== size) throw new Error("The zip is damaged");
  return { name, bytes };
}

export async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Downloads `/yr/<sha1>.zip`, unzips it and returns the map file once its SHA1 matches the name. */
export async function downloadMap(
  sha1: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  if (!SHA1.test(sha1)) throw new Error("Not a map hash");
  const response = await fetcher(`${API}/yr/${sha1}.zip`, { signal });
  if (!response.ok) throw new Error(`The download answered ${response.status}`);
  const zip = new Uint8Array(await response.arrayBuffer());
  if (zip.length > MAX_MAP_BYTES) throw new Error("The download is too large");
  const { bytes } = await firstZipEntry(zip);
  if ((await sha1Hex(bytes)) !== sha1) throw new Error("The download does not match its hash");
  return bytes;
}

/**
 * Puts the map in the game's folder as `<sha1>.yrm`, has the game list it (a map screen already open
 * is refilled), and keeps it in the browser's storage so it is there after a reload.
 */
export async function installMap(game: GameHandle, sha1: string, bytes: Uint8Array): Promise<void> {
  game.writeGameFile(`${sha1}.yrm`, bytes);
  game.exports.ra2_maps_rescan(1);
  await saveDownloadedMap(sha1, bytes);
}
