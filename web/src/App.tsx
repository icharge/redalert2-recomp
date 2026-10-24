import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Button, Callout, Code, Flex, Text, Theme } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserCheck } from "./components/BrowserCheck";
import { checkBrowser, missingRequired } from "./components/features";
import { videoFromQuery, type FileSource } from "./game/loader";
import { Import, browserDeps } from "./screens/Import";
import { Library } from "./screens/Library";
import { Play } from "./screens/Play";
import { loadBuildInfo, type BuildInfo } from "./storage/install";
import { Manifest, type GameRecord, type InstallationRecord } from "./storage/manifest";
import { opfsSaveStore, opfsTarget, removeFiles } from "./storage/opfs";
import { useUpdate } from "./update";
import { exportSaves, importSaves } from "./storage/saves";
import { ModLibrary } from "./components/ModLibrary";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { gamePath, slotFromPath } from "./paths";
import { leaveGame } from "./game/lifecycle";
import { readVideoPreference } from "./storage/video-preferences";

type Boot =
  | { name: "loading" }
  | { name: "failed"; message: string }
  | {
      name: "ready";
      build: BuildInfo;
      manifest: Manifest;
      games: GameRecord[];
      installations: InstallationRecord[];
    };

/** Routes and assets share the deployment base (for example /emu/). */
export function App() {
  const [requirements] = useState(checkBrowser);
  const missing = missingRequired(requirements).length > 0;
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Theme appearance="dark" accentColor="red" grayColor="slate" radius="small">
        {missing ? <BrowserCheck requirements={requirements} /> : <Main />}
        <UpdatePrompt />
      </Theme>
    </BrowserRouter>
  );
}

