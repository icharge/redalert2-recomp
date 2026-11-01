import { CrossCircledIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Button, Callout, Dialog, Flex, Heading, ScrollArea, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SoundControl } from "../components/SoundControl";
import { SettingsDialog } from "../components/SettingsDialog";
import { LinkDialog } from "../components/LinkDialog";
import { linkTarget } from "../game/link-targets";
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
import { PageCursor } from "../game/cursor-layer";
import { LanPanel } from "../components/LanPanel";
import { FileExplorer } from "../components/FileExplorer";
import {
  argsFromQuery,
  GameNotBuilt,
  startGame,
  sourceStorage,
  type FileSource,
  type GameHandle,
} from "../game/loader";
import { readThaiFontPreference, type ThaiFontPreference } from "../storage/thai-fonts";
import { Presenter2d, type GamePresenter } from "../game/presenter";
import { GlPresenter } from "../game/gl-presenter";
import { presenterKind } from "../game/choose-presenter";
import { gameStore, useGameState } from "../game/store";
import { useAttention } from "../game/attention";
import {
  DEFAULT_SOUND_PREFERENCES,
  loadSoundPreferences,
  saveSoundPreference,
} from "../game/sound-preferences";
import { loadVolume, saveVolume } from "../game/volume";
import { FrameStats } from "./FrameStats";
import { LoadingScreen } from "./LoadingScreen";
import styles from "./Play.module.css";
import { leaveGame } from "../game/lifecycle";
import { statsWanted, writeStatsPreference } from "../storage/stats-preferences";
import { introArguments } from "../storage/intro-preferences";
import { speedControlArguments } from "../storage/speed-control-preferences";

const runtimeLive = () => !["exited", "crashed"].includes(gameStore.getSnapshot().phase);

/** ?show-cursor=1: the debug mode that keeps the browser cursor visible. */
const cursorDebug = () => new URLSearchParams(window.location.search).get("show-cursor") === "1";

/** The page draws the game's cursor (docs/web/cursor-layer.md) unless the game's
 * own software cursor was asked for: `?cursor=game` (the launcher's "Game's own"
 * choice), `?cursor=software`, or `?cursor=off`. */
const cursorPage = () => {
  const value = new URLSearchParams(window.location.search).get("cursor");
  return value !== "game" && value !== "software" && value !== "off";
};

// The game starts once per page load, whatever React remounts (StrictMode, a screen switch).
declare global {
  interface Window {
    ra2Session?: Promise<GameHandle>;
    ra2Presenter?: GamePresenter;
  }
}
function startOnce(files: FileSource, thaiFontFix: ThaiFontPreference): Promise<GameHandle> {
  const game = sourceStorage(files);
  const args = argsFromQuery(window.location.search);
  if (!args.some((arg) => arg.toLowerCase() === "--intro"))
    args.push(...introArguments(window.location.search, game));
  if (!args.some((arg) => /^-{1,2}speedcontrol$/i.test(arg)))
    args.push(...speedControlArguments(window.location.search, game));
  window.ra2Session ??= startGame({ files, thaiFontFix, args });
  return window.ra2Session;
}

