import { useSyncExternalStore } from "react";
import {
  RA2_WEB_PROTOCOL,
  parseEventLine,
  type GameEvent,
  type Pacing,
  type HostSettings,
} from "./protocol";

export type Phase = "idle" | "loading" | "booting" | "running" | "exited" | "crashed";

/** The game files going into the in-memory file system: bytes, and which file. */
export interface CopyProgress {
  doneBytes: number;
  totalBytes: number;
  doneFiles: number;
  totalFiles: number;
  file: string;
}

/** A link the game asked the system browser to open (the `open` event). */
export interface OpenLink {
  seq: number;
  /** the game's own URL; "" when it only named a WOL page */
  url: string;
  ask: number;
  /** the page key YR's embedded browser asked for (Community, Ladder, News, ...) */
  page?: string;
}

/** The map search's status (src/web/map_search.c): the list's place, and whether nothing matched. */
export type MapSearchStatus = Omit<Extract<GameEvent, { e: "mapSearch" }>, "e">;

/** The game's chat line, where the page lays its chat box (src/web/chat_box.c). */
export type ChatField = Omit<Extract<GameEvent, { e: "chatField" }>, "e">;

/**
 * A line of the match's messages (src/web/match_chat.c), numbered as it came: a player's chat line,
 * or (system) a row of the game's own (mission text, a player defeated, a page), with no name.
 */
export type MatchChatLine = Omit<Extract<GameEvent, { e: "matchChat" }>, "e"> & {
  id: number;
  /** milliseconds since the epoch */
  at: number;
  system?: boolean;
  /** a whisper (to or from this player): the panel's PM tab */
  pm?: boolean;
};

/** The match's chat: whether the panel can send, and the lines so far (oldest first). */
export interface MatchChat {
  ready: boolean;
  lines: readonly MatchChatLine[];
  /** the last time a chat key of the game asked for the panel's line (seq counts them) */
  open?: { seq: number; to: number };
}

/** How many match chat lines are kept. */
export const MATCH_CHAT_LINES = 100;

export interface GameState {
  phase: Phase;
  /** what is being loaded, while it loads (a file name, "game files") */
  loading: string | null;
  /** how far the copy of the game files is, while it runs */
  copy: CopyProgress | null;
  title: string | null;
  size: { w: number; h: number } | null;
  fps: number | null;
  ms: number | null;
  pacing: Pacing | null;
  /** something the player should see: a missing file, or why the game stopped */
  error: string | null;
  exitCode: number | null;
  exitConfirmation: { request: number } | null;
  saveReferencePrompt: { request: number } | null;
  /** a WOL-era link: the page shows our dialog instead of the system browser */
  openLink: OpenLink | null;
  mapSearchStatus: MapSearchStatus;
  chatField: ChatField;
  /** the last right-click on a lobby player (seq counts them): the player menu opens for it */
  playerPick: { seq: number; name: string; x: number; y: number } | null;
  /** the last join the page asked for (ra2_join_room) and how it went; seq counts them */
  joinRoom: { seq: number; room: string; ok: boolean; reason: string } | null;
  matchChat: MatchChat;
  settings: HostSettings | null;
  restart: { mod: string } | null;
  /** FA2EX Test Map: the test match was set up and its map is loading (testMapStarted) */
  testMapStarted: boolean;
}

const INITIAL: GameState = {
  phase: "idle",
  testMapStarted: false,
  loading: null,
  copy: null,
  title: null,
  size: null,
  fps: null,
  ms: null,
  pacing: null,
  error: null,
  exitCode: null,
  exitConfirmation: null,
  saveReferencePrompt: null,
  openLink: null,
  mapSearchStatus: { open: false, noMatches: false, x: 0, y: 0, w: 0, h: 0 },
  chatField: {
    open: false,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    px: 0,
    py: 0,
    pw: 0,
    ph: 0,
    bx: 0,
    by: 0,
    bw: 0,
    bh: 0,
    keys: false,
  },
  playerPick: null,
  joinRoom: null,
  matchChat: { ready: false, lines: [] },
  settings: null,
  restart: null,
};

/** How many log lines are kept for the crash report. */
export const LOG_LINES = 3000;

/**
 * The game's state, from its events (docs/web/protocol.md). One external store, read
 * with useSyncExternalStore. A change notifies listeners only when an event changes
 * the state: log lines never do, and `fps` at most once a second.
 */
