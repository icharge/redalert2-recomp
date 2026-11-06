import { useState } from "react";
import { forEachEdition } from "../../../storage/all-games";
import {
  readCursorPreference,
  writeCursorPreference,
  type CursorChoice,
} from "../../../storage/cursor-preferences";
import { setIniValue } from "../../../storage/game-settings";
import {
  readSkipIntroPreference,
  writeSkipIntroPreference,
} from "../../../storage/intro-preferences";
import { readStatsPreference, writeStatsPreference } from "../../../storage/stats-preferences";
import {
  BUILT_IN_THAI_FONTS,
  readThaiFontPreference,
  writeThaiFontPreference,
  type ThaiFontPreference,
} from "../../../storage/thai-fonts";
import { Group, Row, Segmented, Toggle } from "./controls";
import type { TabProps } from "./shared";
import styles from "./SettingsScreen.module.css";

const thaiFonts = [...BUILT_IN_THAI_FONTS].sort((a, b) => a.name.localeCompare(b.name));

const SCALING = [
  { value: "sharp", label: "Sharp" },
  { value: "smooth", label: "Smooth" },
  { value: "crt", label: "CRT" },
  { value: "nearest", label: "Nearest" },
  { value: "integer", label: "Integer" },
] as const;

const BARS = [
  { value: "blur", label: "Blur" },
  { value: "black", label: "Black" },
] as const;

const CURSOR = [
  { value: "page", label: "Smooth", name: "Smooth cursor" },
  { value: "game", label: "Classic" },
] as const;

export function LauncherTab({ editions, edition, settings }: TabProps) {
  const [skipIntro, setSkipIntro] = useState(() => readSkipIntroPreference(edition.storage));
  const [cursor, setCursor] = useState<CursorChoice>(() => readCursorPreference(edition.storage));
  const [fps, setFps] = useState(() => readStatsPreference());
  const [thai, setThai] = useState<ThaiFontPreference>(() =>
    readThaiFontPreference(edition.storage),
  );

  const saveHost = (key: string, value: string, what: string) =>
    void settings.update(
      "host",
      (ini) => setIniValue(ini, "present", key, value),
      `Could not save ${what}`,
    );
  const saveThai = (next: ThaiFontPreference) => {
    setThai(next);
    forEachEdition(editions, (game) => writeThaiFontPreference(game.storage, next));
  };
  const selectedFont = thaiFonts.find((font) => font.id === thai.fontId) ?? thaiFonts[0]!;

  return (
    <>
      <Group title="START">
        <Toggle
          label="Skip intro"
          checked={skipIntro}
          onChange={(skip) => {
            setSkipIntro(skip);
            forEachEdition(editions, (game) => writeSkipIntroPreference(game.storage, skip));
          }}
        />
      </Group>
      <Group title="DISPLAY">
        <Segmented
          label="Scaling"
          value={settings.hostValue("present", "scale", "smooth")}
          choices={SCALING}
          onChange={(value) => saveHost("scale", value, "the scaling")}
        />
        <Segmented
          label="Menu bars"
          value={settings.hostValue("present", "bars", "blur") === "black" ? "black" : "blur"}
          choices={BARS}
          onChange={(value) => saveHost("bars", value, "the menu bars")}
        />
        <Segmented
          label="Cursor"
          info="Smooth draws the game's cursor at the display's rate. Classic draws it into the picture at the game's frame rate."
          value={cursor}
          choices={CURSOR}
          onChange={(value) => {
            setCursor(value);
            forEachEdition(editions, (game) => writeCursorPreference(game.storage, value));
          }}
        />
        <Toggle
          label="HD vehicles"
          checked={settings.hostValue("present", "hdvox", "0") === "1"}
          onChange={(on) => saveHost("hdvox", on ? "1" : "0", "the HD vehicles setting")}
        />
        <Toggle
          label="FPS counter"
          checked={fps}
          onChange={(on) => {
            setFps(on);
            writeStatsPreference(on);
          }}
        />
      </Group>
      <Group title="THAI TEXT">
        <Toggle
          label="Thai font fix"
          info="The chosen font replaces the game's and mods' game.fnt."
          checked={thai.enabled}
          onChange={(enabled) => saveThai({ ...thai, enabled })}
        />
        <Row label="Thai font" htmlFor="settings-thai-font">
          <select
            id="settings-thai-font"
            className={styles.select}
            value={thai.fontId}
            onChange={(event) => saveThai({ enabled: true, fontId: event.target.value })}
          >
            {thaiFonts.map((font) => (
              <option key={font.id} value={font.id}>
                {font.name}
              </option>
            ))}
          </select>
        </Row>
        <img
          className={styles.preview}
          src={`${import.meta.env.BASE_URL}thai-font-previews/font-preview-${selectedFont.asset}.png`}
          alt={`${selectedFont.name} font sample`}
        />
      </Group>
    </>
  );
}