function Main() {
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const test = query.get("test") === "1";
  const dev = import.meta.env.DEV && query.has("dev");
  const fixture = test || dev;
  const [boot, setBoot] = useState<Boot>({ name: "loading" });
  const target = useMemo(() => opfsTarget(), []);
  const route = location.pathname + location.search;
  const runtimeRoute = useRef(route);
  const manifestRef = useRef<Manifest | null>(null);
  // A classic Emscripten build cannot be reused after a screen switch. This
  // also catches browser Back/Forward while a game has a pending startup.
  const leaving = !!window.ra2Session && runtimeRoute.current !== route;
  if (!window.ra2Session) runtimeRoute.current = route;

  const refresh = useCallback(
    async (manifest: Manifest) => ({
      games: await manifest.listGames(),
      installations: await manifest.listInstallations(),
    }),
    [],
  );

  useEffect(() => {
    if (fixture) return;
    let live = true;
    let opened: Manifest | null = null;
    void (async () => {
      try {
        const manifest = await Manifest.open();
        opened = manifest;
        if (!live) {
          manifest.close();
          return;
        }
        manifestRef.current = manifest;
        const build = await loadBuildInfo();
        const records = await refresh(manifest);
        if (live) setBoot({ name: "ready", build, manifest, ...records });
      } catch (error) {
        if (live)
          setBoot({
            name: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
      }
    })();
    return () => {
      live = false;
      opened?.close();
      manifestRef.current = null;
    };
  }, [fixture, refresh]);

  useEffect(() => {
    const manifest = manifestRef.current;
    if (fixture || location.pathname !== "/" || !manifest) return;
    let live = true;
    void refresh(manifest).then((records) => {
      if (live) setBoot((previous) => previous.name === "ready" ? { ...previous, ...records } : previous);
    }).catch((error: unknown) => {
      if (live) setBoot({ name: "failed", message: String(error) });
    });
    return () => { live = false; };
  }, [location.pathname, fixture, refresh]);

  if (leaving) return <UnloadGame destination={window.location.href} />;
  const video = videoFromQuery(location.search);
  const game = query.get("target") === "game" ? "ra2" : "ra2md";
  if (test) return <Play files={{ kind: "test-folder", game, video }} />;
  if (dev) return <Play files={{ kind: "dev-folder", game, video }} />;
  if (boot.name === "loading") return <Centered>Starting…</Centered>;
  if (boot.name === "failed")
    return (
      <Flex align="center" justify="center" p="6" style={{ minHeight: "100vh" }}>
        <Callout.Root color="amber" role="alert" size="3">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            The game isn&apos;t built. Build Yuri&apos;s Revenge with <Code>build-web.cmd</Code> (or{" "}
            <Code>./build-web.sh</Code>). For Red Alert 2, set <Code>RA2_TARGET=game</Code> first.
            Then reload. ({boot.message})
          </Callout.Text>
        </Callout.Root>
      </Flex>
    );

  const { build, manifest, games, installations } = boot;
  const reload = async () => setBoot({ ...boot, ...(await refresh(manifest)) });
  const resume = slotFromPath(query.get("resume") ?? undefined);
  const library = (
    <Library
      games={games}
      installations={installations}
      modManager={(game) => <ModLibrary game={game.storage} manifest={manifest} target={target} />}
      onPlay={(game) => navigate(gamePath(game.slot, game.id))}
      onImport={() => navigate("/import")}
      onResume={(slot) => navigate(`/import?resume=${slot}`)}
      onRenameInstallation={async (installation, displayName) => {
        await manifest.renameInstallation(installation.slot, displayName);
        await reload();
      }}
      onDownloadSaves={async (game) => {
        const zip = await exportSaves(opfsSaveStore(), game.storage);
        if (!zip) return "There are no saved games yet.";
        const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `slot-${game.slot}-${game.id}-saves.zip`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return "The saved games are downloading.";
      }}
      onImportSaves={async (game, file) => {
        const count = await importSaves(
          new Uint8Array(await file.arrayBuffer()),
          target,
          game.storage,
        );
        return count === 0
          ? "That zip has no saved games in it."
          : `${count} saved game${count === 1 ? "" : "s"} brought in. They are there when the game starts.`;
      }}
      onRemove={async (game) => {
        await removeFiles(target, await manifest.removeInstallation(game.slot));
        await reload();
      }}
    />
  );
  return (
    <Routes>
      <Route path="/" element={library} />
      <Route
        path="/import"
        element={
          query.has("resume") &&
          (!resume || !installations.some((entry) => entry.slot === resume)) ? (
            <RouteError message="That installation was not found." />
          ) : (
            <Flex direction="column">
              <Link to="/">Back to launcher</Link>
              <Import
                key={resume ?? "new"}
                deps={browserDeps(build, manifest, target)}
                {...(resume ? { slot: resume } : {})}
                onDone={() => {
                  void reload().then(() => navigate("/"));
                }}
              />
            </Flex>
          )
        }
      />
      <Route path="/game/:slot" element={<InstallationGame games={games} installations={installations} />} />
      <Route path="*" element={<RouteError message="That page was not found." />} />
    </Routes>
  );
}

function InstallationGame({ games, installations }: { games: GameRecord[]; installations: InstallationRecord[] }) {
  const { slot: value } = useParams();
  const location = useLocation();
  const slot = slotFromPath(value);
  const query = new URLSearchParams(location.search);
  const choices = games.filter((game) => game.slot === slot);
  const installation = installations.find((entry) => entry.slot === slot);
  const planned = installation?.editions ?? choices.map((game) => game.id);
  const edition =
    query.get("edition") ?? (planned.includes("ra2md") ? "ra2md" : "ra2");
  const selected = choices.find((game) => game.id === edition);
  const files = useMemo<FileSource | null>(
    () =>
      selected
        ? {
            kind: "opfs",
            record: selected,
            video: videoFromQuery(location.search) ?? readVideoPreference(selected.storage),
          }
        : null,
    [selected, location.search],
  );
  if (!slot || !installation) return <RouteError message="That installation was not found." />;
  if (!choices.length || (!selected && planned.some((id) => id === edition)))
    return <RouteError message="This installation's import did not finish." resume={slot} />;
  if (!selected)
    return <RouteError message="That edition is not available in this installation." />;
  if (!selected.complete)
    return <RouteError message="This installation's import did not finish." resume={slot} />;
  return files && <Play key={`${slot}:${edition}`} files={files} />;
}

function RouteError({ message, resume }: { message: string; resume?: number }) {
  return (
    <Flex direction="column" align="center" gap="3" p="6">
      <Text role="alert">{message}</Text>
      {resume && <Link to={`/import?resume=${resume}`}>Resume import</Link>}
      <Link to="/">Back to launcher</Link>
    </Flex>
  );
}

function UnloadGame({ destination }: { destination: string }) {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const go = () => {
    void leaveGame(window.ra2Session, destination).catch((reason: unknown) =>
      setError(String(reason)),
    );
  };
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      go();
    }
  });
  return (
    <Flex direction="column" align="center" gap="3" p="6">
      <Text>{error ? `Could not save before leaving: ${error}` : "Returning…"}</Text>
      {error && <Button onClick={go}>Retry</Button>}
    </Flex>
  );
}

/** A new build of the page and the game is waiting: say so, and let the player choose when to reload. */
function UpdatePrompt() {
  const apply = useUpdate();
  if (!apply) return null;
  return (
    <Flex
      justify="center"
      style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 10 }}
      p="2"
    >
      <Callout.Root color="blue" role="status" size="1">
        <Callout.Text>
          <Flex align="center" gap="3">
            A new version is ready.
            <Button size="1" onClick={apply}>
              Reload
            </Button>
          </Flex>
        </Callout.Text>
      </Callout.Root>
    </Flex>
  );
}

function Centered({ children }: { children: string }) {
  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
      <Text color="gray">{children}</Text>
    </Flex>
  );
}