export class GameStore {
  private state: GameState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private lines: string[] = [];

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): GameState => this.state;

  /** The last log lines, oldest first. */
  getLog(): readonly string[] {
    return this.lines;
  }

  private set(patch: Partial<GameState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  /** A new run: clears the last one. */
  begin(): void {
    this.lines = [];
    this.state = { ...INITIAL, phase: "loading", loading: "the game" };
    this.listeners.forEach((listener) => listener());
  }

  loading(what: string): void {
    this.set({ phase: "loading", loading: what, copy: null });
  }

  /** The copy of the game files moved on. */
  copying(copy: CopyProgress): void {
    this.set({
      phase: "loading",
      loading: `${copy.file} (${copy.doneFiles} of ${copy.totalFiles})`,
      copy,
    });
  }

  /** One line of the game's output: logged, and applied if it is an event. */
  line(text: string): GameEvent | null {
    this.lines.push(text);
    (globalThis as { ra2Tap?: (line: string) => void }).ra2Tap?.(text); // the e2e scripts keep every line
    if (this.lines.length > LOG_LINES) this.lines.splice(0, this.lines.length - LOG_LINES);
    const event = parseEventLine(text);
    if (event) this.apply(event);
    return event;
  }

  apply(event: GameEvent): void {
    switch (event.e) {
      case "boot":
        if (event.protocol !== RA2_WEB_PROTOCOL) {
          this.set({
            phase: "crashed",
            error:
              `The page speaks protocol ${RA2_WEB_PROTOCOL} and this game build speaks ${event.protocol}: ` +
              "a stale copy of the game is cached. Reload the page.",
          });
          return;
        }
        this.set({ phase: "booting", loading: null, copy: null, title: event.title });
        return;
      case "menu":
        this.set({ phase: "running", loading: null });
        return;
      case "testMapStarted":
        this.set({ testMapStarted: true });
        return;
      case "settings":
        this.set({ settings: event });
        return;
      case "restart":
        this.set({ restart: { mod: event.mod } });
        return;
      case "mode":
        this.set({ size: { w: event.w, h: event.h } });
        return;
      case "mapSearch":
        this.set({
          mapSearchStatus: {
            open: event.open,
            noMatches: event.noMatches,
            x: event.x,
            y: event.y,
            w: event.w,
            h: event.h,
          },
        });
        return;
      case "chatField":
        this.set({
          chatField: {
            open: event.open,
            x: event.x,
            y: event.y,
            w: event.w,
            h: event.h,
            px: event.px,
            py: event.py,
            pw: event.pw,
            ph: event.ph,
            bx: event.bx,
            by: event.by,
            bw: event.bw,
            bh: event.bh,
            keys: event.keys,
          },
        });
        return;
      case "matchChat": {
        const { name, text, colour, own, to } = event;
        const line = { name, text, colour, own, to };
        const last = this.state.matchChat.lines.at(-1);
        const lines = [
          ...this.state.matchChat.lines,
          { ...line, id: (last?.id ?? 0) + 1, at: Date.now() },
        ].slice(-MATCH_CHAT_LINES);
        this.set({ matchChat: { ...this.state.matchChat, lines } });
        return;
      }
      case "matchMessage": {
        const last = this.state.matchChat.lines.at(-1);
        const line: MatchChatLine = {
          name: "",
          text: event.text,
          colour: -1,
          own: false,
          to: 0,
          system: true,
          ...(event.pm ? { pm: true } : {}),
          id: (last?.id ?? 0) + 1,
          at: Date.now(),
        };
        const lines = [...this.state.matchChat.lines, line].slice(-MATCH_CHAT_LINES);
        this.set({ matchChat: { ...this.state.matchChat, lines } });
        return;
      }
      case "joinRoom":
        this.set({
          joinRoom: {
            seq: (this.state.joinRoom?.seq ?? 0) + 1,
            room: event.room,
            ok: event.ok,
            reason: event.reason,
          },
        });
        return;
      case "playerPick":
        this.set({
          playerPick: {
            seq: (this.state.playerPick?.seq ?? 0) + 1,
            name: event.name,
            x: event.x,
            y: event.y,
          },
        });
        return;
      case "matchChatOpen":
        this.set({
          matchChat: {
            ...this.state.matchChat,
            open: { seq: (this.state.matchChat.open?.seq ?? 0) + 1, to: event.to },
          },
        });
        return;
      case "matchChatReady":
        // the lines stay: like a chat window's history, across matches (MATCH_CHAT_LINES at most)
        if (event.on !== this.state.matchChat.ready)
          this.set({ matchChat: { ...this.state.matchChat, ready: event.on } });
        return;
      case "fps":
        this.set({ fps: event.fps, ms: event.ms, pacing: event.pacing });
        return;
      case "exit":
        // a crash already says why; an exit after it is the runtime shutting down
        if (this.state.phase !== "crashed")
          this.set({
            phase: "exited",
            exitCode: event.code,
            exitConfirmation: null,
            openLink: null,
          });
        return;
      case "exitConfirm":
        this.set({ exitConfirmation: { request: event.request } });
        return;
      case "saveReference":
        this.set({ saveReferencePrompt: { request: event.request } });
        return;
      case "open": {
        const link: OpenLink = { seq: event.seq, url: event.url, ask: event.ask };
        if (event.page !== undefined) link.page = event.page;
        this.set({ openLink: link });
        return;
      }
      case "settingsSaved":
        return;
      case "error":
        this.set({ error: event.message });
        return;
    }
  }

  resolveExitConfirmation(request: number): void {
    if (this.state.exitConfirmation?.request === request) this.set({ exitConfirmation: null });
  }

  resolveSaveReferencePrompt(request: number): void {
    if (this.state.saveReferencePrompt?.request === request)
      this.set({ saveReferencePrompt: null });
  }

  /** The player closed the link dialog (the game keeps running). */
  dismissOpenLink(): void {
    if (this.state.openLink) this.set({ openLink: null });
  }

  /** The game's thread died (a trap), or the runtime aborted. */
  crashed(what: string): void {
    this.set({ phase: "crashed", error: what, exitConfirmation: null, openLink: null });
  }
}

export const gameStore = new GameStore();

/** A piece of the game's state; the selector must return a primitive or an unchanged reference. */
export function useGameState<T>(select: (state: GameState) => T, store: GameStore = gameStore): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()));
}
