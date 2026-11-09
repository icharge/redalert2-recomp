import { ArchiveIcon, FileIcon, ReloadIcon, TrashIcon } from "@radix-ui/react-icons";
import { useEffect, useRef, useState } from "react";
import { EDITION_BRAND } from "../../../components/brand";
import { formatBytes } from "../../../components/format";
import type { ActiveInstall } from "../../../storage/active-install";
import type { InstallPart, PartCounts, PartSizes } from "../../../storage/install-parts";
import type { SaveEntry } from "../../../storage/save-library";
import type { GameActions } from "../GameScreen";
import type { Estimate } from "../Shell";
import page from "../Page.module.css";
import { RemoveDialog } from "./RemoveDialog";
import { SavedGamesDialog, type SavesGroup } from "./SavedGamesDialog";
import styles from "./ManagePanel.module.css";

export type ManageActions = Pick<
  GameActions,
  | "listSaves"
  | "onDownloadSave"
  | "onRemoveSaves"
  | "onDownloadSaves"
  | "onImportSaves"
  | "measureParts"
  | "countParts"
  | "onRemoveParts"
  | "onReinstall"
>;

export interface ManagePanelProps {
  install: ActiveInstall;
  estimate: Estimate;
  /** bumped after a removal: the panel measures and lists again */
  refresh: number;
  actions: ManageActions;
  onBrowse(): void;
  /** after every removal, whether or not it went through */
  onChanged(): void;
}

interface Measure {
  sizes: PartSizes | null;
  counts: PartCounts | null;
  groups: SavesGroup[];
  /** the browser's storage estimate; null when there is none */
  usage: { usage: number; quota: number } | null;
}

const NOTHING: Measure = { sizes: null, counts: null, groups: [], usage: null };

