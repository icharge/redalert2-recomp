import { Dialog } from "@radix-ui/themes";
import { Cross2Icon, DownloadIcon, TrashIcon } from "@radix-ui/react-icons";
import { useEffect, useRef, useState } from "react";
import { EDITION_BRAND } from "../../../components/brand";
import { formatBytes } from "../../../components/format";
import type { GameRecord } from "../../../storage/manifest";
import type { SaveEntry } from "../../../storage/save-library";
import { EditionIcon } from "../Shell";
import pageStyles from "../Page.module.css";
import styles from "./SavedGamesDialog.module.css";

/** One edition's saves, in the rail's order. */
export interface SavesGroup {
  game: GameRecord;
  saves: SaveEntry[];
}

export interface SavedGamesDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** one per edition, in rail order */
  groups: SavesGroup[];
  onDownload(game: GameRecord, save: SaveEntry): Promise<void>;
  onRemove(game: GameRecord, saves: SaveEntry[]): Promise<void>;
  /** the existing onDownloadSaves; the message it resolves to is shown */
  onDownloadZip(game: GameRecord): Promise<string>;
  /** the existing onImportSaves; the message it resolves to is shown */
  onImportZip(game: GameRecord, zip: File): Promise<string>;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** The save's description, else its file name without ".sav". */
export function saveTitle(save: SaveEntry): string {
  return save.info?.description || save.name.replace(/\.sav$/i, "");
}

/** The scenario and when it was saved, e.g. "Allied campaign · Mission 5 · Saved 2 Nov 2026, 21:14". */
export function saveDetails(save: SaveEntry): string {
  // a save the game wrote without a time has none to show: 0 or not a number
  const usable = (time: number | undefined) => (time && Number.isFinite(time) ? time : null);
  const when = usable(save.info?.savedAt) ?? usable(save.modified);
  return [save.info?.scenario, when === null ? "" : `Saved ${dateFormat.format(when)}`]
    .filter(Boolean)
    .join(" · ");
}

