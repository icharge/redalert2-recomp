import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Button, Callout, Code, Flex, Text, Theme } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserCheck } from "./components/BrowserCheck";
import { checkBrowser, missingRequired } from "./components/features";
import { UpdateStrip } from "./components/UpdateStrip";
import { videoFromQuery, type FileSource } from "./game/loader";
import { Import, browserDeps } from "./screens/Import";
import { GameScreen } from "./screens/launcher/GameScreen";
import { ModsScreen } from "./screens/launcher/ModsScreen";
import { PlayScreen } from "./screens/launcher/PlayScreen";
import {
  isSettingsTab,
  SettingsEmpty,
  SettingsScreen,
} from "./screens/launcher/settings/SettingsScreen";
import { Shell } from "./screens/launcher/Shell";
import { Play } from "./screens/Play";
import {
  pickActiveInstall,
  pickEdition,
  readActiveSlot,
  readRememberedEdition,
  writeActiveSlot,
  writeRememberedEdition,
  type ActiveInstall,
} from "./storage/active-install";
import { readActiveMod, writeActiveMod } from "./storage/active-mod";
import { loadBuildInfo, type BuildInfo } from "./storage/install";
import { Manifest, type GameRecord, type InstallationRecord } from "./storage/manifest";
import { listMods, type ModRecord } from "./storage/mods";
import { serial } from "./storage/serial";
import {
  missingGameFiles,
  opfsSaveStore,
  opfsTarget,
  readGameFile,
  removeFiles,
  type CopyTarget,
} from "./storage/opfs";
import { exportSaves, importSaves, isSavePath } from "./storage/saves";
import { managedInstallationSource } from "./storage/file-manager";
import { reconcileInstallation } from "./storage/reconcile";
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { gamePath, slotFromPath } from "./paths";
import { leaveGame } from "./game/lifecycle";
import { readVideoPreference } from "./storage/video-preferences";
import { readFullscreenPreference } from "./storage/fullscreen-preferences";
import { cursorChoice } from "./storage/cursor-preferences";
import { enterFullscreen } from "./game/browser-controls";

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
        <UpdateStrip />
      </Theme>
    </BrowserRouter>
  );
}

/** Every mod of each edition and its active one, keyed by `game.storage`. */
interface ModState {
  mods: Record<string, ModRecord[]>;
  active: Record<string, string>;
}

