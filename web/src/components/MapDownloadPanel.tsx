import { Dialog } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import type { GameHandle } from "../game/loader";
import { loadDownloadedMaps } from "../storage/downloaded-maps";
import { downloadMap, installMap, searchMaps, type MapResult } from "../game/mapdb";
import { gameDialogButtonClass, GameDialogChrome } from "./GameDialogChrome";
import styles from "./MapDownloadPanel.module.css";

type Progress = Record<string, "busy" | "done" | string>;

/**
 * "Find maps": search CnCNet's map database and download a Yuri's Revenge map into the game
 * (src/game/mapdb.ts). The game's own Find Maps button, under Random Map on Customize Battle, opens
 * it (the mapFinder event, counted in `openRequest`); the new map is then in the list at once and
 * kept in this browser.
 */
export function MapDownloadPanel({
  game,
  visible,
  openRequest,
}: {
  game: GameHandle;
  /** a map screen is open */
  visible: boolean;
  /** how many times the game's Find Maps button was pressed */
  openRequest: number;
}) {
  const [open, setOpen] = useState(false);
  const handled = useRef(openRequest);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MapResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Progress>({});
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);
  // each press of the game's button opens the panel; a press from before this mounted does not
  useEffect(() => {
    if (openRequest === handled.current) return;
    handled.current = openRequest;
    if (visible) setOpen(true);
  }, [openRequest, visible]);
  // maps kept from an earlier visit show as added
  useEffect(() => {
    void loadDownloadedMaps().then((kept) =>
      setProgress((now) => ({ ...Object.fromEntries(kept.map((m) => [m.sha1, "done"])), ...now })),
    );
  }, []);

  if (!visible) return null;

  const search = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setSearching(true);
    setError("");
    try {
      setResults(await searchMaps(query.trim(), controller.signal));
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (abort.current === controller) setSearching(false);
    }
  };

  const download = async (map: MapResult) => {
    setProgress((now) => ({ ...now, [map.sha1]: "busy" }));
    try {
      await installMap(game, map.sha1, await downloadMap(map.sha1));
      setProgress((now) => ({ ...now, [map.sha1]: "done" }));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setProgress((now) => ({ ...now, [map.sha1]: message }));
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Content className={styles.content} aria-describedby={undefined}>
        <GameDialogChrome title="Find Maps">
          <div className={styles.stack}>
            <p className={styles.note}>
              Yuri&apos;s Revenge maps from CnCNet&apos;s map database. Unreviewed fan-made files.
              Downloaded maps are kept in this browser and listed every time you play.
            </p>
            <form
              className={styles.search}
              onSubmit={(event) => {
                event.preventDefault();
                void search();
              }}
            >
              <input
                className={styles.input}
                aria-label="Search maps"
                placeholder="Map name"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
              />
              <button type="submit" className={gameDialogButtonClass} disabled={searching}>
                Search
              </button>
            </form>
            {error && (
              <p className={`${styles.status} ${styles.error}`} role="alert">
                {error}
              </p>
            )}
            {searching && <p className={styles.status}>Searching…</p>}
            {results && !searching && results.length === 0 && (
              <p className={styles.status}>No maps found.</p>
            )}
            {results && results.length > 0 && (
              <ul className={styles.results} aria-label="Maps found">
                {results.map((map) => {
                  const state = progress[map.sha1];
                  return (
                    <li key={map.sha1} className={styles.row}>
                      <span className={styles.name}>
                        {map.name}
                        {state && state !== "busy" && state !== "done" && (
                          <span className={`${styles.status} ${styles.error}`}> — {state}</span>
                        )}
                        {state === "done" && (
                          <span className={`${styles.status} ${styles.done}`}>
                            {" "}
                            — added to the list
                          </span>
                        )}
                      </span>
                      {map.incomplete && <span className={styles.tag}>UNREVIEWED</span>}
                      <button
                        type="button"
                        className={gameDialogButtonClass}
                        disabled={state === "busy" || state === "done"}
                        onClick={() => void download(map)}
                      >
                        {state === "busy" ? "…" : state === "done" ? "Added" : "Download"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className={styles.footer}>
              <Dialog.Close>
                <button type="button" className={gameDialogButtonClass}>
                  Close
                </button>
              </Dialog.Close>
            </div>
          </div>
        </GameDialogChrome>
      </Dialog.Content>
    </Dialog.Root>
  );
}
