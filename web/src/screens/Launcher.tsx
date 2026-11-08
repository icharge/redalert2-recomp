import { Dialog, Button, Flex, Text } from "@radix-ui/themes";
import { ArrowRightIcon, CheckIcon, PlayIcon, PlusIcon } from "@radix-ui/react-icons";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { LAUNCHER_THEMES, type LauncherTheme } from "../storage/launcher-theme";
import { assessEditionReadiness } from "../storage/install";
import { importedFileSource, type ReadOnlyFileSource } from "../storage/file-browser";
import type { InstallationRecord } from "../storage/manifest";
import { FileExplorer } from "../components/FileExplorer";
import { LauncherGameSettings } from "../components/LauncherGameSettings";
import { useLauncherMotion } from "../launcher/useLauncherMotion";
import { LauncherThemeProvider, useLauncherTheme } from "../launcher/LauncherThemeProvider";
import { Library, type LibraryProps } from "./Library";
import "../launcher/themes.css";
import "../launcher/integration.css";

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Session state still updates. */
  }
};
type Panel = "settings" | "files" | "saves" | "collection" | null;

/** Real launcher actions, with the seven approved presentation choices. */
export function Launcher(props: LibraryProps) {
  return (
    <LauncherThemeProvider>
      <LauncherContent {...props} />
    </LauncherThemeProvider>
  );
}

