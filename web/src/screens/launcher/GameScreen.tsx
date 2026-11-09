import { AlertDialog } from "@radix-ui/themes";
import { useMemo, useRef, useState } from "react";
import { EDITION_BRAND } from "../../components/brand";
import { FileExplorer } from "../../components/FileExplorer";
import { formatBytes } from "../../components/format";
import { KeyArt } from "../../components/KeyArt";
import type { ActiveInstall } from "../../storage/active-install";
import { importedFileSource, type ReadOnlyFileSource } from "../../storage/file-browser";
import type { BuildInfo } from "../../storage/install";
import type { PartCounts, PartSizes, InstallPart } from "../../storage/install-parts";
import type { FileEntry, GameRecord, InstallationRecord } from "../../storage/manifest";
import type { SaveEntry } from "../../storage/save-library";
import { editionReadiness, needsResume, playStatus } from "./readiness";
import { EditionIcon, type Estimate } from "./Shell";
import { ManagePanel } from "./game/ManagePanel";
import page from "./Page.module.css";
import styles from "./GameScreen.module.css";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
// some browsers (and insecure pages) have no storage estimate: then no figure is shown
const browserEstimate: Estimate = async () => (await navigator.storage?.estimate?.()) ?? {};

export interface GameActions {
  onResume(slot: number): void;
  /** the Install screen, when nothing is installed */
  onImport(): void;
  /** forget the install and delete what only it reads; resolves when done */
  onRemove(installation: InstallationRecord): Promise<void>;
  /** hands the player a zip of the edition's saved games; says what happened */
  onDownloadSaves(game: GameRecord): Promise<string>;
  /** takes saved games from a zip; says what happened */
  onImportSaves(game: GameRecord, zip: File): Promise<string>;
  /**
   * The saved games of one edition, newest first. With the install's editions, a folder save they
   * share is listed once, under the first.
   */
  listSaves(game: GameRecord, editions?: GameRecord[]): Promise<SaveEntry[]>;
  /** downloads one save under its own name */
  onDownloadSave(game: GameRecord, save: SaveEntry): Promise<void>;
  /** removes saves from one edition, both copies; a shared folder save goes from every edition */
  onRemoveSaves(game: GameRecord, saves: SaveEntry[], editions?: GameRecord[]): Promise<void>;
  /** how much of each part the install holds, in bytes */
  measureParts(install: ActiveInstall): Promise<PartSizes>;
  /** how many mods, maps and saves the install holds */
  countParts(install: ActiveInstall): Promise<PartCounts>;
  /** removes the ticked parts; all five remove the whole install */
  onRemoveParts(install: ActiveInstall, parts: InstallPart[]): Promise<void>;
  /** marks the game files not copied, then opens Resume import for the slot */
  onReinstall(install: ActiveInstall): Promise<void>;
  /** what BROWSE FILES shows: a source that can change the files, or by default a read-only view */
  browseSource?(installation: InstallationRecord, games: GameRecord[]): ReadOnlyFileSource;
  estimate?: Estimate;
}

export function installName(install: ActiveInstall): string {
  const { installation, editions } = install;
  return (
    installation.displayName ??
    // with two games the install is the folder, not whichever game was listed first
    (editions.length === 1 ? editions[0]?.title : undefined) ??
    installation.name
  );
}

/** Copies left from when the launcher kept several installs: the player can delete them, after a confirm. */
function OlderCopies({ others, onDelete }: { others: ActiveInstall[]; onDelete(): void }) {
  const bytes = others.reduce(
    (sum, other) => sum + other.editions.reduce((total, game) => total + game.bytes, 0),
    0,
  );
  const count = others.length === 1 ? "1 older copy" : `${others.length} older copies`;
  return (
    <section className={`${page.panel} ${styles.wide}`} aria-labelledby="game-older">
      <h2 id="game-older" className={page.label}>
        OLDER COPIES
      </h2>
      <div className={styles.line}>
        <span className={page.warn}>
          {count} of the game take {formatBytes(bytes)}.
        </span>
        <AlertDialog.Root>
          <AlertDialog.Trigger>
            <button type="button" className={page.quiet}>
              DELETE THEM
            </button>
          </AlertDialog.Trigger>
          <AlertDialog.Content maxWidth="440px" className={page.dialog}>
            <AlertDialog.Title className={page.dialogTitle}>
              DELETE {count.toUpperCase()}?
            </AlertDialog.Title>
            <AlertDialog.Description size="2">
              Deletes {formatBytes(bytes)} from this browser. The game you play is kept, and so are
              saved games and settings.
            </AlertDialog.Description>
            <div className={page.dialogActions}>
              <AlertDialog.Cancel>
                <button type="button" className={page.quiet}>
                  KEEP THEM
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action>
                <button type="button" className={page.primary} onClick={onDelete}>
                  DELETE
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Root>
      </div>
    </section>
  );
}