/** The canvas fills the window; the game draws into it through shared memory. React never touches it again. */
export function Play({ files }: { files: FileSource }) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const cursor = useRef<HTMLImageElement>(null);
  const [startError, setStartError] = useState<Error | null>(null);
  const [statsOn, setStatsOn] = useState(() => statsWanted(window.location.search));
  const [presenter, setPresenter] = useState<GamePresenter | null>(null);
  const [audio, setAudio] = useState<GameAudio | null>(null);
  const [volume, setVolume] = useState(1);
  const [soundPreferences, setSoundPreferences] = useState(DEFAULT_SOUND_PREFERENCES);
  const attention = useAttention();
  const [fullscreen, setFullscreen] = useState(false);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [browseFiles, setBrowseFiles] = useState(false);
  const [textInputOpen, setTextInputOpen] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const gameId = sourceStorage(files);
  const [thaiFontFix] = useState(() => readThaiFontPreference(gameId));
  const handle = useRef<GameHandle | null>(null);
  const cursorMarker = useRef<HTMLDivElement | null>(null);
  const pageCursorCanvas = useRef<HTMLCanvasElement | null>(null);
  const phase = useGameState((s) => s.phase);
  const copy = useGameState((s) => s.copy);
  const title = useGameState((s) => s.title);
  const error = useGameState((s) => s.error);
  const exitCode = useGameState((s) => s.exitCode);
  const exitConfirmation = useGameState((s) => s.exitConfirmation);
  const openLink = useGameState((s) => s.openLink);
  const linkDialogTarget = useMemo(
    () => (openLink ? linkTarget(openLink.url, undefined, openLink.page) : null),
    [openLink],
  );
  const settings = useGameState((s) => s.settings);
  const restart = useGameState((s) => s.restart);
  const cursorDebugMode = cursorDebug();
  const pageCursorMode = cursorPage();
  const [exitError, setExitError] = useState<string | null>(null);
  const updateStats = useCallback((on: boolean) => {
    setStatsOn(on);
    writeStatsPreference(on);
  }, []);
  const toggleStats = useCallback(() => updateStats(!statsOn), [statsOn, updateStats]);
  const leaving = useRef(false);
  const fastExit = useRef(false);
  const exitFlushing = useRef(false);
  const returnToLauncher = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    setExitError(null);
    void leaveGame(window.ra2Session, undefined, undefined, !fastExit.current).catch(
      (reason: unknown) => {
        leaving.current = false;
        setExitError(`Could not save before leaving: ${String(reason)}`);
      },
    );
  }, []);

  useEffect(() => {
    if (phase === "exited" && exitCode === 0) returnToLauncher();
  }, [phase, exitCode, returnToLauncher]);

  useEffect(() => {
    if (settings) presenter?.configure(settings.scale, settings.bars);
  }, [presenter, settings]);
  useEffect(() => {
    let cancelled = false;
    void loadSoundPreferences().then((saved) => {
      if (!cancelled) setSoundPreferences(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // the page goes quiet while the player is elsewhere, if they asked for that
  useEffect(() => {
    audio?.setQuiet(soundPreferences.muteOnBlur && !attention);
  }, [audio, soundPreferences.muteOnBlur, attention]);
  useEffect(() => {
    if (!audio) return;
    try {
      handle.current?.exports.ra2_set_menu_music(Number(soundPreferences.menuMusic));
    } catch {
      // a game build from before this setting: its music plays everywhere
    }
  }, [audio, soundPreferences.menuMusic]);
  useEffect(() => {
    if (!settings || settings.open || !canvas.current) return;
    canvas.current.focus();
  }, [settings]);
  useEffect(() => {
    if (!restart) return;
    void leaveGame(window.ra2Session, window.location.href).catch((e: unknown) =>
      setBrowserError(`Could not save before switching mods: ${String(e)}`),
    );
  }, [restart, files]);

  useEffect(() => {
    if (!openLink) return;
    // the dialog is the only thing that may take the mouse while it is open
    if (document.pointerLockElement) document.exitPointerLock();
  }, [openLink]);

  const toggleFullscreen = () => {
    void (
      document.fullscreenElement ? leaveFullscreen() : enterFullscreen(document.documentElement)
    ).catch((e: unknown) => setBrowserError(e instanceof Error ? e.message : String(e)));
  };
  const answerExitConfirmation = (exitGame: boolean) => {
    const pending = gameStore.getSnapshot().exitConfirmation;
    const game = handle.current;
    if (!pending || !game) return;
    const reply = () => {
      if (!game.exports.ra2_exit_confirmation_reply(pending.request, Number(exitGame))) {
        setBrowserError("The game's Exit Game confirmation is no longer open.");
        return;
      }
      gameStore.resolveExitConfirmation(pending.request);
    };
    if (!exitGame) {
      reply();
      return;
    }
    if (exitFlushing.current) return;
    exitFlushing.current = true;
    const flush = game.saves ? game.saves.flush() : Promise.resolve(0);
    void flush
      .then(() => {
        fastExit.current = true;
        reply();
      })
      .catch((reason: unknown) =>
        setBrowserError(`Could not save before leaving: ${String(reason)}`),
      )
      .finally(() => {
        exitFlushing.current = false;
      });
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
    let unsubscribe = () => {};
    startOnce(files, thaiFontFix).then(
      (game) => {
        if (cancelled || !runtimeLive()) return;
        let activeCanvas = element;
        let pointer = autoLockPointer(element);
        let detach = () => {};
        let observer: ResizeObserver | null = null;
        let canvasMounted = false;
        // Debug (?show-cursor=1): keep the system pointer (a crosshair) visible
        // instead of taking Pointer Lock, so the game's drawn cursor can be
        // compared with the real one. Input stays absolute, as in the menus.
        const showNativeCursor = cursorDebug();
        if (showNativeCursor)
          console.info("[cursor] showing the system cursor: no Pointer Lock (?show-cursor=1)");
        const capture = (active: boolean) =>
          pointer.update(
            !showNativeCursor &&
              active &&
              gameStore.getSnapshot().phase === "running" &&
              !gameStore.getSnapshot().settings?.open &&
              !gameStore.getSnapshot().exitConfirmation &&
              !gameStore.getSnapshot().openLink,
          );
        let presenter: GamePresenter | null = null;
        const bindCanvas = (target: HTMLCanvasElement) => {
          detach();
          observer?.disconnect();
          pointer.dispose();
          activeCanvas = target;
          pointer = autoLockPointer(target);
          detach = attachInput(target, game.exports, {
            picture: () => presenter!.gameSize(),
            warp: () => presenter!.cursorWarp(),
            textInput: textInput.current ?? undefined,
            sendText: (text) => game.exports.ra2_input_text(text),
            enabled: () =>
              runtimeLive() &&
              !gameStore.getSnapshot().settings?.open &&
              !gameStore.getSnapshot().exitConfirmation &&
              !gameStore.getSnapshot().openLink,
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
          if (showNativeCursor) target.dataset.nativeCursor = "1";
          observer = new ResizeObserver(([entry]) => {
            if (!entry || !runtimeLive()) return;
            const { width, height } = entry.contentRect;
            game.exports.ra2_resize(Math.round(width), Math.round(height), window.devicePixelRatio);
          });
          observer.observe(target);
          target.focus();
        };
        const fallback = () => {
          presenter?.stop();
          const replacement = document.createElement("canvas");
          replacement.className = activeCanvas.className;
          replacement.tabIndex = 0;
          activeCanvas.replaceWith(replacement);
          activeCanvas = replacement;
          canvas.current = replacement;
          presenter = new Presenter2d(
            replacement,
            game.memory,
            game.shared,
            null,
            cursor.current,
            capture,
          );
          if (canvasMounted) {
            presenter.start();
            bindCanvas(replacement);
          }
          setPresenter(presenter);
          window.ra2Presenter = presenter;
        };
        const hasWebGl2 = !!document.createElement("canvas").getContext("webgl2");
        if (presenterKind(new URLSearchParams(window.location.search), hasWebGl2) === "gl") {
          try {
            presenter = new GlPresenter(
              element,
              game.memory,
              game.shared,
              cursor.current,
              capture,
              () => fallback(),
            );
          } catch {
            fallback();
          }
        } else {
          presenter = new Presenter2d(
            element,
            game.memory,
            game.shared,
            null,
            cursor.current,
            capture,
          );
        }
        const initialPresenter = presenter;
        if (!initialPresenter) throw new Error("Could not create a game presenter");
        initialPresenter.start();
        canvasMounted = true;
        bindCanvas(activeCanvas);
        setPresenter(initialPresenter);
        window.ra2Presenter = initialPresenter;
        // The page draws the game's cursor, the default: in a match it stops
        // drawing its own and the page draws it at display rate
        // (docs/web/cursor-layer.md); with ?cursor=game the game keeps its own
        // software cursor and this layer stays off.
        let pageCursorLayer: PageCursor | null = null;
        if (pageCursorMode && pageCursorCanvas.current) {
          pageCursorLayer = new PageCursor(
            pageCursorCanvas.current,
            () => canvas.current,
            game.memory,
            game.shared,
            {
              // The menus' Win32 arrow and the pause overlay are drawn by the
              // same layer as the match cursor; the presenter hides its CSS
              // cursor and its overlay image while it does.
              onActive: (active) => presenter?.setLayerCursor(active),
            },
          );
          pageCursorLayer.start();
          console.info(
            "[cursor] the page draws the game's cursor (default; ?cursor=game keeps the game's own)",
          );
        }
        // Debug marker: the position the page sends the game's cursor to. With
        // ?show-cursor=1 the browser pointer is visible too, so the game's drawn
        // arrow can be compared with both: a drift or jump shows up here first.
        let markerRaf = 0;
        if (showNativeCursor) {
          const tick = () => {
            const marker = cursorMarker.current;
            const target = canvas.current;
            const view = presenter;
            if (marker && target && view) {
              try {
                const { HEAP32 } = game.memory();
                const at = (game.shared >> 2) + 1042; // Shared.pointerX / pointerY
                const x = Atomics.load(HEAP32, at);
                const y = Atomics.load(HEAP32, at + 1);
                const size = view.gameSize();
                const box = target.getBoundingClientRect();
                if (size.width > 0 && size.height > 0 && box.width > 0 && box.height > 0) {
                  const scale = Math.min(box.width / size.width, box.height / size.height);
                  const left = box.left + (box.width - size.width * scale) / 2 + x * scale;
                  const top = box.top + (box.height - size.height * scale) / 2 + y * scale;
                  marker.style.transform = `translate(${left}px, ${top}px) translate(-50%, -50%)`;
                  marker.style.visibility = "visible";
                }
              } catch {
                // the module is shutting down
              }
            }
            markerRaf = requestAnimationFrame(tick);
          };
          markerRaf = requestAnimationFrame(tick);
        }
        handle.current = game;
        const sound = new GameAudio(game.exports, game.memory);
        void sound.start();
        setAudio(sound);
        // the checks in e2e/ look at the ring through this, as they do at ra2Store
        if ("ra2Store" in window) (window as unknown as { ra2Audio: GameAudio }).ra2Audio = sound;
        void loadVolume().then((saved) => {
          if (cancelled || !runtimeLive()) return;
          game.exports.ra2_set_volume(saved);
          setVolume(saved);
        });
        // what the game saved is in OPFS within a moment of leaving the tab
        const onHidden = () => {
          if (document.visibilityState === "hidden") {
            // the page is not drawing: the game shows its own cursor again
            pageCursorLayer?.release();
            void game.saves?.flush().catch((e: unknown) => setBrowserError(String(e)));
          } else if (runtimeLive()) {
            // back from the background: the game paints its whole screen again
            presenter!.redraw();
            if (document.hasFocus()) game.exports.ra2_focus(1);
          }
        };
        const onPageHide = () => {
          void game.saves?.flushSettings().catch((e: unknown) => setBrowserError(String(e)));
        };
        document.addEventListener("visibilitychange", onHidden);
        document.addEventListener("pagehide", onPageHide, true);
        let stopped = false;
        stop = () => {
          if (stopped) return;
          stopped = true;
          cancelAnimationFrame(markerRaf);
          pageCursorLayer?.stop();
          if (cursorMarker.current) cursorMarker.current.style.visibility = "hidden";
          presenter?.stop();
          pointer.dispose();
          sound.close(runtimeLive());
          setAudio(null);
          setPresenter(null);
          detach();
          observer?.disconnect();
          document.removeEventListener("visibilitychange", onHidden);
          document.removeEventListener("pagehide", onPageHide, true);
          delete window.ra2Presenter;
          releaseBrowserControls();
        };
        unsubscribe = gameStore.subscribe(() => {
          if (!runtimeLive()) stop();
        });
      },
      (reason: unknown) => {
        if (!cancelled) setStartError(reason instanceof Error ? reason : new Error(String(reason)));
      },
    );
    return () => {
      cancelled = true;
      unsubscribe();
      stop();
    };
  }, [files]);

  const crashed = phase === "crashed";
  const liveFiles = handle.current?.files ?? null;
  const waiting =
    !startError && !crashed && (phase === "idle" || phase === "loading" || phase === "booting");

  if (phase === "exited")
    return (
      <Flex className={styles.overlay} align="center" justify="center" direction="column" gap="3">
        <Heading size="5">
          {exitError
            ? "Your game has not been saved"
            : exitCode
              ? `The game closed (exit ${exitCode})`
              : "Returning to launcher…"}
        </Heading>
        {exitError && <Text role="alert">{exitError}</Text>}
        {(exitError || exitCode !== 0) && (
          <Button onClick={returnToLauncher}>{exitError ? "Retry" : "Back to launcher"}</Button>
        )}
      </Flex>
    );

  return (
    <div ref={stage} className={styles.stage}>
      <canvas ref={canvas} className={styles.canvas} tabIndex={0} aria-label="The game" />
      {pageCursorMode && (
        <canvas ref={pageCursorCanvas} className={styles.pageCursor} aria-hidden="true" />
      )}
      {cursorDebugMode && (
        <div ref={cursorMarker} className={styles.cursorMarker} aria-hidden="true" />
      )}
      <textarea
        ref={textInput}
        className={styles.textInput}
        aria-label="Game text input"
        autoCapitalize="off"
        autoComplete="off"
        enterKeyHint="done"
        inputMode="text"
        spellCheck={false}
        onFocus={() => setTextInputOpen(true)}
        onBlur={() => setTextInputOpen(false)}
      />
      <img ref={cursor} className={styles.cursor} alt="" aria-hidden="true" />
      <Flex className={styles.topMenu} gap="2">
        <Button
          size="1"
          variant="soft"
          onClick={() => handle.current?.exports.ra2_setting(Setting.Menu, 1, 0)}
        >
          Settings (F10)
        </Button>
        <Button
          size="1"
          variant="soft"
          aria-pressed={textInputOpen}
          disabled={!presenter}
          onPointerDown={(event) => {
            if (document.activeElement === textInput.current) event.preventDefault();
          }}
          onClick={() => {
            if (document.activeElement === textInput.current) {
              textInput.current?.blur();
              canvas.current?.focus();
            } else {
              textInput.current?.focus();
            }
          }}
        >
          {textInputOpen ? "Hide keyboard" : "Text input"}
        </Button>
        {liveFiles && (
          <Button size="1" variant="soft" onClick={() => setBrowseFiles(true)}>
            Browse files
          </Button>
        )}
      </Flex>
      {browseFiles && liveFiles && (
        <FileExplorer source={liveFiles} onClose={() => setBrowseFiles(false)} />
      )}
      {presenter && handle.current && <LanPanel game={handle.current} />}
      <Dialog.Root
        open={exitConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && exitConfirmation) answerExitConfirmation(false);
        }}
      >
        <Dialog.Content
          maxWidth="420px"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            canvas.current?.focus();
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title>Exit game?</Dialog.Title>
          <Dialog.Description size="2" mb="4">
            Are you sure you want to leave the game?
          </Dialog.Description>
          <Flex justify="end" gap="2">
            <Button variant="soft" onClick={() => answerExitConfirmation(false)}>
              Stay in game
            </Button>
            <Button color="red" onClick={() => answerExitConfirmation(true)}>
              Exit game
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
      <LinkDialog
        target={linkDialogTarget}
        onClose={() => gameStore.dismissOpenLink()}
        returnFocusTo={canvas.current}
      />
      <SettingsDialog
        settings={settings}
        statsOn={statsOn}
        onStatsChange={updateStats}
        fullscreen={fullscreen}
        pointerLocked={pointerLocked}
        onFullscreen={toggleFullscreen}
        pointerLockDisabled={cursorDebugMode}
        onPointerLock={() => {
          if (cursorDebugMode) return;
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
      <FrameStats presenter={presenter} on={statsOn} onToggle={toggleStats} />
      {audio && (
        <SoundControl
          audio={audio}
          volume={volume}
          onVolume={(next) => {
            setVolume(next);
            handle.current?.exports.ra2_set_volume(next);
            void saveVolume(next);
          }}
          preferences={soundPreferences}
          onPreference={(key, value) => {
            setSoundPreferences((now) => ({ ...now, [key]: value }));
            void saveSoundPreference(key, value);
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
        <CrashView
          message={exitError ?? error ?? startError?.message ?? "The game stopped."}
          onReturn={returnToLauncher}
        />
      )}
    </div>
  );
}

/** The game's thread died: what it said, and the end of its log. */
function CrashView({ message, onReturn }: { message: string; onReturn(): void }) {
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
      <Button onClick={onReturn}>Back to launcher</Button>
    </Flex>
  );
}
