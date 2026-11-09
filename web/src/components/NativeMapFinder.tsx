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
 * a map when the screen asks, and tells the screen what came of it. It draws nothing.
 */
export function NativeMapFinder({
  game,
  command,
}: {
  game: GameHandle;
  command: MapFinderCommand | null;
}) {
  const handled = useRef(command?.seq ?? 0);
  const found = useRef(new Map<string, MapResult>());
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
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
          await installMap(game, sha1, await downloadMap(sha1));
          exports.ra2_finder_added(sha1, 1);
        } catch (reason) {
          exports.ra2_finder_added(sha1, 0);
          exports.ra2_finder_note(
            `${found.current.get(sha1)?.name ?? "The map"}: ${message(reason)}`,
          );
        }
      })();
    }
  }, [command, game]);

  return null;
}
