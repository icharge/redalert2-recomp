import { AlertDialog } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { EDITION_BRAND } from "../../components/brand";
import { FileExplorer } from "../../components/FileExplorer";
import { formatBytes } from "../../components/format";
import { KeyArt } from "../../components/KeyArt";
import type { ActiveInstall } from "../../storage/active-install";
import { importedFileSource, type ReadOnlyFileSource } from "../../storage/file-browser";
import type { BuildInfo } from "../../storage/install";
import type { GameRecord, InstallationRecord } from "../../storage/manifest";
import { editionReadiness, needsResume, playStatus } from "./readiness";
import { EditionIcon, type Estimate } from "./Shell";
import page from "./Page.module.css";
import styles from "./GameScreen.module.css";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
// some browsers (and insecure pages) have no storage estimate: then no figure is shown
const browserEstimate: Estimate = async () => (await navigator.storage?.estimate?.()) ?? {};

export interface GameActions {
  onResume(slot: number): void;
  /** the Install screen, for another copy */
  onImport(): void;
  onRenameInstallation?(installation: InstallationRecord, displayName: string): Promise<void>;
  /** forget the install and delete what only it reads; resolves when done */
  onRemove(installation: InstallationRecord): Promise<void>;
  /** hands the player a zip of the edition's saved games; says what happened */
  onDownloadSaves(game: GameRecord): Promise<string>;
  /** takes saved games from a zip; says what happened */
  onImportSaves(game: GameRecord, zip: File): Promise<string>;
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

function StoragePanel({ estimate, refresh }: { estimate: Estimate; refresh: number }) {
  const [numbers, setNumbers] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    let live = true;
    estimate()
      .then((value) => {
        if (live) setNumbers({ usage: value.usage ?? 0, quota: value.quota ?? 0 });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [estimate, refresh]);
  if (!numbers || numbers.quota === 0) return null;
  const percent = Math.min(100, Math.round((numbers.usage / numbers.quota) * 100));
  const gb = (bytes: number) => {
    const value = bytes / 1e9;
    return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
  };
  return (
    <section className={page.panel} aria-labelledby="game-storage">
      <h2 id="game-storage" className={page.label}>
        BROWSER STORAGE
      </h2>
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
      <p className={page.status}>
        {gb(numbers.usage)} GB of {gb(numbers.quota)} GB
      </p>
    </section>
  );
}

function RemoveButton({
  install,
  label,
  className,
  children,
  onRemove,
}: {
  install: ActiveInstall;
  label?: string;
  className?: string;
  children: ReactNode;
  onRemove(): void;
}) {
  const name = installName(install);
  const bytes = install.editions.reduce((sum, game) => sum + game.bytes, 0);
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger>
        <button type="button" className={className} aria-label={label} title={label}>
          {children}
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Content maxWidth="440px" className={page.dialog}>
        <AlertDialog.Title className={page.dialogTitle}>
          REMOVE {name.toUpperCase()}?
        </AlertDialog.Title>
        <AlertDialog.Description size="2">
          Deletes {formatBytes(bytes)} from this browser. Your own folder is not touched. Saved
          games and settings are kept.
        </AlertDialog.Description>
        <div className={page.dialogActions}>
          <AlertDialog.Cancel>
            <button type="button" className={page.quiet}>
              KEEP IT
            </button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <button type="button" className={page.primary} onClick={onRemove}>
              REMOVE
            </button>
          </AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

/** The active install: its editions, files, saved games and storage, and any other installs. */
export function GameScreen({
  install,
  edition,
  others,
  build,
  onUse,
  onResume,
  onImport,
  onRenameInstallation,
  onRemove,
  onDownloadSaves,
  onImportSaves,
  browseSource,
  estimate = browserEstimate,
}: GameActions & {
  install: ActiveInstall | null;
  /** the edition chosen in the rail: the one SAVED GAMES works on */
  edition: GameRecord | null;
  others: ActiveInstall[];
  build?: BuildInfo;
  onUse(slot: number): void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [localName, setLocalName] = useState<{ slot: number; name: string } | null>(null);
  const [removed, setRemoved] = useState(0);
  const savesInput = useRef<HTMLInputElement>(null);

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

  async function say(work: Promise<string>) {
    try {
      setNotice(await work);
      setFailure(null);
    } catch (error) {
      setFailure(message(error));
      setNotice(null);
    }
  }

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
  const name = localName?.slot === slot ? localName.name : installName(install);
  const bytes = editions.reduce((sum, game) => sum + game.bytes, 0);
  const fileCount = editions.reduce((sum, game) => sum + Object.keys(game.files).length, 0);
  const moviesMissing = editions.some(
    (game) => game.complete && editionReadiness(game, build)?.moviesMissing,
  );
  const savesGame = editions.find((game) => game.id === edition?.id) ?? editions.at(-1) ?? null;

  async function saveName(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (!next) {
      setFailure("Enter a name for this install.");
      return;
    }
    try {
      await onRenameInstallation?.(installation, next);
      setLocalName({ slot, name: next });
      setEditing(false);
      setFailure(null);
    } catch (error) {
      setFailure(message(error));
    }
  }

  return (
    <div className={styles.screen}>
      <KeyArt edition={edition?.id ?? null} dim={0.78} />
      <div className={page.page}>
        <div className={page.header}>
          {editing ? (
            <form className={styles.nameForm} onSubmit={(event) => void saveName(event)}>
              <input
                autoFocus
                aria-label="Installation name"
                className={styles.nameField}
                value={draft}
                maxLength={64}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setEditing(false);
                }}
              />
              <button type="submit" className={page.outline}>
                SAVE
              </button>
              <button type="button" className={page.quiet} onClick={() => setEditing(false)}>
                CANCEL
              </button>
            </form>
          ) : (
            <div className={styles.titleRow}>
              <h1 className={page.title}>{name}</h1>
              {onRenameInstallation && (
                <button
                  type="button"
                  className={page.icon}
                  aria-label={`Rename ${name}`}
                  title="Rename"
                  onClick={() => {
                    setDraft(name);
                    setEditing(true);
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    aria-hidden="true"
                  >
                    <path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z" />
                  </svg>
                </button>
              )}
            </div>
          )}
          <button type="button" className={page.quiet} onClick={onImport}>
            INSTALL ANOTHER COPY
          </button>
        </div>

        {(notice || failure) && (
          <p
            className={failure ? page.failure : `${page.status} ${page.ok}`}
            role={failure ? "alert" : "status"}
          >
            {failure ?? notice}
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
            <div className={styles.actions}>
              <button type="button" className={page.outline} onClick={() => setBrowsing(true)}>
                BROWSE FILES
              </button>
              {needsResume(install) && (
                <button type="button" className={page.quiet} onClick={() => onResume(slot)}>
                  RESUME INSTALL
                </button>
              )}
            </div>
          </section>

          <div className={styles.side}>
            {savesGame && (
              <section className={page.panel} aria-labelledby="game-saves">
                <h2 id="game-saves" className={page.label}>
                  SAVED GAMES
                  {editions.length > 1
                    ? ` · ${EDITION_BRAND[savesGame.id].title.toUpperCase()}`
                    : ""}
                </h2>
                <div className={styles.stack}>
                  <button
                    type="button"
                    className={page.quiet}
                    onClick={() => void say(onDownloadSaves(savesGame))}
                  >
                    DOWNLOAD .ZIP
                  </button>
                  <button
                    type="button"
                    className={page.quiet}
                    onClick={() => savesInput.current?.click()}
                  >
                    IMPORT .ZIP
                  </button>
                  <input
                    ref={savesInput}
                    type="file"
                    accept=".zip,application/zip"
                    tabIndex={-1}
                    className={page.visuallyHidden}
                    aria-label={`Saves for ${EDITION_BRAND[savesGame.id].title}`}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void say(onImportSaves(savesGame, file));
                    }}
                  />
                </div>
              </section>
            )}
            <StoragePanel estimate={estimate} refresh={removed} />
            <RemoveButton
              install={install}
              className={styles.remove}
              onRemove={() => void remove(installation)}
            >
              REMOVE GAME
            </RemoveButton>
          </div>

          {others.length > 0 && (
            <section className={`${page.panel} ${styles.wide}`} aria-labelledby="game-others">
              <h2 id="game-others" className={page.label}>
                OTHER INSTALLS
              </h2>
              <ul className={styles.editions}>
                {others.map((other) => (
                  <li key={other.installation.slot} className={styles.edition}>
                    <span className={styles.editionName}>{installName(other)}</span>
                    <span className={page.status}>
                      {other.editions.map((game) => EDITION_BRAND[game.id].short).join(" · ") ||
                        "Not finished"}
                    </span>
                    <button
                      type="button"
                      className={page.outline}
                      onClick={() => onUse(other.installation.slot)}
                    >
                      USE
                    </button>
                    <RemoveButton
                      install={other}
                      label={`Remove ${installName(other)}`}
                      className={page.icon}
                      onRemove={() => void remove(other.installation)}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        aria-hidden="true"
                      >
                        <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" />
                      </svg>
                    </RemoveButton>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
      {source && <FileExplorer source={source} onClose={() => setBrowsing(false)} />}
    </div>
  );
}
