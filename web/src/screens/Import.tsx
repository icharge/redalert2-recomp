import { useRef, useState, type DragEvent } from "react";
import { BrandImage } from "../components/BrandImage";
import { EDITION_BRAND, LOGO_SRC } from "../components/brand";
import { formatBytes } from "../components/format";
import { InfoTip } from "../components/InfoTip";
import { KeyArt } from "../components/KeyArt";
import { appPath } from "../paths";
import {
  blocker,
  directorySource,
  droppedSource,
  fileListSource,
  prepareImport,
  runImport,
  type FolderSource,
  type Prepared,
} from "../storage/importer";
import {
  classify,
  type BuildInfo,
  type EditionReadiness,
  type GameId,
  type ImportOptions,
} from "../storage/install";
import type { Manifest } from "../storage/manifest";
import { CopyCancelled, type CopyProgress, type CopyTarget } from "../storage/opfs";
import styles from "./Import.module.css";

/** What the screen needs of the browser, so a test can give it fakes. */
export interface ImportDeps {
  build: BuildInfo;
  manifest: Manifest;
  target: CopyTarget;
  estimate(): Promise<{ quota?: number; usage?: number }>;
  /** asks the browser not to clear the copy under storage pressure */
  persist(): Promise<boolean>;
  /** the browser's folder picker, if it has one (Chromium); null if the player closed it */
  pickDirectory: (() => Promise<FolderSource | null>) | null;
}

export function browserDeps(build: BuildInfo, manifest: Manifest, target: CopyTarget): ImportDeps {
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (options?: object) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  return {
    build,
    manifest,
    target,
    estimate: () => navigator.storage.estimate(),
    persist: async () => (await navigator.storage.persist?.()) ?? false,
    pickDirectory: picker
      ? async () => {
          try {
            return directorySource(await picker.call(window, { id: "ra2-game", mode: "read" }));
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return null;
            throw error;
          }
        }
      : null,
  };
}

type Stage =
  | { name: "choose"; message?: string }
  | { name: "looking"; folder: string }
  | { name: "review"; source: FolderSource; options: ImportOptions; prepared: Prepared }
  | { name: "copying"; progress: CopyProgress | null; persistent: boolean | null }
  | { name: "failed"; message: string };

const FIRST: ImportOptions = { movies: false, saves: true, settings: false };

const STEPS = ["1 FOLDER", "2 CHECK", "3 COPY"];

function stepOf(stage: Stage): number {
  if (stage.name === "review") return 1;
  if (stage.name === "copying") return 2;
  return 0;
}

