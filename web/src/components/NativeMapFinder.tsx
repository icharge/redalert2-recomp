import { useEffect, useRef } from "react";
import type { GameHandle } from "../game/loader";
import { downloadMap, installMap, searchMaps, type MapResult } from "../game/mapdb";
import { loadDownloadedMaps } from "../storage/downloaded-maps";

/** What the game's own finder screen asks for (src/web/finder_screen.c); `seq` makes each ask a new value. */
export interface MapFinderCommand {
  seq: number;
  search?: string;
  add?: string;
}

const clean = (text: string) => text.replace(/[\t\r\n]+/g, " ");

/** How long one map's download may take (the largest is 8 MB). */
const DOWNLOAD_LIMIT_MS = 90_000;

/** How long a picked row waits before its map is downloaded for the preview (arrowing down the list picks every row). */
const PREVIEW_DELAY_MS = 250;
/** How many downloaded maps are kept for Add (the largest map is 8 MB). */
const KEPT_DOWNLOADS = 4;

/**
 * Downloads kept by hash: asking for the same map again, while it downloads or after, gives the same bytes.
 * A failed download is forgotten, so it can be tried again; so is the oldest once more than `limit` are kept.
 */
export function keptDownloads(
  download: (sha1: string) => Promise<Uint8Array>,
  limit = KEPT_DOWNLOADS,
): (sha1: string) => Promise<Uint8Array> {
  const kept = new Map<string, Promise<Uint8Array>>();
  return (sha1) => {
    const had = kept.get(sha1);
    if (had) return had;
    const made = download(sha1);
    kept.set(sha1, made);
    made.catch(() => {
      if (kept.get(sha1) === made) kept.delete(sha1);
    });
    while (kept.size > limit) kept.delete(kept.keys().next().value!);
    return made;
  };
}

/** The lines `ra2_finder_results` takes: "sha1 TAB flags TAB name", flags `u` unreviewed, `a` already added. */
export function finderRows(results: MapResult[], added: ReadonlySet<string>): string {
  return results
    .map(
      (map) =>
        `${map.sha1}\t${map.incomplete ? "u" : ""}${added.has(map.sha1) ? "a" : ""}\t${clean(map.name)}`,
    )
    .join("\n");
}

/**
 * The page's half of the game's own map finder screen: it searches CnCNet's map database and downloads
 * a map when the screen asks, and tells the screen what came of it. It draws nothing. The map the screen has
 * picked is downloaded (after a short wait) and put in the game's folder for the screen's preview; Add then
 * reuses that download.
 */
export function NativeMapFinder({
  game,
  command,
  preview,
}: {
  game: GameHandle;
  command: MapFinderCommand | null;
  /** the picked map ("" for none); `seq` makes each ask a new value */
  preview: { seq: number; sha1: string } | null;
}) {
  const handled = useRef(command?.seq ?? 0);
  const found = useRef(new Map<string, MapResult>());
  const abort = useRef<AbortController | null>(null);
  const fetchMap = useRef(
    keptDownloads((sha1) => downloadMap(sha1, AbortSignal.timeout(DOWNLOAD_LIMIT_MS))),
  );
  const previewHandled = useRef(preview?.seq ?? 0);
  const wanted = useRef("");
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => () => clearTimeout(previewTimer.current), []);
  useEffect(() => {
    if (!preview || preview.seq === previewHandled.current) return;
    previewHandled.current = preview.seq;
    clearTimeout(previewTimer.current);
    const { sha1, seq } = preview;
    wanted.current = sha1;
    if (!sha1) return;
    previewTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const bytes = await fetchMap.current(sha1);
          if (wanted.current !== sha1) return; // another row was picked meanwhile
          const file = `fp${seq}.tmp`;
          game.writeGameFile(file, bytes);
          game.exports.ra2_finder_preview(sha1, file);
        } catch (reason) {
          console.warn(`[finder] no preview of ${sha1}:`, reason);
        }
      })();
    }, PREVIEW_DELAY_MS);
  }, [preview, game]);
  useEffect(() => {
    if (!command || command.seq === handled.current) return;
    handled.current = command.seq;
    const { exports } = game;
    const message = (reason: unknown) =>
      reason instanceof Error ? reason.message : String(reason);

    if (command.search !== undefined) {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      void (async () => {
        try {
          const [results, kept] = await Promise.all([
            searchMaps(command.search!.trim(), controller.signal),
            loadDownloadedMaps(),
          ]);
          if (controller.signal.aborted) return;
          found.current = new Map(results.map((map) => [map.sha1, map]));
          exports.ra2_finder_note(results.length === 0 ? "No maps found" : "");
          exports.ra2_finder_results(finderRows(results, new Set(kept.map((m) => m.sha1))));
        } catch (reason) {
          if (controller.signal.aborted) return;
          exports.ra2_finder_results("");
          exports.ra2_finder_note(message(reason));
        }
      })();
    } else if (command.add) {
      const sha1 = command.add;
      void (async () => {
        try {
          // The row shows only "..." while this runs: a download that never ends must end as a failure.
          await installMap(game, sha1, await fetchMap.current(sha1));
          exports.ra2_finder_added(sha1, 1);
        } catch (reason) {
          const why =
            reason instanceof DOMException && reason.name === "TimeoutError"
              ? "the download took too long"
              : message(reason);
          exports.ra2_finder_added(sha1, 0);
          exports.ra2_finder_note(`${found.current.get(sha1)?.name ?? "The map"}: ${why}`);
        }
      })();
    }
  }, [command, game]);

  return null;
}
