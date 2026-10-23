import { CrossCircledIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Button, Callout, Flex, Heading, ScrollArea } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { SoundControl } from "../components/SoundControl";
import { SettingsDialog } from "../components/SettingsDialog";
import { Setting } from "../game/protocol";
import {
  enterFullscreen,
  autoLockPointer,
  leaveFullscreen,
  lockPointer,
  releaseBrowserControls,
} from "../game/browser-controls";
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
declare global {
  interface Window {
    ra2Session?: Promise<GameHandle>;
  }
}
function startOnce(files: FileSource): Promise<GameHandle> {
  window.ra2Session ??= startGame({ files, args: argsFromQuery(window.location.search) });
  return window.ra2Session;
}

/** The canvas fills the window; the game draws into it through shared memory. React never touches it again. */
export function Play({ files }: { files: FileSource }) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const backdrop = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<HTMLImageElement>(null);
  const [startError, setStartError] = useState<Error | null>(null);
  const [presenter, setPresenter] = useState<Presenter | null>(null);
  const [audio, setAudio] = useState<GameAudio | null>(null);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const handle = useRef<GameHandle | null>(null);
  const phase = useGameState((s) => s.phase);
  const copy = useGameState((s) => s.copy);
  const title = useGameState((s) => s.title);
  const error = useGameState((s) => s.error);
  const exitCode = useGameState((s) => s.exitCode);
  const settings = useGameState((s) => s.settings);
  const restart = useGameState((s) => s.restart);

  useEffect(() => {
    if (settings) presenter?.configure(settings.scale);
  }, [presenter, settings]);
  useEffect(() => {
    if (!settings || settings.open || !canvas.current) return;
    canvas.current.focus();
  }, [settings]);
  useEffect(() => {
    if (!restart) return;
    const game = handle.current;
    if (files.kind === "opfs") sessionStorage.setItem("ra2-resume-game", files.record.id);
    void (game?.saves?.flush() ?? Promise.resolve()).then(
      () => window.location.reload(),
      (e: unknown) => setBrowserError(`Could not save before switching mods: ${String(e)}`),
    );
  }, [restart, files]);

  const toggleFullscreen = () => {
    void (
      document.fullscreenElement ? leaveFullscreen() : enterFullscreen(document.documentElement)
    ).catch((e: unknown) => setBrowserError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(() => {
    const full = () => setFullscreen(!!document.fullscreenElement);
    const pointer = () => setPointerLocked(document.pointerLockElement === canvas.current);
    document.addEventListener("fullscreenchange", full);
    document.addEventListener("pointerlockchange", pointer);
    return () => {
      document.removeEventListener("fullscreenchange", full);
      document.removeEventListener("pointerlockchange", pointer);
      releaseBrowserControls();
    };
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let cancelled = false;
    let stop = () => {};
    startOnce(files).then(
      (game) => {
        if (cancelled) return;
        const pointer = autoLockPointer(element);
        const presenter = new Presenter(
          element,
          game.memory,
          game.shared,
          backdrop.current,
          cursor.current,
          (active) =>
            pointer.update(
              active &&
                gameStore.getSnapshot().phase === "running" &&
                !gameStore.getSnapshot().settings?.open,
            ),
        );
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
        const detach = attachInput(element, game.exports, {
          picture: () => presenter.gameSize(),
          warp: () => presenter.cursorWarp(),
          enabled: () => !gameStore.getSnapshot().settings?.open,
          shortcut: (event) => {
            if (event.code === "F11" || (event.code === "Enter" && event.altKey)) {
              if (!event.repeat)
                void (
                  document.fullscreenElement
                    ? leaveFullscreen()
                    : enterFullscreen(document.documentElement)
                ).catch((e: unknown) => setBrowserError(String(e)));
              return true;
            }
            if (event.code === "F12" && !event.ctrlKey) {
              if (!event.repeat) {
                const modes = ["sharp", "smooth", "crt", "nearest", "integer"];
                const at = modes.indexOf(gameStore.getSnapshot().settings?.scale ?? "sharp");
                game.exports.ra2_setting(Setting.Scale, (at + 1) % modes.length, 0);
              }
              return true;
            }
            return false;
          },
        });
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
          pointer.dispose();
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
    <div ref={stage} className={styles.stage}>
      <canvas ref={canvas} className={styles.canvas} tabIndex={0} aria-label="The game" />
      <canvas
        ref={backdrop}
        className={styles.backdrop}
        hidden={!settings?.bars}
        aria-hidden="true"
      />
      <img ref={cursor} className={styles.cursor} alt="" aria-hidden="true" />
      <Button
        className={styles.menu}
        size="1"
        variant="soft"
        onClick={() => handle.current?.exports.ra2_setting(Setting.Menu, 1, 0)}
      >
        Settings (F10)
      </Button>
      <SettingsDialog
        settings={settings}
        fullscreen={fullscreen}
        pointerLocked={pointerLocked}
        onFullscreen={toggleFullscreen}
        onPointerLock={() => {
          if (document.pointerLockElement) document.exitPointerLock();
          else if (canvas.current) {
            handle.current?.exports.ra2_setting(Setting.Menu, 0, 0);
            void lockPointer(canvas.current).catch((e: unknown) => setBrowserError(String(e)));
          }
        }}
        command={(key, value, extra = 0) => handle.current?.exports.ra2_setting(key, value, extra)}
        onClose={() => {
          handle.current?.exports.ra2_setting(Setting.Menu, 0, 0);
          void handle.current?.saves?.flush();
          canvas.current?.focus();
        }}
      />
      {browserError && (
        <Callout.Root className={styles.browserError} role="alert">
          <Callout.Text>{browserError}</Callout.Text>
          <Button size="1" onClick={() => setBrowserError(null)}>
            Dismiss
          </Button>
        </Callout.Root>
      )}
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
            <Callout.Text>{startError.message}</Callout.Text>
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
