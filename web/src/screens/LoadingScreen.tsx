import { useEffect, useState } from "react";
import { EDITION_BRAND } from "../components/brand";
import { formatBytes } from "../components/format";
import { KeyArt } from "../components/KeyArt";
import type { GameState } from "../game/store";
import type { GameId } from "../storage/install";
import styles from "./LoadingScreen.module.css";

const SEGMENTS = 40;

/** Seconds since this mounted, once a second. */
function useElapsed(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  return seconds;
}

/** 400 MB of 1.00 GB, or 1.10 of 2.90 GB when both share the unit. */
function sizes(done: number, total: number): string {
  const a = formatBytes(done);
  const b = formatBytes(total);
  const unit = b.split(" ")[1];
  return a.endsWith(` ${unit}`) ? `${a.slice(0, -unit!.length - 1)} of ${b}` : `${a} of ${b}`;
}

/** What the loading screen says, from the game's state: the same words whatever draws them. */
export function describeLoading(state: Pick<GameState, "phase" | "copy">) {
  const { copy } = state;
  if (copy && copy.doneFiles < copy.totalFiles) {
    const percent = copy.totalBytes > 0 ? (copy.doneBytes / copy.totalBytes) * 100 : 0;
    return {
      step: "Preparing your game files",
      detail: `${sizes(copy.doneBytes, copy.totalBytes)} · ${copy.file}`,
      percent,
    } as const;
  }
  if (state.phase === "booting" || copy) {
    return {
      step: "Starting the game",
      detail: "The game is setting itself up",
      percent: null,
    } as const;
  }
  return { step: "Getting ready", detail: "Looking for the game files", percent: null } as const;
}

/**
 * The full screen covers the file copy over the edition's art; once the game starts, only a small
 * chip remains so the game's own boot/logo screen is visible underneath.
 */
export function LoadingScreen({
  state,
  variant = "full",
}: {
  state: Pick<GameState, "phase" | "copy"> & { title?: string | null; edition?: GameId };
  /** full: the file copy and start-up screen. chip: a small status over the game's own boot screen. */
  variant?: "full" | "chip";
}) {
  const seconds = useElapsed();
  const { step, detail, percent } = describeLoading(state);
  if (variant === "chip") {
    return (
      <div className={styles.chip} role="status" aria-live="polite">
        <span>{step}</span>
        <span className={styles.muted}>{seconds} s</span>
      </div>
    );
  }
  const brand = state.edition ? EDITION_BRAND[state.edition] : null;
  const title = brand?.title ?? state.title ?? "Red Alert 2";
  const lit = percent === null ? 0 : Math.round((percent / 100) * SEGMENTS);
  return (
    <div className={styles.screen}>
      <KeyArt edition={state.edition ?? null} />
      <div className={styles.band} aria-live="polite">
        <div className={styles.title}>
          {brand?.kicker && <p className={styles.kicker}>{brand.kicker}</p>}
          <h1 className={styles.heading}>{title.toUpperCase()}</h1>
        </div>
        <div className={styles.progress}>
          <div className={styles.stepLine}>
            <span>{step}</span>
            {percent !== null && <span className={styles.percent}>{Math.round(percent)}%</span>}
          </div>
          <div
            role="progressbar"
            aria-label={step}
            aria-valuemin={0}
            aria-valuemax={100}
            {...(percent === null ? {} : { "aria-valuenow": Math.round(percent) })}
            className={styles.segments}
            data-waiting={percent === null || undefined}
          >
            {Array.from({ length: SEGMENTS }, (_, index) => (
              <span
                key={index}
                data-on={index < lit || undefined}
                style={percent === null ? { animationDelay: `${index * 0.05}s` } : undefined}
              />
            ))}
          </div>
          <div className={styles.detailLine}>
            <span className={styles.detail}>{detail}</span>
            <span>{seconds} s</span>
          </div>
        </div>
      </div>
    </div>
  );
}