export function Import({
  deps,
  onDone,
  onBack,
  slot,
}: {
  deps: ImportDeps;
  /** the copy finished, in this slot */
  onDone: (slot?: number) => void;
  /** back to the launcher; no BACK button without it */
  onBack?: () => void;
  slot?: number;
}) {
  const [stage, setStage] = useState<Stage>({ name: "choose" });
  const abort = useRef<AbortController | null>(null);
  const [over, setOver] = useState(false);

  async function look(source: FolderSource, options: ImportOptions) {
    setStage({ name: "looking", folder: source.name });
    try {
      const prepared = await prepareImport(source, deps.build, options, await deps.estimate());
      setStage({ name: "review", source, options, prepared });
    } catch (error) {
      setStage({ name: "failed", message: errorText(error) });
    }
  }

  async function choose(pick: Promise<FolderSource | null>) {
    try {
      const source = await pick;
      if (source) await look(source, FIRST);
      else setStage({ name: "choose", message: "That is not a folder." });
    } catch (error) {
      setStage({ name: "failed", message: errorText(error) });
    }
  }

  async function start(prepared: Prepared) {
    const controller = new AbortController();
    abort.current = controller;
    setStage({ name: "copying", progress: null, persistent: null });
    try {
      const persistent = await deps.persist();
      setStage({ name: "copying", progress: null, persistent });
      const done = await runImport({
        prepared,
        build: deps.build,
        manifest: deps.manifest,
        target: deps.target,
        signal: controller.signal,
        ...(slot === undefined ? {} : { slot }),
        onProgress: (progress) => setStage({ name: "copying", progress, persistent }),
      });
      onDone(done);
    } catch (error) {
      if (error instanceof CopyCancelled)
        setStage({
          name: "choose",
          message: "Cancelled. What was copied is kept: RESUME INSTALL carries on.",
        });
      else setStage({ name: "failed", message: errorText(error) });
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    void choose(droppedSource(event.dataTransfer.items));
  }

  const current = stepOf(stage);
  return (
    <div className={styles.screen}>
      <KeyArt edition="ra2" dim={0.45} />
      {onBack && stage.name !== "copying" && (
        <button type="button" className={styles.back} onClick={onBack}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M10 3L5 8l5 5" />
          </svg>
          BACK
        </button>
      )}
      <div className={styles.column}>
        <BrandImage
          src={appPath(LOGO_SRC)}
          alt="YuriNet"
          className={styles.logo}
          fallback={<span className={styles.logoText}>YURINET</span>}
        />
        <section className={styles.panel} aria-label="Install the game">
          <ol className={styles.steps} aria-label="Steps">
            {STEPS.map((label, index) => (
              <li
                key={label}
                aria-current={index === current ? "step" : undefined}
                data-state={index < current ? "done" : index === current ? "current" : "next"}
              >
                <span aria-hidden="true" />
                {label}
              </li>
            ))}
          </ol>

          {stage.name === "choose" && (
            <Chooser
              deps={deps}
              message={stage.message}
              over={over}
              setOver={setOver}
              onDrop={onDrop}
              onPick={() => deps.pickDirectory && void choose(deps.pickDirectory())}
              onFiles={(files) => void choose(Promise.resolve(fileListSource(files)))}
            />
          )}

          {stage.name === "looking" && (
            <div className={styles.body}>
              <h1 className={styles.title}>CHECKING</h1>
              <p className={styles.muted} role="status">
                Looking at {stage.folder}…
              </p>
            </div>
          )}

          {stage.name === "review" && (
            <Review
              stage={stage}
              onOptions={(options) => void look(stage.source, options)}
              onStart={() => void start(stage.prepared)}
              onBack={() => setStage({ name: "choose" })}
            />
          )}

          {stage.name === "copying" && (
            <Copying
              progress={stage.progress}
              persistent={stage.persistent}
              onCancel={() => abort.current?.abort()}
            />
          )}

          {stage.name === "failed" && (
            <div className={styles.body}>
              <h1 className={styles.title}>THAT DID NOT WORK</h1>
              <p className={styles.failure} role="alert">
                {stage.message}
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => setStage({ name: "choose" })}
                >
                  TRY AGAIN
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Chooser(props: {
  deps: ImportDeps;
  message?: string | undefined;
  over: boolean;
  setOver(over: boolean): void;
  onDrop(event: DragEvent): void;
  onPick(): void;
  onFiles(files: FileList): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pickFiles = () => input.current?.click();
  return (
    <div className={styles.body}>
      <div className={styles.intro}>
        <h1 className={styles.title}>INSTALL THE GAME</h1>
        <p className={styles.muted}>Pick your Red Alert 2 folder. Nothing is uploaded.</p>
      </div>
      {props.message && (
        <p className={styles.warn} role="status">
          {props.message}
        </p>
      )}
      <div
        className={styles.drop}
        data-over={props.over || undefined}
        onDragOver={(event) => {
          event.preventDefault();
          props.setOver(true);
        }}
        onDragLeave={() => props.setOver(false)}
        onDrop={props.onDrop}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          aria-hidden="true"
        >
          <path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v3.5h11V10" />
        </svg>
        <span>Drop the folder here</span>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          onClick={props.deps.pickDirectory ? props.onPick : pickFiles}
        >
          CHOOSE FOLDER
        </button>
        {props.deps.pickDirectory && (
          <button type="button" className={styles.link} onClick={pickFiles}>
            Use file picker
          </button>
        )}
        <input
          ref={input}
          type="file"
          className={styles.hidden}
          tabIndex={-1}
          aria-label="Game folder"
          // @ts-expect-error webkitdirectory is not in React's types
          webkitdirectory=""
          multiple
          onChange={(event) => event.target.files && props.onFiles(event.target.files)}
        />
      </div>
    </div>
  );
}

function readinessText(readiness: EditionReadiness): string {
  if (readiness.status === "runtime-not-built") return "Runtime not built";
  if (readiness.status === "missing-content") return `Missing ${readiness.missing.join(", ")}`;
  return "Found";
}

function Review({
  stage,
  onOptions,
  onStart,
  onBack,
}: {
  stage: Extract<Stage, { name: "review" }>;
  onOptions(options: ImportOptions): void;
  onStart(): void;
  onBack(): void;
}) {
  const { prepared, options } = stage;
  const { plan } = prepared;
  const stopped = blocker(prepared);
  const saveCount = plan.copy.filter((file) => file.kind === "save").length;
  const settingCount = [...prepared.files.keys()].filter(
    (path) => classify(path)?.kind === "settings",
  ).length;
  const ids = Object.keys(plan.readiness) as GameId[];
  return (
    <div className={styles.body}>
      <h1 className={styles.title}>READY TO INSTALL</h1>
      {stopped && (
        <p className={styles.failure} role="alert">
          {stopped}
        </p>
      )}
      <ul className={styles.games}>
        {ids.map((id) => {
          const readiness = plan.readiness[id];
          if (!readiness) return null;
          const brand = EDITION_BRAND[id];
          return (
            <li key={id} aria-label={brand.title}>
              <BrandImage
                src={appPath(brand.icon)}
                alt=""
                className={styles.icon}
                fallback={
                  <span
                    className={styles.tile}
                    style={{ background: brand.tile, borderColor: brand.tileBorder }}
                  >
                    {brand.short}
                  </span>
                }
              />
              <span className={styles.gameName}>{brand.title}</span>
              <span className={styles.state}>
                <span
                  className={readiness.status === "ready" ? styles.dotReady : styles.dotWait}
                  aria-hidden="true"
                />
                {readinessText(readiness)}
              </span>
            </li>
          );
        })}
      </ul>
      {plan.warnings.map((warning) => (
        <p key={warning} className={styles.warn}>
          {warning}
        </p>
      ))}
      <div className={styles.options}>
        <div className={styles.option}>
          <label>
            <input
              type="checkbox"
              checked={options.movies}
              disabled={plan.movieBytes === 0}
              onChange={(event) => onOptions({ ...options, movies: event.target.checked })}
            />
            Movies <span className={styles.muted}>{formatBytes(plan.movieBytes)}</span>
          </label>
          <InfoTip text="Without them, cutscenes show as black." />
        </div>
        <div className={styles.option}>
          <label>
            <input
              type="checkbox"
              checked={options.saves}
              disabled={saveCount === 0 && !options.saves}
              onChange={(event) => onOptions({ ...options, saves: event.target.checked })}
            />
            Saved games
          </label>
        </div>
        <div className={styles.option}>
          <label>
            <input
              type="checkbox"
              checked={options.settings}
              disabled={settingCount === 0 && !options.settings}
              onChange={(event) => onOptions({ ...options, settings: event.target.checked })}
            />
            Settings and hotkeys
          </label>
          <InfoTip text="Off: start from the game's own settings. On: bring the RA2.INI, RA2MD.INI and KEYBOARD files in the folder." />
        </div>
      </div>
      <p className={styles.small}>
        {plan.copy.length} files from {stage.source.name}. {plan.skipped.length} left out
        <InfoTip text="Tools, other games, mods and files the game does not read are not copied." />
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={stopped !== null}
          onClick={onStart}
        >
          INSTALL {formatBytes(plan.bytes)}
        </button>
        <button type="button" className={styles.secondary} onClick={onBack}>
          OTHER FOLDER
        </button>
      </div>
    </div>
  );
}

function Copying({
  progress,
  persistent,
  onCancel,
}: {
  progress: CopyProgress | null;
  persistent: boolean | null;
  onCancel(): void;
}) {
  const percent =
    progress && progress.totalBytes > 0
      ? Math.round((progress.doneBytes / progress.totalBytes) * 100)
      : 0;
  return (
    <div className={styles.body}>
      <h1 className={styles.title}>INSTALLING</h1>
      <div
        role="progressbar"
        aria-label="Copying the game"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className={styles.bar}
      >
        <div style={{ width: `${percent}%` }} />
      </div>
      <div className={styles.progressLine}>
        <span>
          {progress
            ? `${formatBytes(progress.doneBytes)} of ${formatBytes(progress.totalBytes)}`
            : "Starting…"}
        </span>
        {progress && <span className={styles.muted}>{progress.file}</span>}
      </div>
      {persistent === false && (
        <p className={styles.warn}>The browser may clear this copy if it runs low on space.</p>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          CANCEL
        </button>
      </div>
    </div>
  );
}