function Main() {
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const test = query.get("test") === "1";
  const dev = import.meta.env.DEV && query.has("dev");
  const fixture = test || dev;
  const [boot, setBoot] = useState<Boot>({ name: "loading" });
  const [activeSlot, setActiveSlot] = useState(() => readActiveSlot());
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [modState, setModState] = useState<ModState>({ mods: {}, active: {} });
  const [modsVersion, setModsVersion] = useState(0);
  const target = useMemo(() => opfsTarget(), []);
  // The file check and removals both rewrite the manifest: one at a time, so a removal is not undone
  // by a check that read the records before it.
  const manifestWork = useMemo(() => serial(), []);
  const route = location.pathname + location.search;
  const runtimeRoute = useRef(route);
  const manifestRef = useRef<Manifest | null>(null);
  // A classic Emscripten build cannot be reused after a screen switch. This
  // also catches browser Back/Forward while a game has a pending startup.
  const leaving = !!window.ra2Session && runtimeRoute.current !== route;
  if (!window.ra2Session) runtimeRoute.current = route;
  const launcherPage = !location.pathname.startsWith("/game/") && location.pathname !== "/import";

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
    if (fixture || !launcherPage || boot.name !== "ready" || !manifest) return;
    let live = true;
    void (async () => {
      try {
        const reconciled = await manifestWork(async () => {
          const records = await refresh(manifest);
          // The record can be stale: a file was dropped, replaced, or copied but never marked done.
          await Promise.all(
            records.installations.map((installation) =>
              reconcileInstallation(manifest, target, installation.slot).catch(() => {}),
            ),
          );
          return refresh(manifest);
        });
        if (live)
          setBoot((previous) =>
            previous.name === "ready" ? { ...previous, ...reconciled } : previous,
          );
      } catch (error) {
        if (live) setBoot({ name: "failed", message: String(error) });
      }
    })();
    return () => {
      live = false;
    };
    // on entering the launcher (from an import or a game), not on every tab
  }, [launcherPage, fixture, refresh, target, boot.name, manifestWork]);

  const ready = boot.name === "ready" ? boot : null;
  const active = useMemo(
    () => (ready ? pickActiveInstall(ready.installations, ready.games, activeSlot) : null),
    [ready, activeSlot],
  );
  const editions = useMemo(() => active?.editions ?? [], [active]);
  const slot = active?.installation.slot ?? null;
  const edition =
    slot === null ? null : pickEdition(editions, picked[slot] ?? readRememberedEdition(slot));

  // The mods of every edition, and the one each will load (the host's `[mods] active=`).
  useEffect(() => {
    const manifest = ready?.manifest;
    if (!manifest || !launcherPage) return;
    let live = true;
    void (async () => {
      const next: ModState = { mods: {}, active: {} };
      for (const game of editions) {
        try {
          const mods = await listMods(manifest, game.storage);
          next.mods[game.storage] = mods;
          next.active[game.storage] = await readActiveMod(game, mods);
        } catch {
          next.mods[game.storage] ??= [];
          next.active[game.storage] = "";
        }
      }
      if (live) setModState(next);
    })();
    return () => {
      live = false;
    };
  }, [ready?.manifest, editions, modsVersion, launcherPage]);

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
  const reload = async () => {
    const [build, records] = await Promise.all([loadBuildInfo(), refresh(manifest)]);
    setBoot({ ...boot, build, ...records });
  };
  const resume = slotFromPath(query.get("resume") ?? undefined);
  const others: ActiveInstall[] = installations
    .filter((entry) => entry.slot !== slot)
    .sort((a, b) => a.slot - b.slot)
    .flatMap((entry) => pickActiveInstall([entry], games, entry.slot) ?? []);

  const chooseEdition = (picked: GameRecord) => {
    setPicked((now) => ({ ...now, [picked.slot]: picked.id }));
    writeRememberedEdition(picked.slot, picked.id);
  };
  const switchInstall = (next: number) => {
    writeActiveSlot(next);
    setActiveSlot(next);
  };
  const play = (game: GameRecord) => {
    // Asking here keeps the PLAY click as the gesture the browser wants,
    // before the file check can outlast it; the game page also asks for
    // fullscreen when it mounts, for a direct visit. "Only during matches"
    // waits for the match itself instead.
    const fullscreen = readFullscreenPreference(game.storage);
    if (fullscreen.enabled && !fullscreen.onlyInGame && !document.fullscreenElement)
      void enterFullscreen(document.documentElement).catch(() => {});
    // Debugging switches given to the launcher follow the game they open.
    const path = gamePath(game.slot, game.id);
    const flags = new URLSearchParams();
    if (query.get("show-cursor") === "1") flags.set("show-cursor", "1");
    // The page layer draws the cursor unless this install chose the
    // game's own software cursor (Settings → Cursor Classic, ?cursor=game).
    if (cursorChoice(location.search, game.storage) === "game") flags.set("cursor", "game");
    const suffix = flags.toString();
    navigate(suffix ? `${path}${path.includes("?") ? "&" : "?"}${suffix}` : path);
  };
  const resumeImport = (at: number) => navigate(`/import?resume=${at}`);

  // One shell for every launcher screen, so the bar and the rail keep their place (and their
  // animation state) when the tab changes.
  const launcherShell = (
    <Shell editions={editions} edition={edition} onEdition={chooseEdition}>
      <Outlet />
    </Shell>
  );

  return (
    <Routes>
      <Route element={launcherShell}>
        <Route
          path="/"
          element={
            <PlayScreen
              install={active}
              edition={edition}
              build={build}
              mods={edition ? (modState.mods[edition.storage] ?? []) : []}
              activeMod={edition ? (modState.active[edition.storage] ?? "") : ""}
              onActiveMod={async (name) => {
                if (!edition) return;
                await writeActiveMod(edition, name);
                setModsVersion((n) => n + 1);
              }}
              onPlay={play}
              onInstall={() => navigate("/import")}
              onResume={resumeImport}
            />
          }
        />
        <Route
          path="/mods"
          element={
            <ModsScreen
              editions={editions}
              edition={edition}
              manifest={manifest}
              target={target}
              activeMods={modState.active}
              onChanged={() => setModsVersion((n) => n + 1)}
              onEdition={chooseEdition}
            />
          }
        />
        <Route
          path="/manage"
          element={
            <GameScreen
              install={active}
              edition={edition}
              others={others}
              build={build}
              onUse={switchInstall}
              onImport={() => navigate("/import")}
              onResume={resumeImport}
              onRenameInstallation={async (installation, displayName) => {
                await manifest.renameInstallation(installation.slot, displayName);
                await reload();
              }}
              browseSource={(installation, slotGames) =>
                managedInstallationSource(
                  installation.displayName ?? installation.name,
                  installation.slot,
                  slotGames,
                  {
                    manifest,
                    target,
                    saves: opfsSaveStore(),
                    build,
                    onChange: () => void reload(),
                  },
                )
              }
              onDownloadSaves={async (game) => {
                // saves that came with the import are in the game's folder, not in what the game has written since
                const imported = Object.entries(game.files)
                  .filter(([name, file]) => file.done && isSavePath(name))
                  .map(([name, file]) => ({
                    path: name,
                    read: () => readGameFile(file.home, name),
                  }));
                const zip = await exportSaves(opfsSaveStore(), game.storage, imported);
                if (!zip) return "There are no saved games yet.";
                const url = URL.createObjectURL(
                  new Blob([zip as BlobPart], { type: "application/zip" }),
                );
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
                  : `${count} saved game${count === 1 ? "" : "s"} brought in.`;
              }}
              onRemove={async (installation) => {
                await manifestWork(async () =>
                  removeFiles(target, await manifest.removeInstallation(installation.slot)),
                );
                await reload();
              }}
            />
          }
        />
        <Route
          path="/settings/:tab"
          element={<SettingsRoute editions={editions} edition={edition} />}
        />
      </Route>
      <Route path="/settings" element={<Navigate to="/settings/launcher" replace />} />
      <Route
        path="/import"
        element={
          query.has("resume") &&
          (!resume || !installations.some((entry) => entry.slot === resume)) ? (
            <RouteError message="That installation was not found." />
          ) : (
            <Import
              key={resume ?? "new"}
              deps={browserDeps(build, manifest, target)}
              {...(resume ? { slot: resume } : {})}
              {...(edition ? { edition: edition.id } : {})}
              onBack={() => navigate("/")}
              onDone={(done) => {
                if (done !== undefined) switchInstall(done);
                void reload().then(() => navigate("/"));
              }}
            />
          )
        }
      />
      <Route
        path="/game/:slot"
        element={
          <InstallationGame
            games={games}
            installations={installations}
            manifest={manifest}
            target={target}
          />
        }
      />
      <Route path="*" element={<RouteError message="That page was not found." />} />
    </Routes>
  );
}

