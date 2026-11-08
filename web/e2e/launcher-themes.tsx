// Dev-only visual fixture. Uses the production launcher, without requiring game assets.
import "@radix-ui/themes/styles.css";
import "../src/styles/global.css";
import { Button, Flex, Theme } from "@radix-ui/themes";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Launcher } from "../src/screens/Launcher";
import type { GameRecord, Manifest } from "../src/storage/manifest";
import type { CopyTarget } from "../src/storage/opfs";
import { ModLibrary } from "../src/components/ModLibrary";
import { Import } from "../src/screens/Import";
import { LauncherThemeProvider } from "../src/launcher/LauncherThemeProvider";

const games: GameRecord[] = (["ra2", "ra2md"] as const).map((id) => ({
  id,
  slot: 1,
  storage: `theme-preview-${id}`,
  title: id === "ra2" ? "Red Alert 2" : "Yuri's Revenge",
  exeStamp: 1,
  importedAt: 1,
  bytes: 0,
  complete: true,
  files: {},
}));
// Only these in-memory preview settings are exposed to ModLibrary. No IndexedDB/OPFS writes.
const records = new Map<string, unknown>();
const manifest = {
  getSetting: async (key: string) => records.get(key),
  setSetting: async (key: string, value: unknown) => {
    records.set(key, value);
  },
} as Manifest;
const target: CopyTarget = {
  write: async () => {
    throw new Error("Design preview. Use the app launcher to import mod files.");
  },
  size: async () => null,
  remove: async () => {},
};
function Preview() {
  const [importing, setImporting] = useState(false);
  return (
    <LauncherThemeProvider>
      <Theme appearance="dark" accentColor="red" grayColor="slate" radius="small">
        {importing ? (
          <Flex direction="column" className="launcher-import-page">
            <Button variant="ghost" onClick={() => setImporting(false)}>
              Back to launcher
            </Button>
            <Import
              deps={{
                build: { games: {} },
                manifest,
                target,
                estimate: async () => ({}),
                persist: async () => false,
                pickDirectory: null,
              }}
              onDone={() => setImporting(false)}
            />
          </Flex>
        ) : (
          <Launcher
            games={games}
            installations={[{ slot: 1, name: "Classic collection", importedAt: 1 }]}
            onPlay={(game) =>
              window.alert(
                `${game.title} selected. This preview does not start the game. Use the app launcher with your imported files to play.`,
              )
            }
            onImport={() => setImporting(true)}
            browseSource={() => ({
              mode: "read-only",
              label: "Classic collection · files",
              rootLabel: "Classic collection",
              list: async (folder) =>
                folder
                  ? []
                  : [
                      { name: "RA2.INI", type: "file", size: 64 },
                      { name: "Saved Games", type: "folder" },
                    ],
              readText: async () =>
                "; Theme preview only\n[Video]\nScreenWidth=800\nScreenHeight=600",
            })}
            modManager={(game) => (
              <ModLibrary game={game.storage} manifest={manifest} target={target} />
            )}
            onRemove={async () => {
              throw new Error("This preview collection cannot be removed.");
            }}
            onDownloadSaves={async () => "No saved games in this design preview."}
            onImportSaves={async () => "Use the app launcher to import your saved games."}
            estimate={async () => ({})}
          />
        )}
      </Theme>
    </LauncherThemeProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