function countLabel(count: number): string {
  if (count === 0) return "No saves";
  return count === 1 ? "1 save" : `${count} saves`;
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/**
 * The saves this browser keeps, by game. Presentational: every change goes
 * out through a prop, and a confirmation is asked inline (no nested dialog).
 */
export function SavedGamesDialog({
  open,
  onOpenChange,
  groups,
  onDownload,
  onRemove,
  onDownloadZip,
  onImportZip,
}: SavedGamesDialogProps) {
  // "<game id>/<save name>" of the row asking to be removed
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const fileInputs = useRef(new Map<string, HTMLInputElement>());

  // however the dialog closes, an open confirmation and its messages go with it
  useEffect(() => {
    if (open) return;
    setConfirming(null);
    setConfirmingAll(false);
    setError(null);
    setStatus(null);
  }, [open]);

  const total = groups.reduce((count, group) => count + group.saves.length, 0);

  async function attempt(action: () => Promise<void>, fallback: string, onDone?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone?.();
    } catch (cause) {
      setError(messageOf(cause, fallback));
    } finally {
      setBusy(false);
    }
  }

  const removeOne = (group: SavesGroup, save: SaveEntry) =>
    attempt(
      () => onRemove(group.game, [save]),
      "The save could not be removed.",
      () => setConfirming(null),
    );

  const removeAll = () =>
    attempt(
      async () => {
        for (const group of groups) {
          if (group.saves.length > 0) await onRemove(group.game, group.saves);
        }
      },
      "The saves could not be removed.",
      () => setConfirmingAll(false),
    );

  const downloadOne = (group: SavesGroup, save: SaveEntry) =>
    attempt(() => onDownload(group.game, save), "The save could not be downloaded.");

  const downloadZip = (group: SavesGroup) =>
    attempt(async () => {
      setStatus(await onDownloadZip(group.game));
    }, "The saves could not be zipped.");

  const importZip = (group: SavesGroup, file: File) =>
    attempt(async () => {
      setStatus(await onImportZip(group.game, file));
    }, "The zip could not be imported.");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="720px" className={`${pageStyles.dialog} ${styles.content}`}>
        <div className={styles.body}>
          <div className={styles.header}>
            <div className={styles.headText}>
              <Dialog.Title className={pageStyles.dialogTitle}>SAVED GAMES</Dialog.Title>
              <Dialog.Description size="2" className={styles.lede}>
                The saves in this browser, by game. Download one to keep a copy, or remove it.
              </Dialog.Description>
            </div>
            <Dialog.Close>
              <button type="button" className={styles.close} aria-label="Close">
                <Cross2Icon />
              </button>
            </Dialog.Close>
          </div>

          <div className={styles.groups}>
            {groups.map((group) => {
              const { game, saves } = group;
              const title = EDITION_BRAND[game.id].title;
              return (
                <section key={game.id} aria-label={`${title} saves`} className={styles.group}>
                  <div className={styles.groupHead}>
                    <EditionIcon game={game} className={styles.groupIcon} />
                    <h3 className={styles.groupName}>{title.toUpperCase()}</h3>
                    <span className={styles.count}>{countLabel(saves.length)}</span>
                    <button
                      type="button"
                      className={pageStyles.quiet}
                      disabled={busy || saves.length === 0}
                      onClick={() => void downloadZip(group)}
                    >
                      DOWNLOAD .ZIP
                    </button>
                    <button
                      type="button"
                      className={pageStyles.quiet}
                      disabled={busy}
                      onClick={() => fileInputs.current.get(game.id)?.click()}
                    >
                      IMPORT .ZIP
                    </button>
                    <input
                      ref={(element) => {
                        if (element) fileInputs.current.set(game.id, element);
                        else fileInputs.current.delete(game.id);
                      }}
                      type="file"
                      accept=".zip"
                      hidden
                      aria-label={`Import saves for ${title}`}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        // so the same zip can be picked again
                        event.target.value = "";
                        if (file) void importZip(group, file);
                      }}
                    />
                  </div>
                  {saves.length > 0 && (
                    <ul className={styles.list}>
                      {saves.map((save) => {
                        const key = `${game.id}/${save.name}`;
                        const asking = confirming === key;
                        return (
                          <li key={save.name} className={asking ? styles.rowAsking : styles.row}>
                            <div className={styles.text}>
                              <span className={styles.rowTitle}>{saveTitle(save)}</span>
                              <span className={styles.details}>{saveDetails(save)}</span>
                              <span className={styles.file}>{save.name}</span>
                            </div>
                            {asking ? (
                              <div role="group" aria-label="Confirm removal" className={styles.ask}>
                                <span className={styles.question}>Remove this save?</span>
                                <button
                                  type="button"
                                  className={pageStyles.primary}
                                  disabled={busy}
                                  onClick={() => void removeOne(group, save)}
                                >
                                  REMOVE
                                </button>
                                <button
                                  type="button"
                                  className={pageStyles.outline}
                                  onClick={() => setConfirming(null)}
                                >
                                  KEEP
                                </button>
                              </div>
                            ) : (
                              <div className={styles.actions}>
                                <span className={styles.size}>{formatBytes(save.size)}</span>
                                <button
                                  type="button"
                                  className={styles.iconButton}
                                  aria-label={`Download ${save.name}`}
                                  disabled={busy}
                                  onClick={() => void downloadOne(group, save)}
                                >
                                  <DownloadIcon />
                                </button>
                                <button
                                  type="button"
                                  className={styles.iconButtonRemove}
                                  aria-label={`Remove ${save.name}`}
                                  disabled={busy}
                                  onClick={() => setConfirming(key)}
                                >
                                  <TrashIcon />
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>

          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {status && (
            <p role="status" className={styles.status}>
              {status}
            </p>
          )}

          {confirmingAll ? (
            <div role="group" aria-label="Confirm remove all" className={styles.allAsk}>
              <span className={styles.allText}>
                <span className={styles.allQuestion}>
                  {total === 1 ? "Remove 1 save?" : `Remove all ${total} saves?`}
                </span>
                <span className={styles.allHint}>
                  They can't be brought back. Download them first to keep them.
                </span>
              </span>
              <button
                type="button"
                className={pageStyles.primary}
                disabled={busy}
                onClick={() => void removeAll()}
              >
                REMOVE ALL
              </button>
              <button
                type="button"
                className={pageStyles.outline}
                onClick={() => setConfirmingAll(false)}
              >
                CANCEL
              </button>
            </div>
          ) : (
            <div className={styles.footer}>
              <button
                type="button"
                className={pageStyles.outline}
                disabled={total === 0 || busy}
                onClick={() => setConfirmingAll(true)}
              >
                REMOVE ALL
              </button>
              <Dialog.Close>
                <button type="button" className={pageStyles.primary}>
                  DONE
                </button>
              </Dialog.Close>
            </div>
          )}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
