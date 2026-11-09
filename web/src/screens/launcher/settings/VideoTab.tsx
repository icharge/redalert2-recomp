import { useState } from "react";
import { forEachEdition } from "../../../storage/all-games";
import {
  readFullscreenPreference,
  writeFullscreenPreference,
  type FullscreenPreference,
} from "../../../storage/fullscreen-preferences";
import {
  readIniVideoChoice,
  setIniValue,
  writeIniVideoChoice,
} from "../../../storage/game-settings";
import {
  BROWSER_VIDEO_SIZE,
  DEFAULT_VIDEO_SIZE,
  launcherVideoOptions,
  nativeVideoSize,
  readVideoChoice,
  writeVideoPreference,
  type VideoChoice,
  type VideoPreference,
} from "../../../storage/video-preferences";
import { Group, Row, Segmented, Toggle } from "./controls";
import { Reading, ResetButton, resetSectionsEdit, TabBar, type TabProps } from "./shared";
import styles from "./SettingsScreen.module.css";

type Mode = "game" | "browser" | "fixed";

const MODES = [
  { value: "game", label: "Game’s own" },
  { value: "browser", label: "Match browser" },
  { value: "fixed", label: "Fixed" },
] as const;

const modeOf = (choice: VideoChoice): Mode =>
  choice === null ? "game" : choice === BROWSER_VIDEO_SIZE ? "browser" : "fixed";

export function VideoTab({ editions, edition, settings }: TabProps) {
  const [choice, setChoice] = useState<VideoChoice>(() => readVideoChoice(edition.storage));
  const [lastFixed, setLastFixed] = useState<VideoPreference>(() => {
    const saved = readVideoChoice(edition.storage);
    return saved && saved !== BROWSER_VIDEO_SIZE ? saved : { ...DEFAULT_VIDEO_SIZE };
  });
  const [fullscreen, setFullscreen] = useState<FullscreenPreference>(() =>
    readFullscreenPreference(edition.storage),
  );
  const [sizes] = useState(() => launcherVideoOptions(nativeVideoSize()));
  const { loaded } = settings;

  const saveChoice = (next: VideoChoice) => {
    setChoice(next);
    if (next && next !== BROWSER_VIDEO_SIZE) setLastFixed(next);
    forEachEdition(editions, (game) => writeVideoPreference(game.storage, next));
    void settings.update("main", (ini) => writeIniVideoChoice(ini, next));
  };
  /** Only remembered: the game page applies it when a game starts. */
  const saveFullscreen = (next: FullscreenPreference) => {
    setFullscreen(next);
    forEachEdition(editions, (game) => writeFullscreenPreference(game.storage, next));
  };
  const savedChoice = loaded?.main.ini ? readIniVideoChoice(loaded.main.ini) : undefined;
  const effectiveChoice = savedChoice === undefined ? choice : savedChoice;
  const mode = modeOf(effectiveChoice);
  const fixed =
    effectiveChoice && effectiveChoice !== BROWSER_VIDEO_SIZE ? effectiveChoice : lastFixed;
  const savedSize = `${settings.mainValue("Video", "ScreenWidth", "1920")} × ${settings.mainValue("Video", "ScreenHeight", "1080")}`;

  return (
    <>
      <TabBar>
        <span />
        {loaded && (
          <ResetButton
            onClick={() =>
              void settings.update(
                "main",
                resetSectionsEdit(["Video"]),
                "Could not reset the game settings",
              )
            }
          />
        )}
      </TabBar>
      <Group title="RESOLUTION">
        <Segmented
          label="Size"
          info={`Game’s own uses the size saved in the game: ${loaded ? savedSize : "…"}.`}
          value={mode}
          choices={MODES}
          onChange={(next) =>
            saveChoice(
              next === "game" ? null : next === "browser" ? BROWSER_VIDEO_SIZE : { ...fixed },
            )
          }
        />
        {mode === "fixed" && (
          <Row label="Fixed size" htmlFor="settings-video-size">
            <select
              id="settings-video-size"
              aria-label="Size"
              className={styles.select}
              value={`${fixed.w}x${fixed.h}`}
              onChange={(event) => {
                const [w, h] = event.target.value.split("x").map(Number);
                saveChoice({ w: w ?? DEFAULT_VIDEO_SIZE.w, h: h ?? DEFAULT_VIDEO_SIZE.h });
              }}
            >
              {sizes.map(({ w, h, native }) => (
                <option key={`${w}x${h}`} value={`${w}x${h}`}>
                  {w} × {h}
                  {native ? " (Native)" : ""}
                </option>
              ))}
              {!sizes.some(({ w, h }) => w === fixed.w && h === fixed.h) && (
                <option value={`${fixed.w}x${fixed.h}`}>
                  {fixed.w} × {fixed.h}
                </option>
              )}
            </select>
          </Row>
        )}
      </Group>
      <Group title="FULL SCREEN">
        <Toggle
          label="Full screen on launch"
          checked={fullscreen.enabled}
          onChange={(enabled) =>
            saveFullscreen({ enabled, onlyInGame: enabled && fullscreen.onlyInGame })
          }
        />
        <Toggle
          label="Only during matches"
          info="Windowed in the menus: full screen from the loading screen to the score screen."
          checked={fullscreen.onlyInGame}
          disabled={!fullscreen.enabled}
          onChange={(onlyInGame) => saveFullscreen({ ...fullscreen, onlyInGame })}
        />
      </Group>
      <Group title="MOVIES">
        {loaded ? (
          <Toggle
            label="Stretch to fit"
            checked={settings.mainToggle("Video", "StretchMovies", true)}
            onChange={(on) =>
              void settings.update("main", (ini) =>
                setIniValue(ini, "Video", "StretchMovies", on ? "yes" : "no"),
              )
            }
          />
        ) : (
          <Reading />
        )}
      </Group>
    </>
  );
}
