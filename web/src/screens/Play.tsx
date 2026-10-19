import { CrossCircledIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Button, Callout, Code, Flex, Heading, ScrollArea } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { SoundControl } from "../components/SoundControl";
import { GameAudio } from "../game/audio";
import { attachInput } from "../game/input";
import {
  argsFromQuery,
  GameNotBuilt,
  startGame,
  type FileSource,
  type GameHandle,
} from "../game/loader";
import { Presenter } from "../game/presenter";
import { gameStore, useGameState } from "../game/store";
import { loadVolume, saveVolume } from "../game/volume";
import { FrameStats } from "./FrameStats";
import { LoadingScreen } from "./LoadingScreen";
import styles from "./Play.module.css";

// The game starts once per page load, whatever React remounts (StrictMode, a screen switch).
let session: Promise<GameHandle> | null = null;
function startOnce(files: FileSource): Promise<GameHandle> {
  session ??= startGame({ files, args: argsFromQuery(window.location.search) });
  return session;
}

/** The canvas fills the window; the game draws into it through shared memory. React never touches it again. */
export function Play({ files }: { files: FileSource }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [startError, setStartError] = useState<Error | null>(null);
  const [presenter, setPresenter] = useState<Presenter | null>(null);
  const [audio, setAudio] = useState<GameAudio | null>(null);
  const [volume, setVolume] = useState(1);
  const handle = useRef<GameHandle | null>(null);
  const phase = useGameState((s) => s.phase);
  const copy = useGameState((s) => s.copy);
  const title = useGameState((s) => s.title);
  const error = useGameState((s) => s.error);
  const exitCode = useGameState((s) => s.exitCode);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let cancelled = false;
    let stop = () => {};
    startOnce(files).then(
      (game) => {
        if (cancelled) return;
        const presenter = new Presenter(element, game.memory, game.shared);
        presenter.start();
        setPresenter(presenter);
        handle.current = game;
        const sound = new GameAudio(game.exports, game.memory);
        void sound.start();
        setAudio(sound);
        // the checks in e2e/ look at the ring through this, as they do at ra2Store
        if ("ra2Store" in window) (window as unknown as { ra2Audio: GameAudio }).ra2Audio = sound;
        void loadVolume().then((saved) => {
          if (cancelled) return;
          game.exports.ra2_set_volume(saved);
          setVolume(saved);
        });
        const detach = attachInput(element, game.exports);
        const observer = new ResizeObserver(([entry]) => {
          if (!entry) return;
          const { width, height } = entry.contentRect;
          game.exports.ra2_resize(Math.round(width), Math.round(height), window.devicePixelRatio);
        });
        observer.observe(element);
        element.focus();
        // what the game saved is in OPFS within a moment of leaving the tab
        const onHidden = () => {
          if (document.visibilityState === "hidden") void game.saves?.flush();
        };
        document.addEventListener("visibilitychange", onHidden);
        stop = () => {
          presenter.stop();
          sound.close();
          setAudio(null);
          detach();
          observer.disconnect();
          document.removeEventListener("visibilitychange", onHidden);
        };
      },
      (reason: unknown) => {
        if (!cancelled) setStartError(reason instanceof Error ? reason : new Error(String(reason)));
      },
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, [files]);

  const crashed = phase === "crashed";
  const waiting =
    !startError && !crashed && (phase === "idle" || phase === "loading" || phase === "booting");

  return (
    <div className={styles.stage}>
      <canvas ref={canvas} className={styles.canvas} tabIndex={0} aria-label="The game" />
      <FrameStats presenter={presenter} />
      {audio && (
        <SoundControl
          audio={audio}
          volume={volume}
          onVolume={(next) => {
            setVolume(next);
            handle.current?.exports.ra2_set_volume(next);
            void saveVolume(next);
          }}
          giveBack={() => canvas.current?.focus()}
        />
      )}
      {waiting && <LoadingScreen state={{ phase, copy, title }} />}
      {startError instanceof GameNotBuilt && (
        <Flex className={styles.overlay} align="center" justify="center" p="6">
          <Callout.Root color="amber" role="alert" size="3">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              The game isn't built. Run <Code>build-web.cmd</Code> (or <Code>./build-web.sh</Code>)
              in the repository root, then reload.
            </Callout.Text>
          </Callout.Root>
        </Flex>
      )}
      {(crashed || (startError && !(startError instanceof GameNotBuilt))) && (
        <CrashView message={error ?? startError?.message ?? "The game stopped."} />
      )}
      {phase === "exited" && (
        <Flex className={styles.overlay} align="center" justify="center" direction="column" gap="3">
          <Heading size="5">The game closed{exitCode ? ` (exit ${exitCode})` : ""}</Heading>
          <Button onClick={() => window.location.reload()}>Start again</Button>
        </Flex>
      )}
    </div>
  );
}

/** The game's thread died: what it said, and the end of its log. */
function CrashView({ message }: { message: string }) {
  const tail = gameStore.getLog().slice(-80).join("\n");
  return (
    <Flex
      className={styles.overlay}
      align="center"
      justify="center"
      direction="column"
      gap="3"
      p="6"
    >
      <Callout.Root color="red" role="alert" size="3">
        <Callout.Icon>
          <CrossCircledIcon />
        </Callout.Icon>
        <Callout.Text>{message}</Callout.Text>
      </Callout.Root>
      {tail && (
        <ScrollArea className={styles.log} type="auto" scrollbars="vertical">
          <pre>{tail}</pre>
        </ScrollArea>
      )}
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </Flex>
  );
}
