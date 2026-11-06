import { useEffect, useState } from "react";
import { forEachEdition } from "../../../storage/all-games";
import {
  compactIniSections,
  formatHandle,
  getIniValueLast,
  MATCH_SPEED_SECTIONS,
  parseHandle,
  setIniValue,
  setIniValueLast,
} from "../../../storage/game-settings";
import {
  readCampaignSpeedControlPreference,
  writeCampaignSpeedControlPreference,
} from "../../../storage/speed-control-preferences";
import { Group, PipBar, Row, Segmented, Toggle } from "./controls";
import {
  DefaultsNote,
  Reading,
  ResetButton,
  resetSectionsEdit,
  TabBar,
  type TabProps,
} from "./shared";
import styles from "./SettingsScreen.module.css";

const DIFFICULTY = [
  { value: 0, label: "Easy" },
  { value: 1, label: "Normal" },
  { value: 2, label: "Hard" },
] as const;

const SCROLL_METHOD = [
  { value: 0, label: "Hold" },
  { value: 1, label: "Drag" },
  { value: 2, label: "Reversed" },
] as const;

const DETAIL = [
  { value: 0, label: "Low" },
  { value: 1, label: "Medium" },
  { value: 2, label: "High" },
] as const;

function NameField({ value, onCommit }: { value: string; onCommit(name: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <Row label="Name" htmlFor="settings-player-name">
      <input
        id="settings-player-name"
        aria-label="Player name"
        className={styles.text}
        value={draft}
        placeholder="Player"
        maxLength={16}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
    </Row>
  );
}

export function GameplayTab({ editions, edition, settings }: TabProps) {
  const [speedControl, setSpeedControl] = useState(() =>
    readCampaignSpeedControlPreference(edition.storage),
  );
  const { loaded } = settings;
  if (!loaded) return <Reading />;

  const save = (section: string, key: string) => (value: string | number) =>
    void settings.update("main", (ini) => setIniValue(ini, section, key, String(value)));
  const toggle = (section: string, key: string) => (on: boolean) =>
    save(section, key)(on ? "yes" : "no");

  /**
   * The skirmish screen shows the slider position, the inverse of the speed in the INI: a stored 1 shows
   * as 5. The match sections are where the screen writes it, so the launcher uses the same view.
   */
  const matchSpeed = (() => {
    for (const section of MATCH_SPEED_SECTIONS) {
      const raw = loaded.main.ini ? getIniValueLast(loaded.main.ini, section, "GameSpeed") : null;
      const stored = raw === null ? Number.NaN : Number(raw);
      if (Number.isFinite(stored)) return Math.max(0, Math.min(6, 6 - stored));
    }
    return 5;
  })();
  const saveMatchSpeed = (value: number) =>
    void settings.update("main", (ini) => {
      let next = compactIniSections(ini, MATCH_SPEED_SECTIONS);
      for (const section of MATCH_SPEED_SECTIONS)
        next = setIniValueLast(next, section, "GameSpeed", String(6 - value));
      return next;
    });

  const modern = settings.hostValue("present", "controls", "classic") === "modern";
  const saveControls = (on: boolean) =>
    settings.update(
      "host",
      (ini) => setIniValue(ini, "present", "controls", on ? "modern" : "classic"),
      "Could not save the control setting",
    );
  const saveSpeedControl = (on: boolean) => {
    setSpeedControl(on);
    forEachEdition(editions, (game) => writeCampaignSpeedControlPreference(game.storage, on));
  };
  // Only Yuri's Revenge has a campaign difficulty, so it shows (and reads) from its own file.
  const showsYuri = edition.id === "ra2md";

  return (
    <>
      <TabBar>
        <DefaultsNote show={loaded.mainFromDefaults} />
        <ResetButton
          onClick={() => {
            saveSpeedControl(false);
            if (modern) void saveControls(false);
            void settings.update(
              "main",
              resetSectionsEdit(["Options"]),
              "Could not reset the game settings",
            );
          }}
        />
      </TabBar>
      <Group title="PLAYER">
        <NameField
          value={parseHandle(settings.mainValue("MultiPlayer", "Handle"))}
          onCommit={(name) => {
            const handle = formatHandle(name);
            if (handle === null)
              settings.setError("That name uses characters the game cannot store.");
            else save("MultiPlayer", "Handle")(handle);
          }}
        />
      </Group>
      <Group title="MATCH">
        <PipBar label="Game speed" value={matchSpeed} min={0} max={6} onChange={saveMatchSpeed} />
        <Segmented
          label="Difficulty"
          value={settings.mainNumber("Options", "Difficulty", 1)}
          choices={DIFFICULTY}
          onChange={save("Options", "Difficulty")}
        />
        {showsYuri && (
          <Segmented
            label="Campaign difficulty"
            info="Yuri’s Revenge only."
            value={settings.mainNumber("Options", "CampDifficulty", 1)}
            choices={DIFFICULTY}
            onChange={(value) =>
              void settings.update("main", (ini, game) =>
                game.id === "ra2md"
                  ? setIniValue(ini, "Options", "CampDifficulty", String(value))
                  : null,
              )
            }
          />
        )}
        <Toggle
          label="Speed control in campaign"
          info="Lets you change game speed during campaign missions."
          checked={speedControl}
          onChange={saveSpeedControl}
        />
      </Group>
      <Group title="CONTROLS">
        <Toggle
          label="MOBA style"
          info="Left-click selects, right-click orders. Shift-click a build icon to queue five."
          checked={modern}
          onChange={(on) => void saveControls(on)}
        />
      </Group>
      <Group title="CAMERA">
        <Segmented
          label="Right-drag"
          info="Hold: hold the right button to pan. Drag: drag to pan, the pointer recenters. Reversed: drag the other way."
          value={settings.mainNumber("Options", "ScrollMethod", 0)}
          choices={SCROLL_METHOD}
          onChange={save("Options", "ScrollMethod")}
        />
        <PipBar
          label="Scroll speed"
          value={6 - settings.mainNumber("Options", "ScrollRate", 3)}
          min={0}
          max={6}
          low="Slow"
          high="Fast"
          format={() => ""}
          onChange={(value) => save("Options", "ScrollRate")(6 - value)}
        />
        <Toggle
          label="Auto scroll"
          checked={settings.mainToggle("Options", "AutoScroll")}
          onChange={toggle("Options", "AutoScroll")}
        />
      </Group>
      <Group title="INTERFACE">
        <Segmented
          label="Detail"
          value={settings.mainNumber("Options", "DetailLevel", 2)}
          choices={DETAIL}
          onChange={save("Options", "DetailLevel")}
        />
        <Toggle
          label="Sidebar cameo text"
          checked={settings.mainToggle("Options", "SidebarCameoText")}
          onChange={toggle("Options", "SidebarCameoText")}
        />
        <Toggle
          label="Unit action lines"
          checked={settings.mainToggle("Options", "UnitActionLines")}
          onChange={toggle("Options", "UnitActionLines")}
        />
        <Toggle
          label="Show hidden objects"
          checked={settings.mainToggle("Options", "ShowHidden")}
          onChange={toggle("Options", "ShowHidden")}
        />
        <Toggle
          label="Tooltips"
          checked={settings.mainToggle("Options", "ToolTips")}
          onChange={toggle("Options", "ToolTips")}
        />
      </Group>
    </>
  );
}
