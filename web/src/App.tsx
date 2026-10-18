import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Callout, Code, Flex, Text, Theme } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserCheck } from "./components/BrowserCheck";
import { checkBrowser, missingRequired } from "./components/features";
import { videoFromQuery, type FileSource } from "./game/loader";
import { Import, browserDeps } from "./screens/Import";
import { Library } from "./screens/Library";
import { Play } from "./screens/Play";
import { loadBuildInfo, type BuildInfo } from "./storage/install";
import { Manifest, type GameRecord } from "./storage/manifest";
import { opfsTarget, removeFiles } from "./storage/opfs";

type Boot =
  | { name: "loading" }
  | { name: "failed"; message: string }
  | { name: "ready"; build: BuildInfo; manifest: Manifest; games: GameRecord[] };

type View = "library" | "import" | { play: FileSource };

/**
 * The theme, and one screen at a time, chosen by state (no routing): the browser check, then Import
 * until a game is in the browser, then the Library, then Play. `?dev` (dev server only) goes straight to
 * Play with the dev server's local game folder, which the end-to-end checks use.
 */
export function App() {
  const [requirements] = useState(checkBrowser);
  const missing = missingRequired(requirements).length > 0;
  return (
    <Theme appearance="dark" accentColor="red" grayColor="slate" radius="small">
      {missing ? <BrowserCheck requirements={requirements} /> : <Main />}
    </Theme>
  );
}

function Main() {
  const dev = import.meta.env.DEV && new URLSearchParams(window.location.search).has("dev");
  const [boot, setBoot] = useState<Boot>({ name: "loading" });
  const [view, setView] = useState<View | null>(null);
  const target = useMemo(() => opfsTarget(), []);

  const refresh = useCallback(async (manifest: Manifest) => manifest.listGames(), []);

  useEffect(() => {
    if (dev) return;
    let live = true;
    Promise.all([loadBuildInfo(), Manifest.open()]).then(
      async ([build, manifest]) => {
        const games = await refresh(manifest);
        if (!live) return;
        setBoot({ name: "ready", build, manifest, games });
        setView(games.some((game) => game.complete) ? "library" : "import");
      },
      (error: unknown) => {
        if (live)
          setBoot({
            name: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      live = false;
    };
  }, [dev, refresh]);

  const video = videoFromQuery(window.location.search);
  if (dev) return <Play files={{ kind: "dev-folder", video }} />;

  if (boot.name === "loading") return <Centered>Starting…</Centered>;
  if (boot.name === "failed")
    return (
      <Flex align="center" justify="center" p="6" style={{ minHeight: "100vh" }}>
        <Callout.Root color="amber" role="alert" size="3">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            The game isn&apos;t built. Run <Code>build-web.cmd</Code> (or{" "}
            <Code>./build-web.sh</Code>) in the repository root, then reload. ({boot.message})
          </Callout.Text>
        </Callout.Root>
      </Flex>
    );

  const { build, manifest, games } = boot;
  const reload = async () => setBoot({ ...boot, games: await refresh(manifest) });

  if (typeof view === "object" && view) return <Play files={view.play} />;
  if (view === "import")
    return (
      <Import
        deps={browserDeps(build, manifest, target)}
        onDone={() => {
          void reload().then(() => setView("library"));
        }}
      />
    );
  return (
    <Library
      games={games}
      onPlay={(game) => setView({ play: { kind: "opfs", record: game, video } })}
      onImport={() => setView("import")}
      onRemove={async (game) => {
        const doomed = await manifest.removeGame(game.id);
        await removeFiles(target, doomed);
        const left = await refresh(manifest);
        setBoot({ ...boot, games: left });
        if (left.length === 0) setView("import");
      }}
    />
  );
}

function Centered({ children }: { children: string }) {
  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
      <Text color="gray">{children}</Text>
    </Flex>
  );
}
