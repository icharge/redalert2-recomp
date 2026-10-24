import {
  CheckCircledIcon,
  CrossCircledIcon,
  ExclamationTriangleIcon,
  UploadIcon,
} from "@radix-ui/react-icons";
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Flex,
  Heading,
  Link,
  Progress,
  Text,
} from "@radix-ui/themes";
import { useRef, useState, type DragEvent } from "react";
import { formatBytes } from "../components/format";
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
import type { BuildInfo, ImportOptions } from "../storage/install";
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

const FIRST: ImportOptions = { movies: false, saves: true };

export function Import({ deps, onDone, slot }: { deps: ImportDeps; onDone: () => void; slot?: number }) {
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
      await runImport({
        prepared,
        build: deps.build,
        manifest: deps.manifest,
        target: deps.target,
        signal: controller.signal,
        ...(slot === undefined ? {} : { slot }),
        onProgress: (progress) => setStage({ name: "copying", progress, persistent }),
      });
      onDone();
    } catch (error) {
      if (error instanceof CopyCancelled)
        setStage({
          name: "choose",
          message: "Cancelled. What was copied is kept. Use Resume import in the launcher to carry on.",
        });
      else setStage({ name: "failed", message: errorText(error) });
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    void choose(droppedSource(event.dataTransfer.items));
  }

  return (
    <Flex className={styles.page} align="center" justify="center" p="4">
      <Card size="4" className={styles.card}>
        <Flex direction="column" gap="4">
          <Heading size="6">Bring your game</Heading>
          <Text color="gray">
            Pick the folder Red Alert 2 or Yuri&apos;s Revenge is installed in. If it contains both,
            they can share files. The files are copied into this browser and stay there; nothing is
            uploaded.
          </Text>

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

          {stage.name === "looking" && <Text>Looking at {stage.folder}…</Text>}

          {stage.name === "review" && (
            <Review
              stage={stage}
              titles={stage.prepared.plan.games.map((id) => deps.build.games[id]?.title ?? id)}
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
            <>
              <Callout.Root color="red" role="alert">
                <Callout.Icon>
                  <CrossCircledIcon />
                </Callout.Icon>
                <Callout.Text>{stage.message}</Callout.Text>
              </Callout.Root>
              <Button onClick={() => setStage({ name: "choose" })}>Try again</Button>
            </>
          )}
        </Flex>
      </Card>
    </Flex>
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
  return (
    <>
      {props.message && (
        <Callout.Root color="amber">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{props.message}</Callout.Text>
        </Callout.Root>
      )}
      <div
        className={`${styles.drop} ${props.over ? styles.over : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          props.setOver(true);
        }}
        onDragLeave={() => props.setOver(false)}
        onDrop={props.onDrop}
      >
        <UploadIcon width="28" height="28" />
        <Text>Drop the game folder here</Text>
      </div>
      <Flex gap="3" align="center" wrap="wrap">
        {props.deps.pickDirectory && <Button onClick={props.onPick}>Choose folder…</Button>}
        <Link
          href="#"
          onClick={(event) => {
            event.preventDefault();
            input.current?.click();
          }}
        >
          {props.deps.pickDirectory ? "or use the file picker" : "Choose folder…"}
        </Link>
        <input
          ref={input}
          type="file"
          className={styles.hidden}
          aria-label="Game folder"
          // @ts-expect-error webkitdirectory is not in React's types
          webkitdirectory=""
          multiple
          onChange={(event) => event.target.files && props.onFiles(event.target.files)}
        />
      </Flex>
    </>
  );
}

function Review({
  stage,
  titles,
  onOptions,
  onStart,
  onBack,
}: {
  stage: Extract<Stage, { name: "review" }>;
  titles: string[];
  onOptions(options: ImportOptions): void;
  onStart(): void;
  onBack(): void;
}) {
  const { prepared, options } = stage;
  const { plan } = prepared;
  const stopped = blocker(prepared);
  const saveCount = plan.copy.filter((file) => file.kind === "save").length;
  return (
    <>
      {stopped ? (
        <Callout.Root color="red" role="alert">
          <Callout.Icon>
            <CrossCircledIcon />
          </Callout.Icon>
          <Callout.Text>{stopped}</Callout.Text>
        </Callout.Root>
      ) : (
        <Callout.Root color="green">
          <Callout.Icon>
            <CheckCircledIcon />
          </Callout.Icon>
          <Callout.Text>
            Found {titles.join(" and ")} in {stage.source.name}: {plan.copy.length} files,{" "}
            {formatBytes(plan.bytes)} to copy.
          </Callout.Text>
        </Callout.Root>
      )}
      {plan.warnings.map((warning) => (
        <Text key={warning} size="2" color="amber">
          {warning}
        </Text>
      ))}
      <Flex direction="column" gap="2">
        <Text as="label" size="2">
          <Flex gap="2" align="center">
            <Checkbox
              checked={options.movies}
              disabled={plan.movieBytes === 0}
              onCheckedChange={(checked) => onOptions({ ...options, movies: checked === true })}
            />
            Include the movies ({formatBytes(plan.movieBytes)}). Without these archives, video
            cutscenes show as black; static loading-screen images are separate game assets.
          </Flex>
        </Text>
        <Text as="label" size="2">
          <Flex gap="2" align="center">
            <Checkbox
              checked={options.saves}
              disabled={saveCount === 0 && !options.saves}
              onCheckedChange={(checked) => onOptions({ ...options, saves: checked === true })}
            />
            Bring my saved games
          </Flex>
        </Text>
      </Flex>
      <Text size="1" color="gray">
        {plan.skipped.length} files in the folder are left out: tools, other games and mods, and
        what the game does not read.
      </Text>
      <Flex gap="3">
        <Button disabled={stopped !== null} onClick={onStart}>
          Import {formatBytes(plan.bytes)}
        </Button>
        <Button variant="soft" color="gray" onClick={onBack}>
          Choose another folder
        </Button>
      </Flex>
    </>
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
    progress && progress.totalBytes > 0 ? (progress.doneBytes / progress.totalBytes) * 100 : 0;
  return (
    <>
      <Progress value={percent} aria-label="Copying the game" />
      <Text size="2" color="gray">
        {progress
          ? `${formatBytes(progress.doneBytes)} of ${formatBytes(progress.totalBytes)} · ${progress.file} (${progress.doneFiles + 1} of ${progress.totalFiles})`
          : "Starting…"}
      </Text>
      {persistent === false && (
        <Text size="2" color="amber">
          The browser did not promise to keep this copy: if it clears its storage you would import
          again.
        </Text>
      )}
      <Button variant="soft" color="gray" onClick={onCancel}>
        Cancel
      </Button>
    </>
  );
}