function SettingsRoute({
  editions,
  edition,
}: {
  editions: GameRecord[];
  edition: GameRecord | null;
}) {
  const { tab } = useParams();
  if (!isSettingsTab(tab)) return <Navigate to="/settings/launcher" replace />;
  return edition ? (
    <SettingsScreen editions={editions} edition={edition} tab={tab} />
  ) : (
    <SettingsEmpty tab={tab} />
  );
}

function InstallationGame({
  games,
  installations,
  manifest,
  target,
}: {
  games: GameRecord[];
  installations: InstallationRecord[];
  manifest: Manifest;
  target: CopyTarget;
}) {
  const { slot: value } = useParams();
  const location = useLocation();
  const slot = slotFromPath(value);
  const query = new URLSearchParams(location.search);
  const choices = games.filter((game) => game.slot === slot);
  const installation = installations.find((entry) => entry.slot === slot);
  const planned = installation?.editions ?? choices.map((game) => game.id);
  const edition = query.get("edition") ?? (planned.includes("ra2md") ? "ra2md" : "ra2");
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
  // A record can say complete while the browser's copy has lost files (storage pressure, cleared
  // site data). Check before starting the runtime, so the game does not stop halfway with one name:
  // the missing files are marked uncopied and the player is sent to Resume import.
  const [checked, setChecked] = useState<{ record: GameRecord; names: string[] } | null>(null);
  useEffect(() => {
    if (!selected || !selected.complete) return;
    let live = true;
    const recorded = Object.entries(selected.files)
      .filter(([, entry]) => entry.done)
      .map(([name, entry]) => ({ home: entry.home, name, size: entry.size }));
    void missingGameFiles(recorded, target)
      .then(async (names) => {
        if (!live) return;
        if (names.length) await manifest.markFilesMissing(selected.id, names, selected.slot);
        if (live) setChecked({ record: selected, names });
      })
      .catch(() => {
        // storage that cannot be read at all is the start's error to report, not this check's
        if (live) setChecked({ record: selected, names: [] });
      });
    return () => {
      live = false;
    };
  }, [selected, manifest, target]);
  // Only this record's answer counts: a switch of edition checks again rather than starting blind.
  const missing = checked && checked.record === selected ? checked.names : null;
  if (!slot || !installation) return <RouteError message="That installation was not found." />;
  if (!choices.length || (!selected && planned.some((id) => id === edition)))
    return <RouteError message="This installation's import did not finish." resume={slot} />;
  if (!selected)
    return <RouteError message="That edition is not available in this installation." />;
  if (!selected.complete)
    return <RouteError message="This installation's import did not finish." resume={slot} />;
  if (missing === null) return <Centered>Checking the game&apos;s files…</Centered>;
  if (missing.length)
    return <RouteError message={missingFilesMessage(missing)} resume={selected.slot} />;
  return files && <Play key={`${slot}:${edition}`} files={files} />;
}

/** What to say when the browser's copy no longer has files the installation lists. */
function missingFilesMessage(names: string[]): string {
  const shown = names.slice(0, 3).join(", ");
  const rest = names.length > 3 ? ` and ${names.length - 3} more` : "";
  const one = names.length === 1;
  return `${one ? "A file is" : `${names.length} files are`} missing from this browser's copy of the game: ${shown}${rest}. Resume the import to copy ${one ? "it" : "them"} again.`;
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

function Centered({ children }: { children: string }) {
  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
      <Text color="gray" style={{ fontFamily: "var(--font-label)", letterSpacing: "0.12em" }}>
        {children}
      </Text>
    </Flex>
  );
}