/** The installed game: its editions, files, saved games and storage. One install only. */
export function GameScreen({
  install,
  edition,
  others,
  build,
  onResume,
  onImport,
  onRemove,
  browseSource,
  estimate = browserEstimate,
  ...manage
}: GameActions & {
  install: ActiveInstall | null;
  /** the edition chosen in the rail: the one the KeyArt shows */
  edition: GameRecord | null;
  /** installs left from the slot system; only offered for deletion */
  others: ActiveInstall[];
  build?: BuildInfo;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  // bumped after a removal: the Manage panel measures and lists again
  const [removed, setRemoved] = useState(0);

  // The source keeps its own copy of the record and the widget is built once per opening, so it must not
  // follow `browseSource`, which is a new function on every render.
  const latest = useRef({ install, browseSource });
  latest.current = { install, browseSource };
  const source = useMemo(() => {
    const current = latest.current.install;
    if (!browsing || !current) return null;
    const first = current.editions[0];
    return (
      latest.current.browseSource?.(current.installation, current.editions) ??
      (first ? importedFileSource(first) : null)
    );
  }, [browsing]);

  async function remove(installation: InstallationRecord) {
    try {
      await onRemove(installation);
      setRemoved((n) => n + 1);
      setFailure(null);
    } catch (error) {
      setFailure(message(error));
    }
  }

  if (!install) {
    return (
      <div className={styles.screen}>
        <KeyArt edition={null} dim={0.78} />
        <div className={page.page}>
          <h1 className={page.title}>GAME</h1>
          <div className={page.empty}>
            <p>No game installed yet.</p>
            <button type="button" className={page.primary} onClick={onImport}>
              INSTALL THE GAME
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { installation, editions } = install;
  const slot = installation.slot;
  // the files still copied, each once: a file two editions share is listed by both, with the same home
  const copied = new Map<string, FileEntry>();
  for (const game of editions) {
    for (const [name, entry] of Object.entries(game.files)) {
      if (entry.done) copied.set(`${entry.home}/${name}`, entry);
    }
  }
  const bytes = [...copied.values()].reduce((sum, file) => sum + file.size, 0);
  const fileCount = copied.size;
  const moviesMissing = editions.some(
    (game) => game.complete && editionReadiness(game, build)?.moviesMissing,
  );

  return (
    <div className={styles.screen}>
      <KeyArt edition={edition?.id ?? null} dim={0.78} />
      <div className={page.page}>
        <div className={page.header}>
          <h1 className={page.title}>GAME</h1>
        </div>

        {failure && (
          <p role="alert" className={page.failure}>
            {failure}
          </p>
        )}

        <div className={styles.grid}>
          <section className={`${page.panel} ${styles.wide}`} aria-labelledby="game-installed">
            <div className={styles.panelHead}>
              <h2 id="game-installed" className={page.label}>
                INSTALLED
              </h2>
              <span className={page.status}>
                {formatBytes(bytes)} · {fileCount} files
              </span>
            </div>
            <ul className={styles.editions}>
              {editions.map((game) => {
                const status = playStatus(game, build);
                return (
                  <li key={game.id} className={styles.edition}>
                    <EditionIcon game={game} />
                    <span className={styles.editionName}>{EDITION_BRAND[game.id].title}</span>
                    <span className={styles.state}>
                      <span
                        className={status.ready ? styles.dotReady : styles.dotWait}
                        aria-hidden="true"
                      />
                      {status.text}
                    </span>
                  </li>
                );
              })}
            </ul>
            {moviesMissing && (
              <div className={styles.line}>
                <span className={page.warn}>Movies not installed</span>
                <button type="button" className={page.quiet} onClick={() => onResume(slot)}>
                  ADD MOVIES
                </button>
              </div>
            )}
            {needsResume(install) && (
              <div className={styles.actions}>
                <button type="button" className={page.quiet} onClick={() => onResume(slot)}>
                  RESUME INSTALL
                </button>
              </div>
            )}
          </section>

          <div className={styles.side}>
            <ManagePanel
              install={install}
              estimate={estimate}
              refresh={removed}
              actions={manage}
              onBrowse={() => setBrowsing(true)}
              onChanged={() => setRemoved((n) => n + 1)}
            />
          </div>

          {others.length > 0 && (
            <OlderCopies
              others={others}
              onDelete={() =>
                void (async () => {
                  for (const other of others) await remove(other.installation);
                })()
              }
            />
          )}
        </div>
      </div>
      {source && <FileExplorer source={source} onClose={() => setBrowsing(false)} />}
    </div>
  );
}
