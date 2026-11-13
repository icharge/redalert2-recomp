import { MATCH_SPEED_SECTIONS, setIniValue, setIniValueLast } from "../../../storage/game-settings";
import {
  DEFAULT_MATCH_SPEED,
  gameSettingsDefaults,
  type SettingsSection,
} from "../../../storage/game-settings-defaults";
import type { GameRecord } from "../../../storage/manifest";
import type { AllGamesSettings, Edit } from "./useAllGamesSettings";
import styles from "./SettingsScreen.module.css";

export interface TabProps {
  editions: GameRecord[];
  /** the edition whose values are shown */
  edition: GameRecord;
  settings: AllGamesSettings;
}

/** Writes each game's own defaults for these sections; [Options] also resets the match speed. */
export function resetSectionsEdit(sections: SettingsSection[]): Edit {
  return (ini, game) => {
    const defaults = gameSettingsDefaults(game.id);
    let next = ini;
    for (const section of sections)
      for (const [key, value] of Object.entries(defaults[section]))
        next = setIniValue(next, section, key, value);
    if (sections.includes("Options")) {
      const stored = 6 - DEFAULT_MATCH_SPEED;
      for (const section of MATCH_SPEED_SECTIONS)
        next = setIniValueLast(next, section, "GameSpeed", String(stored));
    }
    return next;
  };
}

export function TabBar({ children }: { children: React.ReactNode }) {
  return <div className={styles.tabBar}>{children}</div>;
}

export function ResetButton({
  label = "RESET DEFAULTS",
  onClick,
}: {
  label?: string;
  onClick(): void;
}) {
  return (
    <button type="button" className={styles.reset} onClick={onClick}>
      {label}
    </button>
  );
}

/** Shown while the files are read. */
export function Reading() {
  return <p className={styles.note}>Reading the game&apos;s settings…</p>;
}

export function DefaultsNote({ show }: { show: boolean }) {
  return show ? (
    <p className={styles.note}>No settings file yet: these are the game&apos;s defaults.</p>
  ) : null;
}
