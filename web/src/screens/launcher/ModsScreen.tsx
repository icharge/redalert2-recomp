import { AlertDialog, Dialog } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate } from "react-router";
import { EDITION_BRAND } from "../../components/brand";
import { formatBytes } from "../../components/format";
import { KeyArt } from "../../components/KeyArt";
import { writeActiveMod } from "../../storage/active-mod";
import type { GameSettingsDeps } from "../../storage/game-settings";
import { droppedSource, fileListSource, type FolderSource } from "../../storage/importer";
import type { GameId } from "../../storage/install";
import type { GameRecord, Manifest } from "../../storage/manifest";
import { importMod, listMods, removeMod, type ModRecord } from "../../storage/mods";
import type { CopyTarget } from "../../storage/opfs";
import page from "./Page.module.css";
import styles from "./ModsScreen.module.css";

type Filter = "all" | GameId;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const FolderIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.3"
    aria-hidden="true"
  >
    <path d="M1.5 4h5l1.5 1.5h6.5v8h-13z" />
  </svg>
);
const TrashIcon = () => (
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
);

function ModRow({
  game,
  mod,
  active,
  busy,
  onPlay,
  onRemove,
}: {
  game: GameRecord;
  mod: ModRecord;
  active: boolean;
  busy: boolean;
  onPlay(): void;
  onRemove(): void;
}) {
  const [showFiles, setShowFiles] = useState(false);
  const brand = EDITION_BRAND[game.id];
  return (
    <li className={styles.row} data-active={active || undefined}>
      <div className={styles.rowMain}>
        <span className={styles.thumb} aria-hidden="true" />
        <div className={styles.info}>
          <h2 className={styles.name}>{mod.name}</h2>
          <p className={styles.meta}>
            <span className={game.id === "ra2md" ? styles.yr : styles.ra2}>{brand.title}</span> ·{" "}
            {formatBytes(mod.bytes)}
          </p>
        </div>
        {active && <span className={styles.inUse}>IN USE</span>}
        <button type="button" className={page.outline} disabled={busy} onClick={onPlay}>
          PLAY
        </button>
        <button
          type="button"
          className={page.icon}
          aria-label={`Files of ${mod.name}`}
          title="Files"
          aria-expanded={showFiles}
          onClick={() => setShowFiles((now) => !now)}
        >
          <FolderIcon />
        </button>
        <AlertDialog.Root>
          <AlertDialog.Trigger>
            <button
              type="button"
              className={page.icon}
              aria-label={`Remove ${mod.name}`}
              title="Remove"
              disabled={busy}
            >
              <TrashIcon />
            </button>
          </AlertDialog.Trigger>
          <AlertDialog.Content maxWidth="440px" className={page.dialog}>
            <AlertDialog.Title className={page.dialogTitle}>
              REMOVE {mod.name.toUpperCase()}?
            </AlertDialog.Title>
            <AlertDialog.Description size="2">
              Deletes its {formatBytes(mod.bytes)} of files from this browser.
            </AlertDialog.Description>
            <div className={page.dialogActions}>
              <AlertDialog.Cancel>
                <button type="button" className={page.quiet}>
                  CANCEL
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
      </div>
      {showFiles && (
        <ul className={styles.files}>
          {mod.files.map((file) => (
            <li key={file.name}>
              <span>{file.name}</span>
              <span>{formatBytes(file.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Every mod of the install, by edition; the active one (`[mods] active`) is marked IN USE. */
export function ModsScreen({
  editions,
  edition = null,
  manifest,
  target,
  activeMods,
  onChanged,
  onEdition,
  gameSettingsDeps,
}: {
  editions: GameRecord[];
  /** the game selected in the rail; its art is the background */
  edition?: GameRecord | null;
  manifest: Manifest;
  target: CopyTarget;
  /** the active mod of each edition, keyed by `game.storage` ("" for Vanilla) */
  activeMods: Record<string, string>;
  onChanged(): void;
  /** selects the edition a mod's PLAY belongs to */
  onEdition?(game: GameRecord): void;
  gameSettingsDeps?: Partial<GameSettingsDeps>;
}) {
  const navigate = useNavigate();
  const [mods, setMods] = useState<Record<string, ModRecord[]>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pending = useRef<FolderSource | null>(null);
  const installFor = useRef<GameRecord | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const next: Record<string, ModRecord[]> = {};
    for (const game of editions) next[game.storage] = await listMods(manifest, game.storage);
    setMods(next);
  }, [editions, manifest]);

  useEffect(() => {
    refresh().catch((error) => setFailure(message(error)));
  }, [refresh]);

  if (!editions.length) {
    return (
      <div className={styles.screen}>
        <KeyArt edition={null} dim={0.78} />
        <div className={page.page}>
          <h1 className={page.title}>MODS</h1>
          <div className={page.empty}>
            <p>No game installed yet.</p>
            <Link to="/import" className={page.primary}>
              INSTALL THE GAME
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const shown = editions.filter((game) => filter === "all" || game.id === filter);
  const rows = shown.flatMap((game) => (mods[game.storage] ?? []).map((mod) => ({ game, mod })));

  /** The edition a new mod goes to without asking: the only one, or the one the filter shows. */
  function implicitEdition(): GameRecord | null {
    if (editions.length === 1) return editions[0] ?? null;
    return editions.find((game) => game.id === filter) ?? null;
  }

  async function install(game: GameRecord, source: FolderSource) {
    setBusy(true);
    setFailure(null);
    try {
      await importMod(source, game.storage, manifest, target, (done, total) =>
        setProgress(`Copying ${formatBytes(done)} of ${formatBytes(total)}`),
      );
      await refresh();
      onChanged();
    } catch (error) {
      setFailure(message(error));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function startInstall(source: FolderSource | null) {
    const game = implicitEdition();
    if (game) {
      if (source) void install(game, source);
      else {
        installFor.current = game;
        input.current?.click();
      }
      return;
    }
    pending.current = source;
    setChoosing(true);
  }

  function chosen(game: GameRecord) {
    setChoosing(false);
    const source = pending.current;
    pending.current = null;
    if (source) void install(game, source);
    else {
      installFor.current = game;
      input.current?.click();
    }
  }

  async function remove(game: GameRecord, mod: ModRecord) {
    setBusy(true);
    setFailure(null);
    try {
      await removeMod(manifest, target, game.storage, mod);
      if (activeMods[game.storage] === mod.name) await writeActiveMod(game, "", gameSettingsDeps);
      await refresh();
      onChanged();
    } catch (error) {
      setFailure(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function play(game: GameRecord, mod: ModRecord) {
    setFailure(null);
    try {
      await writeActiveMod(game, mod.name, gameSettingsDeps);
      onEdition?.(game);
      onChanged();
      navigate("/");
    } catch (error) {
      setFailure(message(error));
    }
  }

  async function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    try {
      const source = await droppedSource(event.dataTransfer.items);
      if (source) startInstall(source);
      else setFailure("Drop a folder, not a file.");
    } catch (error) {
      setFailure(message(error));
    }
  }

  const chips: { id: Filter; label: string }[] = [
    { id: "all", label: "ALL" },
    ...editions.map((game) => ({ id: game.id, label: EDITION_BRAND[game.id].title.toUpperCase() })),
  ];

  return (
    <div className={styles.screen}>
      <KeyArt edition={(edition ?? editions.at(-1))?.id ?? null} dim={0.78} />
      <div className={page.page}>
        <div className={page.header}>
          <div className={styles.heading}>
            <h1 className={page.title}>MODS</h1>
            {editions.length > 1 && (
              <div role="radiogroup" aria-label="Show mods for" className={page.chips}>
                {chips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    role="radio"
                    aria-checked={filter === chip.id}
                    className={page.chip}
                    onClick={() => setFilter(chip.id)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className={page.primary}
            disabled={busy}
            onClick={() => startInstall(null)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M8 2v12M2 8h12" />
            </svg>
            INSTALL MOD
          </button>
        </div>

        <input
          ref={input}
          type="file"
          aria-label="Mod folder"
          className={page.visuallyHidden}
          tabIndex={-1}
          // @ts-expect-error folder selection is a browser extension
          webkitdirectory=""
          multiple
          onChange={(event) => {
            const files = event.target.files;
            const game = installFor.current ?? implicitEdition();
            if (files?.length && game) void install(game, fileListSource([...files]));
            event.target.value = "";
          }}
        />

        {(progress || failure) && (
          <p className={failure ? page.failure : page.status} role={failure ? "alert" : "status"}>
            {failure ?? progress}
          </p>
        )}

        <ul className={styles.list}>
          {rows.map(({ game, mod }) => (
            <ModRow
              key={`${game.storage}/${mod.name}`}
              game={game}
              mod={mod}
              active={activeMods[game.storage] === mod.name}
              busy={busy}
              onPlay={() => void play(game, mod)}
              onRemove={() => void remove(game, mod)}
            />
          ))}
        </ul>

        <div
          className={styles.drop}
          data-dragging={dragging || undefined}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => void drop(event)}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            aria-hidden="true"
          >
            <path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v3.5h11V10" />
          </svg>
          <span>Drop a mod folder</span>
        </div>
      </div>

      <Dialog.Root
        open={choosing}
        onOpenChange={(open) => {
          if (!open) {
            setChoosing(false);
            pending.current = null;
          }
        }}
      >
        <Dialog.Content maxWidth="420px" className={page.dialog}>
          <Dialog.Title className={page.dialogTitle}>Install a mod for</Dialog.Title>
          <Dialog.Description className={page.visuallyHidden}>
            Pick the game the mod is made for.
          </Dialog.Description>
          <div className={styles.choices}>
            {editions.map((game) => (
              <button
                key={game.id}
                type="button"
                className={page.outline}
                onClick={() => chosen(game)}
              >
                {EDITION_BRAND[game.id].title.toUpperCase()}
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
