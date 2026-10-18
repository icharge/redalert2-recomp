import { CrossCircledIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Button, Callout, Code, Flex, Heading, ScrollArea } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { attachInput } from "../game/input";
import { argsFromQuery, GameNotBuilt, startGame, type GameHandle } from "../game/loader";
import { Presenter } from "../game/presenter";
import { gameStore, useGameState } from "../game/store";
import { LoadingScreen } from "./LoadingScreen";
import styles from "./Play.module.css";

// The game starts once per page load, whatever React remounts (StrictMode, a screen switch).
let session: Promise<GameHandle> | null = null;
function startOnce(): Promise<GameHandle> {
  session ??= startGame({
    // until the import exists (stage 6), the dev server's local game folder
    files: import.meta.env.DEV ? { kind: "dev-folder" } : { kind: "already-there" },
    args: argsFromQuery(window.location.search),
  });
  return session;
}

/** Until the import exists (stage 6), only the dev server has a game folder to give. */
const HAS_FILES = import.meta.env.DEV;

/** The canvas fills the window; the game draws into it through shared memory. React never touches it again. */
export function Play() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [startError, setStartError] = useState<Error | null>(null);
  const phase = useGameState((s) => s.phase);
  const copy = useGameState((s) => s.copy);
  const title = useGameState((s) => s.title);
  const error = useGameState((s) => s.error);
  const exitCode = useGameState((s) => s.exitCode);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !HAS_FILES) return;
    let cancelled = false;
    let stop = () => {};
    startOnce().then(
      (game) => {
        if (cancelled) return;
        const presenter = new Presenter(element, game.memory, game.shared);
        presenter.start();
        const detach = attachInput(element, game.exports);
        const observer = new ResizeObserver(([entry]) => {
          if (!entry) return;
          const { width, height } = entry.contentRect;
          game.exports.ra2_resize(Math.round(width), Math.round(height), window.devicePixelRatio);
        });
        observer.observe(element);
        element.focus();
        stop = () => {
          presenter.stop();
          detach();
          observer.disconnect();
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
  }, []);

  const crashed = phase === "crashed";
  const waiting =
    HAS_FILES &&
    !startError &&
    !crashed &&
    (phase === "idle" || phase === "loading" || phase === "booting");

  return (
    <div className={styles.stage}>
      <canvas ref={canvas} className={styles.canvas} tabIndex={0} aria-label="The game" />
      {waiting && <LoadingScreen state={{ phase, copy, title }} />}
      {!HAS_FILES && (
        <Flex className={styles.overlay} align="center" justify="center" p="6">
          <Callout.Root color="amber" role="alert" size="3">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              There is no game to start yet: importing your own game folder isn't built (stage 6 in
              docs/web/plan.md). To try it now, put the game folder at <Code>../game</Code> and run{" "}
              <Code>pnpm dev</Code> in <Code>web/</Code>.
            </Callout.Text>
          </Callout.Root>
        </Flex>
      )}
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