function LauncherContent(props: LibraryProps) {
  const { games, build, installations, onPlay, onImport, onResume } = props;
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const { theme, setTheme } = useLauncherTheme();
  const [slot, setSlot] = useState(() => Number(read("ra2.launcher.installation")));
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [panel, setPanel] = useState<Panel>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileSource, setFileSource] = useState<ReadOnlyFileSource | null>(null);
  useEffect(() => {
    if (panel !== null || !opener.current) return;
    const frame = requestAnimationFrame(() => {
      const target = opener.current?.isConnected
        ? opener.current
        : root.current?.querySelector<HTMLElement>("#launcher-theme");
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [panel]);
  const groups = useMemo<InstallationRecord[]>(
    () =>
      installations ??
      [...new Set(games.map((g) => g.slot))].map((slot) => ({
        slot,
        name: games.find((g) => g.slot === slot)!.title,
        importedAt: 0,
      })),
    [games, installations],
  );
  const installation = groups.find((g) => g.slot === slot) ?? groups[0];
  const choices = games.filter((g) => g.slot === installation?.slot);
  const remembered = installation
    ? (picked[installation.slot] ?? read(`ra2-edition:${installation.slot}`))
    : null;
  const selected =
    choices.find((g) => g.id === remembered) ?? choices.find((g) => g.id === "ra2md") ?? choices[0];
  const yr = selected?.id === "ra2md";
  const readiness =
    selected && build
      ? assessEditionReadiness(
          selected.id,
          build,
          Object.entries(selected.files)
            .filter(
              ([name, file]) =>
                file.done && (!/^(?:movies|movmd)[^/]*\.mix$/i.test(name) || file.size > 12),
            )
            .map(([name]) => name),
        )
      : null;
  const ready = !!selected?.complete && (!build || readiness?.status === "ready");
  const incomplete =
    installation &&
    (!choices.length ||
      choices.some((g) => !g.complete) ||
      installation.editions?.some((id) => !choices.some((g) => g.id === id && g.complete)));
  const motion = useLauncherMotion(root, theme);
  const close = () => {
    setPanel(null);
    setFileSource(null);
    setMessage("");
  };
  const open = (next: Panel) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (next === "files" && installation) {
      // A management operation refreshes records. Keep this browser session's source stable.
      setFileSource(
        props.browseSource?.(installation, choices) ??
          (selected ? importedFileSource(selected) : null),
      );
    }
    setMessage("");
    setPanel(next);
  };
  function pick(id: string) {
    if (!installation) return;
    setPicked((now) => ({ ...now, [installation.slot]: id }));
    props.onEditionChange?.(installation.slot, id);
    write(`ra2-edition:${installation.slot}`, id);
  }
  function navigateEdition(event: KeyboardEvent<HTMLDivElement>) {
    const keys =
      theme === "game-ui"
        ? ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]
        : ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key) || !selected) return;
    event.preventDefault();
    const index = choices.indexOf(selected);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? choices.length - 1
          : (index +
              (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) +
              choices.length) %
            choices.length;
    const game = choices[next];
    if (game) {
      pick(game.id);
      root.current?.querySelector<HTMLButtonElement>(`[data-edition-choice="${game.id}"]`)?.focus();
    }
  }
  async function saveAction(work: () => Promise<string>) {
    setBusy(true);
    try {
      setMessage(await work());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  const art = <div className="launcher-art" aria-hidden="true" />;
  const title = (
    <>
      <p className="launch-kicker">
        <span />
        COMMAND &amp; CONQUER
      </p>
      <h1
        className="launch-title"
        id="launcher-title"
        aria-label={selected?.title ?? "Red Alert 2"}
      >
        <span>{yr ? "YURI’S" : "RED"}</span>
        <span>
          {yr ? (
            "REVENGE"
          ) : (
            <>
              ALERT <b>2</b>
            </>
          )}
        </span>
      </h1>
    </>
  );
  const editionPicker = (
    <div
      className="edition-choices"
      role="tablist"
      aria-label="Game edition"
      aria-orientation={theme === "game-ui" ? "vertical" : "horizontal"}
      onKeyDown={navigateEdition}
    >
      {choices.map((g, i) => (
        <button
          key={g.id}
          id={`launcher-edition-${g.id}`}
          className="edition-choice"
          type="button"
          role="tab"
          aria-selected={selected?.id === g.id}
          aria-controls="edition-summary"
          tabIndex={selected?.id === g.id ? 0 : -1}
          data-edition-choice={g.id}
          onClick={() => pick(g.id)}
        >
          <span className="edition-code">0{i + 1}</span>
          <span className="edition-copy">
            <strong>{g.title}</strong>
            <small>{g.id === "ra2md" ? "THE EXPANSION" : "THE ORIGINAL"}</small>
          </span>
          <CheckIcon className="edition-selected" />
        </button>
      ))}
    </div>
  );
  const collection = installation && (
    <section className="collection-bar" aria-label="Selected installation">
      <div className="installation-picker">
        <label htmlFor="launcher-installation">INSTALLATION</label>
        <select
          id="launcher-installation"
          aria-label="Installation"
          value={installation.slot}
          onChange={(event) => {
            const value = Number(event.target.value);
            setSlot(value);
            write("ra2.launcher.installation", String(value));
          }}
        >
          {groups.map((g) => (
            <option key={g.slot} value={g.slot}>
              {g.displayName ?? g.name}
            </option>
          ))}
        </select>
        <button type="button" className="manage-collection" onClick={() => open("collection")}>
          Manage collection
        </button>
      </div>
      <div className="collection-tools" aria-label="Installation tools">
        <button type="button" disabled={!selected} onClick={() => open("files")}>
          Browse files
        </button>
        <button type="button" disabled={!selected} onClick={() => open("saves")}>
          Saved games
        </button>
        {selected && props.modManager?.(selected)}
      </div>
    </section>
  );
  const commands = (
    <>
      <p className="launch-welcome">Welcome back, Commander.</p>
      {theme !== "game-ui" && editionPicker}
      {selected ? (
        <>
          <div
            id="edition-summary"
            className="edition-summary"
            role="tabpanel"
            aria-labelledby={`launcher-edition-${selected.id}`}
          >
            <span>{yr ? "The war takes a new turn." : "Allied or Soviet. Choose your side."}</span>
            <span className="edition-format">CAMPAIGN / SKIRMISH / MULTIPLAYER</span>
          </div>
          <div className="launch-actions">
            <button
              type="button"
              id="resume-button"
              className="launcher-button launch-primary"
              disabled={!ready}
              onClick={() => onPlay(selected)}
            >
              <PlayIcon />
              <span>Play</span>
              <ArrowRightIcon className="launch-arrow" />
            </button>
            <button
              type="button"
              className="launcher-button launch-secondary"
              onClick={() => open("settings")}
            >
              Game settings
            </button>
          </div>
          <p className="launcher-readiness" role="status">
            {!selected.complete
              ? "The import did not finish."
              : readiness?.status === "runtime-not-built"
                ? "Runtime not built for this edition."
                : readiness?.status === "missing-content"
                  ? `Missing required content: ${readiness.missing.join(", ")}.`
                  : "Ready to run."}
            {readiness?.moviesMissing && " Optional movie archives are missing."}
          </p>
        </>
      ) : (
        <p className="launch-welcome">
          {installation
            ? "Finish importing this installation to play."
            : "Bring your classics. Take command."}
        </p>
      )}
      {incomplete && (
        <button
          type="button"
          className="launcher-button launch-secondary"
          onClick={() => onResume?.(installation.slot)}
        >
          Resume import
        </button>
      )}
      <p className="launch-shortcut">Your collection. Your command.</p>
      {theme === "game-feel" && (
        <div className="command-response">
          <span className="command-response-mark" aria-hidden="true">
            ✓
          </span>
          <div className="command-response-copy">
            <span className="command-response-label">COMMAND FEEDBACK</span>
            <span className="command-response-message" role="status">
              {motion.feedback}
            </span>
          </div>
          <button type="button" className="command-feedback-test" onClick={motion.preview}>
            Test feedback
          </button>
        </div>
      )}
    </>
  );

  return (
    <div ref={root} className="launcher-page" data-theme={theme} data-edition={yr ? "yr" : "ra2"}>
      {!["skeuomorphic", "framed-tech"].includes(theme) && art}
      <div className="launcher-shell">
        <header className="launcher-header">
          <div className="launcher-brand">
            <span className="brand-mark" aria-hidden="true">
              II
            </span>
            <span>
              <strong>RED ALERT 2</strong>
              <small>RECOMPILED</small>
            </span>
          </div>
          <span className="launcher-library-label">Library</span>
          <div className="appearance-picker">
            <label htmlFor="launcher-theme">APPEARANCE</label>
            <select
              id="launcher-theme"
              aria-label="Launcher theme"
              value={theme}
              onChange={(event) => {
                const next = event.target.value as LauncherTheme;
                setTheme(next);
              }}
            >
              {LAUNCHER_THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="launcher-button quiet import-button" onClick={onImport}>
            <PlusIcon />
            <span>Add installation</span>
          </button>
        </header>
        {theme === "skeuomorphic" && (
          <div className="industrial-rail" aria-hidden="true">
            <span>COLLECTION CONSOLE</span>
            <span>RA2 / RECOMPILED</span>
          </div>
        )}
        {theme === "framed-tech" && (
          <div className="command-toprail" aria-hidden="true">
            <span>01 / CLASSIC COLLECTION</span>
            <span>COMMAND INTERFACE / RECOMPILED</span>
          </div>
        )}
        <main className="launcher-main">
          {theme === "framed-tech" ? (
            <>
              <section className="command-hero" aria-labelledby="launcher-title">
                {art}
                {title}
                <div className="art-caption" aria-hidden="true">
                  CLASSIC WARFARE / RECOMPILED
                </div>
              </section>
              <div className="command-console">
                <p className="command-section-label">02 / LAUNCH CONTROL</p>
                {commands}
              </div>
            </>
          ) : (
            <>
              {theme === "game-ui" && (
                <aside className="mission-rail" aria-label="Game library and installation">
                  <section className="mission-edition-group">
                    <h2 className="mission-section-label">01 / Choose your game</h2>
                    {editionPicker}
                  </section>
                  {collection}
                </aside>
              )}
              <div className="launch-content">
                {theme === "game-ui" && (
                  <p className="mission-stage-label">02 / Prepare to deploy</p>
                )}
                {title}
                {commands}
              </div>
              {theme === "skeuomorphic" ? (
                <div className="industrial-display" aria-hidden="true">
                  {art}
                  <div className="industrial-plate">
                    <span>COMMAND &amp; CONQUER</span>
                    <strong>CLASSIC WARFARE</strong>
                    <span>RED ALERT 2 / YURI’S REVENGE</span>
                  </div>
                </div>
              ) : (
                <div className="art-caption" aria-hidden="true">
                  CLASSIC WARFARE / RECOMPILED
                </div>
              )}
            </>
          )}
        </main>
        {theme !== "game-ui" && collection}
        <footer className="launcher-footer">
          <p>
            <span className="preview-indicator" />
            Your games. In your browser.
          </p>
          <span>BUILT FOR YOUR CLASSICS.</span>
        </footer>
      </div>
      {panel === "settings" && selected && <LauncherGameSettings game={selected} onClose={close} />}
      {fileSource && <FileExplorer source={fileSource} onClose={close} />}
      <Dialog.Root
        open={panel === "collection" || panel === "saves"}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <Dialog.Content
          maxWidth={panel === "collection" ? "820px" : "480px"}
          className="launcher-utility-dialog"
        >
          <Dialog.Title>
            {panel === "collection" ? "Manage collection" : "Saved games"}
          </Dialog.Title>
          <Dialog.Description mb="4">
            {panel === "collection"
              ? "Rename, import, or remove installations and manage their editions."
              : `Transfer saved games for ${selected?.title ?? "your game"}.`}
          </Dialog.Description>
          {panel === "collection" && (
            <div className="collection-management">
              <Library
                {...props}
                selectedEditions={picked}
                onEditionChange={(slot, id) => {
                  setPicked((now) => ({ ...now, [slot]: id }));
                  props.onEditionChange?.(slot, id);
                }}
                onPlay={(game) => {
                  close();
                  props.onPlay(game);
                }}
              />
            </div>
          )}
          {panel === "saves" && selected && (
            <Flex direction="column" gap="3">
              <Button
                disabled={busy}
                onClick={() => void saveAction(() => props.onDownloadSaves(selected))}
              >
                Download saves
              </Button>
              <Text as="label" size="2">
                Import saves from zip
                <input
                  type="file"
                  accept=".zip,application/zip"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void saveAction(() => props.onImportSaves(selected, file));
                  }}
                />
              </Text>
              <Text role="status">{message}</Text>
            </Flex>
          )}
          <Flex justify="end" mt="4">
            <Dialog.Close>
              <Button>Done</Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