const gb = (bytes: number) => {
  const value = bytes / 1e9;
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
};

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/** The right column's panel: the storage breakdown, and the actions that manage the installed game. */
export function ManagePanel({
  install,
  estimate,
  refresh,
  actions,
  onBrowse,
  onChanged,
}: ManagePanelProps) {
  const [measure, setMeasure] = useState<Measure>(NOTHING);
  const [savesOpen, setSavesOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [askingReinstall, setAskingReinstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // the effect reads the actions as they are now, without re-measuring each time they are new objects
  const latest = useRef(actions);
  latest.current = actions;

  useEffect(() => {
    let live = true;
    const current = latest.current;
    void (async () => {
      const [sizes, counts, groups, usage] = await Promise.all([
        current.measureParts(install),
        current.countParts(install),
        Promise.all(
          install.editions.map(async (game) => ({ game, saves: await current.listSaves(game) })),
        ),
        estimate()
          .then((value) => {
            const numbers = { usage: value.usage ?? 0, quota: value.quota ?? 0 };
            return numbers.quota > 0 ? numbers : null;
          })
          .catch(() => null),
      ]);
      if (live) setMeasure({ sizes, counts, groups, usage });
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [install, estimate, refresh]);

  const { sizes, counts, groups, usage } = measure;
  const savedCount = groups.reduce((sum, group) => sum + group.saves.length, 0);
  const percent = usage ? Math.min(100, Math.round((usage.usage / usage.quota) * 100)) : 0;

  // the storage the game's parts take; what is left of the browser's usage is cache and other
  const partsBytes = sizes ? sizes.game + sizes.mods + sizes.maps + sizes.saves : 0;
  const otherBytes = usage && sizes ? Math.max(0, usage.usage - partsBytes) : 0;
  const breakdown: { key: string; label: string; bytes: number }[] = sizes
    ? [
        { key: "game", label: "Game content", bytes: sizes.game },
        { key: "mods", label: "Mods", bytes: sizes.mods },
        { key: "maps", label: "Custom maps", bytes: sizes.maps },
        { key: "saves", label: "Saved games", bytes: sizes.saves },
        ...(otherBytes > 0 ? [{ key: "other", label: "Cache and other", bytes: otherBytes }] : []),
      ]
    : [];

  const editionTitles = install.editions.map((game) => EDITION_BRAND[game.id].title);

  // a failure is shown here; a removal also refreshes the panel, whatever happened
  async function attempt(work: () => Promise<void>, fallback: string) {
    setBusy(true);
    setFailure(null);
    try {
      await work();
    } catch (cause) {
      setFailure(messageOf(cause, fallback));
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  return (
    <section className={page.panel} aria-labelledby="game-manage">
      <h2 id="game-manage" className={page.label}>
        MANAGE GAME
      </h2>

      <div className={styles.storage}>
        <div className={styles.storageHead}>
          <span className={styles.storageName}>Browser storage</span>
          {usage && (
            <span className={page.status}>
              {gb(usage.usage)} GB of {gb(usage.quota)} GB
            </span>
          )}
        </div>
        {usage && (
          <div
            role="progressbar"
            aria-label="Browser storage used"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className={styles.bar}
          >
            <div style={{ width: `${Math.max(percent, 1)}%` }} />
          </div>
        )}
        <ul className={styles.breakdown}>
          {breakdown.map((row) => (
            <li key={row.key} className={styles.breakRow}>
              <span>{row.label}</span>
              <span className={styles.breakSize}>{formatBytes(row.bytes)}</span>
            </li>
          ))}
        </ul>
      </div>

      <ul className={styles.actions}>
        <li>
          <button type="button" className={styles.action} onClick={onBrowse}>
            <FileIcon aria-hidden="true" />
            <span>BROWSE FILES</span>
          </button>
        </li>

        <li>
          {askingReinstall ? (
            <div role="group" aria-label="Confirm reinstall" className={styles.ask}>
              <span className={styles.askText}>Reinstall? Saves, settings and mods are kept.</span>
              <button
                type="button"
                className={page.primary}
                disabled={busy}
                onClick={() => {
                  setAskingReinstall(false);
                  void attempt(
                    () => actions.onReinstall(install),
                    "The game could not be reinstalled.",
                  );
                }}
              >
                REINSTALL
              </button>
              <button
                type="button"
                className={page.outline}
                disabled={busy}
                onClick={() => setAskingReinstall(false)}
              >
                CANCEL
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.action}
              disabled={busy}
              onClick={() => setAskingReinstall(true)}
            >
              <ReloadIcon aria-hidden="true" />
              <span>REINSTALL GAME</span>
            </button>
          )}
        </li>

        <li>
          <button
            type="button"
            className={styles.action}
            disabled={busy}
            onClick={() => setSavesOpen(true)}
          >
            <ArchiveIcon aria-hidden="true" />
            <span>SAVED GAMES…</span>
            {sizes && (
              <span className={styles.actionCount}>
                {savedCount === 0 ? "None" : `${savedCount} ${savedCount === 1 ? "save" : "saves"}`}
              </span>
            )}
          </button>
        </li>

        <li>
          <button
            type="button"
            className={styles.actionDanger}
            disabled={busy}
            onClick={() => setRemoveOpen(true)}
          >
            <TrashIcon aria-hidden="true" />
            <span>REMOVE…</span>
          </button>
        </li>
      </ul>

      {failure && (
        <p role="alert" className={page.failure}>
          {failure}
        </p>
      )}

      <SavedGamesDialog
        open={savesOpen}
        onOpenChange={setSavesOpen}
        groups={groups}
        onDownload={(game, save: SaveEntry) => actions.onDownloadSave(game, save)}
        onRemove={(game, saves) => actions.onRemoveSaves(game, saves).finally(() => onChanged())}
        onDownloadZip={(game) => actions.onDownloadSaves(game)}
        onImportZip={(game, zip) => actions.onImportSaves(game, zip)}
      />

      <RemoveDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        editions={editionTitles}
        sizes={sizes}
        counts={counts}
        onRemove={(parts: InstallPart[]) =>
          actions.onRemoveParts(install, parts).finally(() => onChanged())
        }
      />
    </section>
  );
}
