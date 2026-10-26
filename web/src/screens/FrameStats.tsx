import { useEffect, useState } from "react";
import type { Pacing } from "../game/protocol";
import type { GamePresenter, PresenterCounters } from "../game/presenter";
import { useGameState } from "../game/store";
import styles from "./FrameStats.module.css";

/** What the overlay shows, from two samples of the presenter's totals a second or so apart. */
export interface FrameRates {
  /** pictures the game published and the page drew, per second */
  pictures: number;
  /** the page's animation frames per second */
  ticks: number;
  /** the mean time one animation frame spent drawing, in ms */
  drawMs: number;
}

export function frameRates(
  before: PresenterCounters,
  after: PresenterCounters,
  seconds: number,
): FrameRates {
  const ticks = after.ticks - before.ticks;
  return {
    pictures: seconds > 0 ? (after.pictures - before.pictures) / seconds : 0,
    ticks: seconds > 0 ? ticks / seconds : 0,
    drawMs: ticks > 0 ? (after.drawMs - before.drawMs) / ticks : 0,
  };
}

/** The overlay's text: the game's own rate (0 in a menu), what the page draws, and the picture's size. */
export function describeFrameStats(
  rates: FrameRates,
  game: { fps: number | null; ms: number | null; pacing?: Pacing | null },
  size: { w: number; h: number } | null,
): string[] {
  const gameLine = game.fps ? `game ${game.fps} fps (${game.ms} ms a frame)` : "game: in a menu";
  const pacing = game.fps && game.pacing ? game.pacing : null;
  return [
    gameLine,
    ...(pacing
      ? [
          `worst gap ${pacing.worstMs} ms, ${pacing.late} late`,
          `publish ${pacing.published}/s, ${pacing.publishMs.toFixed(1)} ms each`,
        ]
      : []),
    `page ${Math.round(rates.pictures)} pictures/s, ${Math.round(rates.ticks)} frames/s`,
    `draw ${rates.drawMs.toFixed(2)} ms a frame`,
    size ? `${size.w} x ${size.h}` : "no picture yet",
  ];
}

const KEY = "ra2-stats";

/** Whether the overlay was asked for: `?stats` in the address, or switched on last time. */
export function statsWanted(search: string, storage: Pick<Storage, "getItem"> | null): boolean {
  if (new URLSearchParams(search).has("stats")) return true;
  try {
    return storage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberStats(on: boolean, storage: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(KEY, on ? "1" : "0");
  } catch {
    // no storage (a private window): the choice just does not last
  }
}

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** A small readout over the picture: Alt+Shift+F shows or hides it. */
export function FrameStats({ presenter }: { presenter: GamePresenter | null }) {
  const [on, setOn] = useState(() => statsWanted(window.location.search, localStorageOrNull()));
  const [rates, setRates] = useState<FrameRates>({ pictures: 0, ticks: 0, drawMs: 0 });
  const fps = useGameState((s) => s.fps);
  const ms = useGameState((s) => s.ms);
  const pacing = useGameState((s) => s.pacing);
  const size = useGameState((s) => s.size);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.code === "KeyF") {
        event.preventDefault();
        setOn((was) => {
          rememberStats(!was, localStorageOrNull());
          return !was;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!on || !presenter) return;
    let last = presenter.counters();
    let at = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const next = presenter.counters();
      setRates(frameRates(last, next, (now - at) / 1000));
      last = next;
      at = now;
    }, 1000);
    return () => window.clearInterval(timer);
  }, [on, presenter]);

  if (!on) return null;
  return (
    <div className={styles.stats} aria-hidden="true">
      {describeFrameStats(rates, { fps, ms, pacing }, size).map((line) => (
        <div key={line.split(" ")[0]}>{line}</div>
      ))}
    </div>
  );
}
