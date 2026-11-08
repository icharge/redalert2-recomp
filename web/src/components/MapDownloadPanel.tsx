import { Dialog } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import type { GameHandle } from "../game/loader";
import { loadDownloadedMaps } from "../storage/downloaded-maps";
import { downloadMap, installMap, searchMaps, type MapResult } from "../game/mapdb";
import styles from "./MapDownloadPanel.module.css";

type Progress = Record<string, "busy" | "done" | string>;

/**
 * "Get maps": search CnCNet's map database and download a Yuri's Revenge map into the game
 * (src/game/mapdb.ts). Shown while a map screen is open (the game's mapSearch event); the new
 * map is then in the list at once. Prototype: maps are not kept across a reload.
 */
export function MapDownloadPanel({ game, visible }: { game: GameHandle; visible: boolean }) {
  const [open, setOpen] = useState(false);
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
      <Dialog.Trigger>
        <button type="button" className={styles.trigger}>
          GET MAPS
        </button>
      </Dialog.Trigger>
      <Dialog.Content className={styles.panel} aria-describedby={undefined}>
        <Dialog.Title className={styles.title}>Get maps</Dialog.Title>
        <p className={styles.note}>
          Yuri&apos;s Revenge maps from CnCNet&apos;s map database. Unreviewed fan-made files; a
          downloaded maps are kept in this browser and listed every time you play.
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
          <button type="submit" className={styles.button} disabled={searching}>
            SEARCH
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
                    className={styles.button}
                    disabled={state === "busy" || state === "done"}
                    onClick={() => void download(map)}
                  >
                    {state === "busy" ? "…" : state === "done" ? "ADDED" : "DOWNLOAD"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
