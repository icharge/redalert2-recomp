import { Flex, Heading, Progress, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { formatBytes } from "../components/format";
import type { GameState } from "../game/store";
import styles from "./LoadingScreen.module.css";

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

/** What the loading screen says, from the game's state: the same words whatever draws them. */
export function describeLoading(state: Pick<GameState, "phase" | "copy">) {
  const { copy } = state;
  if (copy && copy.doneFiles < copy.totalFiles) {
    const percent = copy.totalBytes > 0 ? (copy.doneBytes / copy.totalBytes) * 100 : 0;
    return {
      step: "Preparing your game files",
      detail: `${formatBytes(copy.doneBytes)} of ${formatBytes(copy.totalBytes)} · ${copy.file} (${copy.doneFiles + 1} of ${copy.totalFiles})`,
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
 * The full screen covers the file copy; once the game starts, only a small chip remains so the
 * game's own boot/logo screen is visible underneath.
 */
export function LoadingScreen({
  state,
  variant = "full",
}: {
  state: Pick<GameState, "phase" | "copy"> & { title?: string | null };
  /** full: the file copy and start-up card. chip: a small status over the game's own boot screen. */
  variant?: "full" | "chip";
}) {
  const seconds = useElapsed();
  const { step, detail, percent } = describeLoading(state);
  if (variant === "chip") {
    return (
      <Flex
        style={{
          position: "absolute",
          left: "var(--space-3)",
          bottom: "var(--space-3)",
          zIndex: 5,
          padding: "var(--space-1) var(--space-3)",
          borderRadius: "var(--radius-3)",
          background: "color-mix(in srgb, var(--color-background) 72%, transparent)",
          pointerEvents: "none",
        }}
        align="center"
        gap="2"
        role="status"
        aria-live="polite"
      >
        <Text size="1" weight="medium">
          {step}
        </Text>
        <Text size="1" color="gray">
          {seconds} s
        </Text>
      </Flex>
    );
  }
  return (
    <Flex
      className={styles.screen}
      align="center"
      justify="center"
      direction="column"
      gap="4"
      p="6"
      aria-live="polite"
    >
      <Heading size="7" align="center">
        {state.title ?? "Red Alert 2"}
      </Heading>
      <Flex direction="column" gap="2" className={styles.card}>
        <Text size="4" weight="medium">
          {step}
        </Text>
        {percent === null ? (
          <Progress key="starting" duration="25s" aria-label={step} />
        ) : (
          <Progress key="copying" value={percent} max={100} aria-label={step} />
        )}
        <Flex justify="between" gap="3">
          <Text size="2" color="gray" className={styles.detail}>
            {detail}
          </Text>
          <Text size="2" color="gray">
            {seconds} s
          </Text>
        </Flex>
      </Flex>
      <Text size="1" color="gray" align="center">
        Your files stay in this browser tab; nothing is uploaded.
      </Text>
    </Flex>
  );
}
