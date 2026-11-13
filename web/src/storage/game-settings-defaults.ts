// The values a fresh installation starts with. The launcher uses them when an import did not bring
// the player's old RA2.INI / RA2MD.INI (the import's "settings" option is off by default), and the
// Reset buttons write them back. These are the project's chosen defaults, not the value a particular
// installation happened to save.

import type { GameId } from "./install";

/**
 * The match game speed a fresh installation starts with, as the skirmish and internet game screens
 * show it (0 slowest, 6 Fastest). The INI stores the inverse, so this is written as 6 - value.
 */
export const DEFAULT_MATCH_SPEED = 6;

export type SettingsSection = "Options" | "Audio" | "Video" | "MultiPlayer" | "Intro";

export type SettingsDefaults = Record<SettingsSection, Record<string, string>>;

const COMMON: SettingsDefaults = {
  Options: {
    GameSpeed: "5",
    Difficulty: "2",
    ScrollMethod: "0",
    ScrollRate: "3",
    AutoScroll: "yes",
    DetailLevel: "2",
    SidebarCameoText: "yes",
    UnitActionLines: "yes",
    ShowHidden: "yes",
    ToolTips: "yes",
  },
  Audio: {
    SoundVolume: "0.700000",
    VoiceVolume: "0.700000",
    ScoreVolume: "0.400000",
    IsScoreRepeat: "no",
    IsScoreShuffle: "yes",
    SoundLatency: "9",
    InGameMusic: "yes",
  },
  Video: {
    ScreenWidth: "1920",
    ScreenHeight: "1080",
    StretchMovies: "yes",
  },
  Intro: {
    Play: "no",
  },
  MultiPlayer: {},
};

/** The game's own defaults for the sections the launcher edits, per edition. */
export function gameSettingsDefaults(game: GameId): SettingsDefaults {
  const copy = (section: SettingsSection) => ({ ...COMMON[section] });
  if (game === "ra2")
    return {
      Options: copy("Options"),
      Audio: copy("Audio"),
      Video: copy("Video"),
      Intro: copy("Intro"),
      MultiPlayer: copy("MultiPlayer"),
    };
  return {
    Options: { ...copy("Options"), CampDifficulty: "2" },
    Audio: copy("Audio"),
    Video: copy("Video"),
    Intro: copy("Intro"),
    MultiPlayer: copy("MultiPlayer"),
  };
}

/** One default value, or null when the edition does not have that setting. */
export function defaultMainValue(game: GameId, section: string, key: string): string | null {
  const values = gameSettingsDefaults(game)[section as SettingsSection];
  return values?.[key] ?? null;
}
