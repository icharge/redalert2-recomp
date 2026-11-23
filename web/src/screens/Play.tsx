import {
  EnterFullScreenIcon,
  ExclamationTriangleIcon,
  ExitFullScreenIcon,
  FileTextIcon,
  GearIcon,
} from "@radix-ui/react-icons";
import { Button, Callout, Flex, Heading, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { SoundControl } from "../components/SoundControl";
import { SettingsDialog } from "../components/SettingsDialog";
import { LinkDialog } from "../components/LinkDialog";
import { launcherPage, launcherPageUrl, linkTarget } from "../game/link-targets";
import { Setting, Shared } from "../game/protocol";
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
import { lanPlay } from "../storage/lan-preferences";
import { PmPanel, PmTrayButton } from "../components/PmPanel";
import type { PmStore } from "../game/pm";

const noSubscribe = () => () => {};
/** The last player who whispered to this one (the MESSAGES store): where /r answers. */
function useReplyTo(pm: PmStore | undefined): string | null {
  return useSyncExternalStore(
    pm?.subscribe ?? noSubscribe,
    () => pm?.getSnapshot().lastFrom ?? null,
  );
}
/** Whether the player is on WOL: a page (/page, /r) reaches someone (not in a LAN match). */
function useOnline(pm: PmStore | undefined): boolean {
  return useSyncExternalStore(pm?.subscribe ?? noSubscribe, () => !!pm?.getSnapshot().nick);
}
/** The newest invitation to a game room (the MESSAGES store). */
function useLastInvite(pm: PmStore | undefined) {
  return useSyncExternalStore(
    pm?.subscribe ?? noSubscribe,
    () => pm?.getSnapshot().lastInvite ?? null,
  );
}
import { FileExplorer } from "../components/FileExplorer";
import { GameTray, trayItem } from "./GameTray";
import { CrashDialog } from "./CrashDialog";
import { SaveReferencePrompt } from "./SaveReferencePrompt";
import { ExitConfirm } from "./ExitConfirm";
import { MapSearchStatus } from "./MapSearchStatus";
import { ChatBox } from "./ChatBox";
import { PageButton } from "./PageButton";
import { chatBoxPlace } from "./ChatBox";
import { PlayerMenu } from "../components/PlayerMenu";
import { addFriendFor } from "../components/FriendsTab";
import { MatchChat, Target, resolveTarget } from "../components/MatchChat";
import { pageOf } from "../game/chat-commands";
import { LADDER_SKU } from "../ladder/api";
import {
  argsFromQuery,
  GameNotBuilt,
  startGame,
  sourceGame,
  sourceStorage,
  type FileSource,
  type GameHandle,
} from "../game/loader";
import {
  readFullscreenPreference,
  type FullscreenPreference,
} from "../storage/fullscreen-preferences";
import {
  BROWSER_VIDEO_SIZE,
  browserVideoSize,
  readVideoChoice,
  writeVideoPreference,
  type VideoChoice,
} from "../storage/video-preferences";
import { Presenter2d, type GamePresenter } from "../game/presenter";
import { GlPresenter } from "../game/gl-presenter";
import { presenterKind } from "../game/choose-presenter";
import { gameStore, useGameState } from "../game/store";
import { useAttention } from "../game/attention";
import { matchQuiet } from "../game/match-quiet";
import {
  DEFAULT_SOUND_PREFERENCES,
  loadSoundPreferences,
  saveSoundPreference,
  startVolume,
} from "../game/sound-preferences";
import { loadVolume, saveVolume } from "../game/volume";
import { FrameStats } from "./FrameStats";
import { LoadingScreen } from "./LoadingScreen";
import styles from "./Play.module.css";
import { leaveGame } from "../game/lifecycle";
import { testMapRequest } from "../game/test-map";
import { statsWanted, writeStatsPreference } from "../storage/stats-preferences";
import { introArguments } from "../storage/intro-preferences";
import { speedControlArguments } from "../storage/speed-control-preferences";

const FORCE_EXIT_TIMEOUT_MS = 5_000;
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
function startOnce(files: FileSource): Promise<GameHandle> {
  const game = sourceStorage(files);
  const args = argsFromQuery(window.location.search);
  const testMap = testMapRequest(window.location.search);
  // A Test Map launch goes straight to the match: no intro argument, so the host skips the
  // start-up movies (startup_order.h); --test-map makes the game skip the rest.
  if (!testMap && !args.some((arg) => arg.toLowerCase() === "--intro"))
    args.push(...introArguments(window.location.search, game));
  if (!args.some((arg) => /^-{1,2}speedcontrol$/i.test(arg)))
    args.push(...speedControlArguments(window.location.search, game));
  window.ra2Session ??= startGame({ files, args, testMap });
  return window.ra2Session;
}

/** The canvas fills the window; the game draws into it through shared memory. React never touches it again. */
export function Play({ files }: { files: FileSource }) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
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
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [trayQuiet, setTrayQuiet] = useState(false);
  const [pmOpen, setPmOpen] = useState(false);
  const [chatTyping, setChatTyping] = useState<Target | null>(null);
  const gameId = sourceStorage(files);
  const [fullscreenPreference] = useState<FullscreenPreference>(() =>
    readFullscreenPreference(gameId),
  );
  const [videoChoice, setVideoChoice] = useState<VideoChoice>(() => readVideoChoice(gameId));
  const handle = useRef<GameHandle | null>(null);
  const cursorMarker = useRef<HTMLDivElement | null>(null);
  const pageCursorCanvas = useRef<HTMLCanvasElement | null>(null);
  const phase = useGameState((s) => s.phase);
  const testMapStarted = useGameState((s) => s.testMapStarted);
  const copy = useGameState((s) => s.copy);
  const title = useGameState((s) => s.title);
  const error = useGameState((s) => s.error);
  const exitCode = useGameState((s) => s.exitCode);
  const exitConfirmation = useGameState((s) => s.exitConfirmation);
  // the LAN session: a native Network entry asks (lanSession); the transport lives until the game
  // is back at its main menu (lanSessionActive). The tray's LAN button opens the same dialog.
  const lanSession = useGameState((s) => s.lanSession);
  const lanSessionActive = useGameState((s) => s.lanSessionActive);
  const [lanOpen, setLanOpen] = useState(false);
  // LAN play can be off (the build, or the launcher's settings): then the tray has no LAN button
  // and the game's Network goes straight back to the main menu, with a word on why
  const [lanAllowed] = useState(lanPlay);
  const [lanOffNotice, setLanOffNotice] = useState(false);
  useEffect(() => {
    if (lanAllowed === "on" || !lanSession) return;
    // the game's own Cancel: the same reply as the dialog's Cancel button
    if (handle.current?.exports.ra2_lan_session_reply(lanSession.request, 0))
      gameStore.resolveLanSession(lanSession.request);
    setLanOffNotice(true);
    const timer = window.setTimeout(() => setLanOffNotice(false), 8000);
    return () => window.clearTimeout(timer);
  }, [lanAllowed, lanSession]);
  // the LAN dialog owns the keys and the mouse while it shows; the runtime effect reads this ref
  const lanModal = useRef(false);
  useEffect(() => {
    lanModal.current = (lanAllowed === "on" && lanSession !== null) || lanOpen;
    if (lanModal.current && document.pointerLockElement) document.exitPointerLock();
  }, [lanAllowed, lanSession, lanOpen]);
  const saveReferencePrompt = useGameState((s) => s.saveReferencePrompt);
  const openLink = useGameState((s) => s.openLink);
  const mapSearchStatus = useGameState((s) => s.mapSearchStatus);
  const chatField = useGameState((s) => s.chatField);
  const playerPick = useGameState((s) => s.playerPick);
  /** the lobby player menu, where it opens in the stage */
  const [playerMenu, setPlayerMenu] = useState<{ name: string; left: number; top: number } | null>(
    null,
  );
  /** what the MESSAGES panel should open on (the player menu's Message and Profile) */
  const [pmFocus, setPmFocus] = useState<{
    seq: number;
    name?: string;
    profile?: boolean;
    tab?: "messages" | "friends";
  } | null>(null);
  const matchChat = useGameState((s) => s.matchChat);
  const replyTo = useReplyTo(presenter ? handle.current?.pm : undefined);
  // a line for this player only: the game's chat log (a NOTICE from the page), or with no WOL
  // connection (a LAN match) the match panel's own log
  const chatHint = useCallback((text: string) => {
    if (handle.current?.notice(text)) return;
    gameStore.apply({ e: "matchMessage", text, scheme: -1, style: 0 });
  }, []);
  // the game's chat keys (Enter, Backspace, \) open the panel's line to the target they chose
  // Enter opens to the target last used in this match (everyone at first); a new match forgets it
  const [chatTarget, setChatTarget] = useState<Target>(Target.all);
  const chatTargetRef = useRef<Target>(Target.all);
  const rememberTarget = useCallback((target: Target) => {
    chatTargetRef.current = target;
    setChatTarget(target);
  }, []);
  // the player the line whispers to after a /r or /p: Enter opens to them again; Backspace, \ and
  // a new match leave it
  const [chatWhisper, setChatWhisper] = useState<string | null>(null);
  const chatOnline = useOnline(presenter ? handle.current?.pm : undefined);
  useEffect(() => {
    if (!matchChat.ready) return;
    rememberTarget(Target.all);
    setChatWhisper(null);
  }, [matchChat.ready, rememberTarget]);
  const chatOpen = matchChat.open;
  useEffect(() => {
    if (!chatOpen) return;
    const target = resolveTarget(chatOpen.to, chatTargetRef.current);
    if (chatOpen.to === Target.allies || chatOpen.to === Target.all) setChatWhisper(null);
    rememberTarget(target);
    setChatTyping(target);
  }, [chatOpen, rememberTarget]);
  // The game's Ladder and Clan buttons open the launcher's own page in a new tab; the game keeps
  // running. A browser that blocks the tab leaves the dialog, whose Open goes to the same page.
  const [blockedLauncherLink, setBlockedLauncherLink] = useState<number | null>(null);
  const linkDialogTarget = useMemo(() => {
    if (!openLink) return null;
    const target = linkTarget(openLink.url, undefined, openLink.page);
    const page = launcherPage(target);
    if (!page) return target;
    if (blockedLauncherLink !== openLink.seq) return null;
    return { ...target, embed: false, launcherUrl: launcherPageUrl(page) };
  }, [openLink, blockedLauncherLink]);
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
  const exitFallbackTimer = useRef<number | null>(null);
  const clearExitFallback = useCallback(() => {
    if (exitFallbackTimer.current === null) return;
    window.clearTimeout(exitFallbackTimer.current);
    exitFallbackTimer.current = null;
  }, []);
  const returnToLauncher = useCallback(() => {
    clearExitFallback();
    if (leaving.current) return;
    leaving.current = true;
    setExitError(null);
    void leaveGame(window.ra2Session, undefined, undefined, !fastExit.current).catch(
      (reason: unknown) => {
        leaving.current = false;
        setExitError(`Could not save before leaving: ${String(reason)}`);
      },
    );
  }, [clearExitFallback]);

  useEffect(() => () => clearExitFallback(), [clearExitFallback]);

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
    const page = launcherPage(linkTarget(openLink.url, undefined, openLink.page));
    if (!page) return;
    const opened = window.open(launcherPageUrl(page), "_blank");
    if (opened) {
      opened.opener = null;
      gameStore.dismissOpenLink();
    } else setBlockedLauncherLink(openLink.seq);
  }, [openLink]);

  useEffect(() => {
    if (!openLink || !linkDialogTarget) return;
    // the dialog is the only thing that may take the mouse while it is open
    if (document.pointerLockElement) document.exitPointerLock();
  }, [openLink, linkDialogTarget]);

  // The private-message panel is not a dialog: the game keeps running. Opening it frees the
  // mouse if the game held it; closing it, or a match starting, gives the keys back to the game.
  const togglePm = () => {
    if (pmOpen) {
      setPmOpen(false);
      canvas.current?.focus();
    } else {
      if (document.pointerLockElement) document.exitPointerLock();
      setPmOpen(true);
    }
  };
  useEffect(() => {
    if (trayQuiet && pmOpen) canvas.current?.focus();
  }, [trayQuiet, pmOpen]);

  // MESSAGES on one player: their conversation, or their profile (the player menu)
  const openPmOn = (name: string, profile: boolean) => {
    setPmFocus((last) => ({ seq: (last?.seq ?? 0) + 1, name, profile }));
    if (!pmOpen) togglePm();
  };
  const closePlayerMenu = useCallback(() => setPlayerMenu(null), []);
  const openFriends = () => {
    setPmFocus((last) => ({ seq: (last?.seq ?? 0) + 1, tab: "friends" }));
    if (!pmOpen) togglePm();
  };
  // JOIN (a friend's game, an invitation): the lobby's own Join, through the game
  const joinRoom = (room: string) => {
    if (pmOpen) togglePm();
    handle.current?.exports.ra2_join_room?.(room);
  };
  const joinAsked = useGameState((s) => s.joinRoom);
  useEffect(() => {
    if (!joinAsked || joinAsked.ok) return;
    chatHint(
      joinAsked.reason === "not in the lobby"
        ? `To join ${joinAsked.room}, go to the Custom Match lobby first.`
        : `${joinAsked.room} is not in the games list: it may have started or closed.`,
    );
  }, [joinAsked, chatHint]);
  const lastInvite = useLastInvite(presenter ? handle.current?.pm : undefined);
  useEffect(() => {
    if (lastInvite)
      chatHint(
        `${lastInvite.from} invites you to their game ${lastInvite.room}. Open MESSAGES to join.`,
      );
  }, [lastInvite, chatHint]);
  // a right-click on a lobby player: the menu opens where the click was
  useEffect(() => {
    if (!playerPick?.name || !presenter) return;
    const stageRect = stage.current?.getBoundingClientRect();
    const canvasRect = canvas.current?.getBoundingClientRect();
    const game = presenter.gameSize();
    if (!stageRect || !canvasRect || game.width <= 0 || game.height <= 0) return;
    const at = chatBoxPlace(canvasRect, stageRect, presenter.pictureRect(), game, {
      x: playerPick.x,
      y: playerPick.y,
      w: 0,
      h: 0,
    });
    setPlayerMenu({ name: playerPick.name, left: at.left, top: at.top });
  }, [playerPick, presenter]);

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
      clearExitFallback();
      reply();
      return;
    }
    if (exitFlushing.current) return;
    exitFlushing.current = true;
    exitFallbackTimer.current = window.setTimeout(() => {
      exitFallbackTimer.current = null;
      fastExit.current = true;
      returnToLauncher();
    }, FORCE_EXIT_TIMEOUT_MS);
    const flush = game.saves ? game.saves.flush() : Promise.resolve(0);
    void flush
      .then(() => {
        if (
          leaving.current ||
          gameStore.getSnapshot().exitConfirmation?.request !== pending.request
        )
          return;
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
  const answerSaveReferencePrompt = (ignore: boolean) => {
    const pending = gameStore.getSnapshot().saveReferencePrompt;
    const game = handle.current;
    if (!pending || !game) return;
    if (!game.exports.ra2_web_save_reference_reply(pending.request, Number(ignore))) {
      setBrowserError("The saved-game prompt is no longer open.");
      return;
    }
    gameStore.resolveSaveReferencePrompt(pending.request);
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

  // A game asked to start in fullscreen enters it with the loading screen. The
  // click that launched the game usually still counts as the gesture browsers
  // require; if it does not, the first click or key inside the page asks again.
  useEffect(() => {
    if (
      !fullscreenPreference.enabled ||
      fullscreenPreference.onlyInGame ||
      document.fullscreenElement
    )
      return;
    let live = true;
    let requesting = false;
    const ask = () => {
      if (!live || requesting || document.fullscreenElement) return;
      requesting = true;
      void enterFullscreen(document.documentElement)
        .catch(() => {
          // no gesture yet: the listeners below get another chance
        })
        .finally(() => {
          requesting = false;
          if (document.fullscreenElement) stopAsking();
        });
    };
    const stopAsking = () => {
      window.removeEventListener("pointerdown", ask, true);
      window.removeEventListener("keydown", ask, true);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
    const onFullscreen = () => {
      if (document.fullscreenElement) stopAsking();
    };
    ask();
    if (!document.fullscreenElement) {
      window.addEventListener("pointerdown", ask, true);
      window.addEventListener("keydown", ask, true);
      document.addEventListener("fullscreenchange", onFullscreen);
    }
    return () => {
      live = false;
      stopAsking();
    };
  }, [fullscreenPreference]);

  // "Game match only": wait for the game itself to say a match is starting
  // (its loading screen included) and give the window back after the score
  // screen. The host publishes the same match state it uses for match music.
  useEffect(() => {
    if (!fullscreenPreference.enabled || !fullscreenPreference.onlyInGame) return;
    const game = handle.current;
    if (!game) return;
    let live = true;
    let inMatch = false;
    const readMatch = () => {
      try {
        const { HEAP32 } = game.memory();
        return Atomics.load(HEAP32, (game.shared >> 2) + Shared.matchState) !== 0;
      } catch {
        return false; // the module is shutting down
      }
    };
    const gesture = () => {
      if (!live || !inMatch || document.fullscreenElement) return;
      void enterFullscreen(document.documentElement).catch(() => {});
    };
    const armGestures = () => {
      window.addEventListener("pointerdown", gesture, true);
      window.addEventListener("keydown", gesture, true);
    };
    const disarmGestures = () => {
      window.removeEventListener("pointerdown", gesture, true);
      window.removeEventListener("keydown", gesture, true);
    };
    const enter = () => {
      if (document.fullscreenElement) return;
      void enterFullscreen(document.documentElement).then(disarmGestures, armGestures);
    };
    const tick = () => {
      if (!live) return;
      const now = readMatch();
      if (now === inMatch) return;
      inMatch = now;
      if (now) enter();
      else {
        disarmGestures();
        if (document.fullscreenElement) void leaveFullscreen().catch(() => {});
      }
    };
    inMatch = !readMatch(); // the first tick applies the state the match is in now
    tick();
    const timer = window.setInterval(tick, 250);
    return () => {
      live = false;
      window.clearInterval(timer);
      disarmGestures();
    };
  }, [presenter, phase, fullscreenPreference]);

  // The page's controls keep out of the way while a match plays.
  useEffect(() => {
    const game = handle.current;
    if (!presenter || !game) return;
    const tick = () => {
      try {
        setTrayQuiet(matchQuiet(game.memory().HEAP32, game.shared >> 2));
      } catch {
        // the module is shutting down
      }
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [presenter]);

  // "Game match only" gives the window back after the score screen: the
  // launcher must not stay fullscreen once the match has ended.
  useEffect(() => {
    if (!fullscreenPreference.onlyInGame) return;
    if (phase !== "exited" && phase !== "crashed") return;
    void leaveFullscreen().catch(() => {});
  }, [phase, fullscreenPreference.onlyInGame]);

  // The in-game Video setting: the host writes the size into the game's
  // INI/options (the same path the game's own Options screen uses), and a
  // skirmish or campaign in progress switches to it between two frames
  // (docs/hires.md, "Live resize in the browser").
  const changeVideo = useCallback(
    (choice: VideoChoice) => {
      setVideoChoice(choice);
      writeVideoPreference(gameId, choice);
      const size = choice === BROWSER_VIDEO_SIZE ? browserVideoSize() : choice;
      if (size) handle.current?.exports.ra2_setting(Setting.Resolution, size.w, size.h);
    },
    [gameId],
  );

  // "Match browser size" follows the window. The size goes to the game once a
  // resize has settled, so a drag costs one switch at its end; until then the
  // presenter scales the last frame.
  useEffect(() => {
    if (videoChoice !== BROWSER_VIDEO_SIZE) return;
    let timer = 0;
    const send = () => {
      const size = browserVideoSize();
      handle.current?.exports.ra2_setting(Setting.Resolution, size.w, size.h);
    };
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(send, 400);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [videoChoice]);

  // A direct visit (no launcher) has no launch-time size to apply, so keep the
  // "Match browser size" choice in the game's options once its handle is up.
  useEffect(() => {
    if (!presenter || readVideoChoice(gameId) !== BROWSER_VIDEO_SIZE) return;
    const size = browserVideoSize();
    handle.current?.exports.ra2_setting(Setting.Resolution, size.w, size.h);
  }, [presenter, gameId]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let cancelled = false;
    let stop = () => {};
    let unsubscribe = () => {};
    startOnce(files).then(
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
              !gameStore.getSnapshot().saveReferencePrompt &&
              !gameStore.getSnapshot().openLink &&
              !lanModal.current,
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
            enabled: () =>
              runtimeLive() &&
              !gameStore.getSnapshot().settings?.open &&
              !gameStore.getSnapshot().exitConfirmation &&
              !gameStore.getSnapshot().saveReferencePrompt &&
              !gameStore.getSnapshot().openLink &&
              !lanModal.current,
            // a right-click on a chat screen: the game says whose name is there (playerPick)
            onSecondaryDown: (point) => {
              if (gameStore.getSnapshot().chatField.open)
                game.exports.ra2_player_pick?.(point.x, point.y);
            },
            // typing on a chat screen: the page's box over the game's chat line
            chatBox: () =>
              gameStore.getSnapshot().chatField.keys
                ? document.querySelector<HTMLElement>("input[data-chat-box]")
                : null,
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
          const volume = startVolume(saved, window.location.search);
          game.exports.ra2_set_volume(volume);
          setVolume(volume);
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
  const testMapLaunch = testMapRequest(window.location.search) !== null;
  const crashLog = gameStore.getLog();
  const unresolvedSaveReference = crashLog.some((line) =>
    line.includes("[save] unresolved object reference"),
  );
  const liveFiles = handle.current?.files ?? null;
  const waiting = !startError && !crashed && (phase === "idle" || phase === "loading");

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
      <MapSearchStatus
        status={mapSearchStatus}
        presenter={presenter}
        stage={stage}
        canvas={canvas}
      />
      <ChatBox
        field={chatField}
        replyTo={replyTo}
        onHint={chatHint}
        presenter={presenter}
        stage={stage}
        canvas={canvas}
        send={
          presenter && handle.current?.exports.ra2_chat_send
            ? (text) => handle.current?.exports.ra2_chat_send?.(text)
            : null
        }
      />
      {playerMenu && (
        <PlayerMenu
          name={playerMenu.name}
          left={playerMenu.left}
          top={playerMenu.top}
          self={
            playerMenu.name.toLowerCase() ===
            (handle.current?.pm.getSnapshot().nick ?? "").toLowerCase()
          }
          onAddFriend={() =>
            void addFriendFor(handle.current?.pm.getSnapshot().nick ?? null, playerMenu.name).then(
              chatHint,
            )
          }
          onMessage={() => openPmOn(playerMenu.name, false)}
          onProfile={() => openPmOn(playerMenu.name, true)}
          onClose={closePlayerMenu}
        />
      )}
      {/* the game's Page and Buddy List buttons open the panel's FRIENDS, not the game's old screens */}
      <PageButton
        rect={{ x: chatField.px, y: chatField.py, w: chatField.pw, h: chatField.ph }}
        label="Page (opens friends)"
        presenter={presenter}
        stage={stage}
        canvas={canvas}
        onOpen={openFriends}
      />
      <PageButton
        rect={{ x: chatField.bx, y: chatField.by, w: chatField.bw, h: chatField.bh }}
        label="Buddy List (opens friends)"
        presenter={presenter}
        stage={stage}
        canvas={canvas}
        onOpen={openFriends}
      />
      {presenter && (trayQuiet || chatTyping !== null) && (
        <MatchChat
          chat={matchChat}
          typing={chatTyping}
          remembered={chatTarget}
          replyTo={replyTo}
          whisper={chatWhisper}
          onWhisper={setChatWhisper}
          whispers={chatOnline}
          onHint={chatHint}
          onTarget={rememberTarget}
          onTyping={(typing) => {
            setChatTyping(typing);
            if (typing === null) canvas.current?.focus();
          }}
          presenter={presenter}
          stage={stage}
          canvas={canvas}
          send={
            handle.current?.exports.ra2_match_chat_send
              ? (text, target) => {
                  // the player's own whisper: the panel's PM tab keeps it beside the answers
                  // (a whisper received shows as "(sender) text", match_chat.c)
                  const whisper = pageOf(text);
                  if (whisper)
                    gameStore.apply({
                      e: "matchMessage",
                      text: `(to ${whisper.to}) ${whisper.text}`,
                      scheme: -1,
                      style: 0,
                      pm: true,
                    });
                  handle.current?.exports.ra2_match_chat_send?.(text, target);
                }
              : null
          }
        />
      )}
      {pageCursorMode && (
        <canvas ref={pageCursorCanvas} className={styles.pageCursor} aria-hidden="true" />
      )}
      {cursorDebugMode && (
        <div ref={cursorMarker} className={styles.cursorMarker} aria-hidden="true" />
      )}
      <img ref={cursor} className={styles.cursor} alt="" aria-hidden="true" />
      <GameTray quiet={trayQuiet}>
        <button
          type="button"
          className={trayItem}
          onClick={() => handle.current?.exports.ra2_setting(Setting.Menu, 1, 0)}
        >
          <GearIcon aria-hidden="true" />
          SETTINGS <kbd>F10</kbd>
        </button>
        {liveFiles && (
          <button type="button" className={trayItem} onClick={() => setBrowseFiles(true)}>
            <FileTextIcon aria-hidden="true" />
            FILES
          </button>
        )}
        {presenter && handle.current && (
          // mounted while the game runs, shown or not: it owns the session's transport
          <LanPanel
            game={handle.current}
            className={trayItem}
            showTrigger={lanAllowed === "on"}
            request={lanAllowed === "on" ? (lanSession?.request ?? null) : null}
            activeRequest={lanAllowed === "on" ? (lanSessionActive?.request ?? null) : null}
            onContinue={(request) => {
              if (!handle.current?.exports.ra2_lan_session_reply(request, 1)) return false;
              gameStore.resolveLanSession(request);
              setLanOpen(false);
              return true;
            }}
            onCancel={(request) => {
              if (!handle.current?.exports.ra2_lan_session_reply(request, 0)) return false;
              gameStore.resolveLanSession(request);
              setLanOpen(false);
              return true;
            }}
            open={lanOpen}
            onOpenChange={setLanOpen}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              canvas.current?.focus();
            }}
          />
        )}
        {presenter && handle.current && (
          <PmTrayButton
            pm={handle.current.pm}
            open={pmOpen}
            onToggle={togglePm}
            className={trayItem}
          />
        )}
        {audio && (
          <SoundControl
            audio={audio}
            className={trayItem}
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
        <button
          type="button"
          className={trayItem}
          aria-label={fullscreen ? "Leave fullscreen" : "Fullscreen"}
          aria-pressed={fullscreen}
          onClick={toggleFullscreen}
        >
          {fullscreen ? (
            <ExitFullScreenIcon aria-hidden="true" />
          ) : (
            <EnterFullScreenIcon aria-hidden="true" />
          )}
          F11
        </button>
      </GameTray>
      {pmOpen && !trayQuiet && presenter && handle.current && (
        <PmPanel
          pm={handle.current.pm}
          onClose={togglePm}
          sku={LADDER_SKU[sourceGame(files)]}
          focus={pmFocus}
          onJoin={joinRoom}
        />
      )}
      {browseFiles && liveFiles && (
        <FileExplorer source={liveFiles} onClose={() => setBrowseFiles(false)} />
      )}
      <ExitConfirm
        open={exitConfirmation !== null}
        onAnswer={answerExitConfirmation}
        returnFocus={() => canvas.current?.focus()}
      />
      <SaveReferencePrompt
        open={saveReferencePrompt !== null}
        onAnswer={answerSaveReferencePrompt}
        returnFocus={() => canvas.current?.focus()}
      />
      <LinkDialog
        target={linkDialogTarget}
        onClose={() => gameStore.dismissOpenLink()}
        returnFocusTo={canvas.current}
      />
      <SettingsDialog
        settings={settings}
        statsOn={statsOn}
        onStatsChange={updateStats}
        videoChoice={videoChoice}
        onVideoChange={changeVideo}
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
      {lanOffNotice && (
        <Callout.Root className={styles.browserError} role="status">
          <Callout.Text>
            {lanAllowed === "build"
              ? "LAN play is not available on this site."
              : "LAN play is off. Turn it on in the launcher: Settings, LAUNCHER, LAN play."}
          </Callout.Text>
          <Button size="1" onClick={() => setLanOffNotice(false)}>
            Dismiss
          </Button>
        </Callout.Root>
      )}
      {browserError && (
        <Callout.Root className={styles.browserError} role="alert">
          <Callout.Text>{browserError}</Callout.Text>
          <Button size="1" onClick={() => setBrowserError(null)}>
            Dismiss
          </Button>
        </Callout.Root>
      )}
      <FrameStats presenter={presenter} on={statsOn} onToggle={toggleStats} />
      {waiting && <LoadingScreen state={{ phase, copy, title, edition: sourceGame(files) }} />}
      {phase === "booting" && !startError && !crashed && (
        // A Test Map launch keeps the full screen over the game's boot until the test match is
        // set up (testMapStarted); then the game's own map-loading screen shows, as in a match.
        <LoadingScreen
          state={{ phase, copy, title, edition: sourceGame(files) }}
          variant={testMapLaunch && !testMapStarted ? "full" : "chip"}
        />
      )}
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
        <CrashDialog
          message={
            unresolvedSaveReference
              ? "This saved game contains an object reference this build cannot load. Open LOG for the missing class details."
              : (exitError ?? error ?? startError?.message ?? "The game stopped.")
          }
          log={crashLog}
          onReload={() => window.location.reload()}
          onReturn={returnToLauncher}
        />
      )}
    </div>
  );
}
