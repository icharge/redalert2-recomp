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
  settings: HostSettings | null;
  restart: { mod: string } | null;
}

const INITIAL: GameState = {
  phase: "idle",
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
  line(text: string): void {
    this.lines.push(text);
    (globalThis as { ra2Tap?: (line: string) => void }).ra2Tap?.(text); // the e2e scripts keep every line
    if (this.lines.length > LOG_LINES) this.lines.splice(0, this.lines.length - LOG_LINES);
    const event = parseEventLine(text);
    if (event) this.apply(event);
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
      case "settings":
        this.set({ settings: event });
        return;
      case "restart":
        this.set({ restart: { mod: event.mod } });
        return;
      case "mode":
        this.set({ size: { w: event.w, h: event.h } });
        return;
      case "fps":
        this.set({ fps: event.fps, ms: event.ms, pacing: event.pacing });
        return;
      case "exit":
        // a crash already says why; an exit after it is the runtime shutting down
        if (this.state.phase !== "crashed")
          this.set({ phase: "exited", exitCode: event.code, exitConfirmation: null });
        return;
      case "exitConfirm":
        this.set({ exitConfirmation: { request: event.request } });
        return;
      case "error":
        this.set({ error: event.message });
        return;
    }
  }

  resolveExitConfirmation(request: number): void {
    if (this.state.exitConfirmation?.request === request) this.set({ exitConfirmation: null });
  }

  /** The game's thread died (a trap), or the runtime aborted. */
  crashed(what: string): void {
    this.set({ phase: "crashed", error: what, exitConfirmation: null });
  }
}

export const gameStore = new GameStore();

/** A piece of the game's state; the selector must return a primitive or an unchanged reference. */
export function useGameState<T>(select: (state: GameState) => T, store: GameStore = gameStore): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()));
}
