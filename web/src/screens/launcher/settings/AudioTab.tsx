import { useEffect, useState } from "react";
import {
  DEFAULT_SOUND_PREFERENCES,
  loadSoundPreferences,
  saveSoundPreference,
} from "../../../game/sound-preferences";
import { setIniValue } from "../../../storage/game-settings";
import { Group, PipBar, Toggle } from "./controls";
import {
  DefaultsNote,
  Reading,
  ResetButton,
  resetSectionsEdit,
  TabBar,
  type TabProps,
} from "./shared";

const percent = (value: number) => `${value}%`;

export function AudioTab({ settings }: TabProps) {
  const [menuMusic, setMenuMusic] = useState(DEFAULT_SOUND_PREFERENCES.menuMusic);
  // shared with the in-game speaker popover, so both show and write the same choice
  useEffect(() => {
    let cancelled = false;
    void loadSoundPreferences().then((saved) => {
      if (!cancelled) setMenuMusic(saved.menuMusic);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const { loaded } = settings;
  if (!loaded) return <Reading />;

  const save = (key: string, value: string) =>
    void settings.update("main", (ini) => setIniValue(ini, "Audio", key, value));
  const volume = (key: string, fallback: number) =>
    Math.round(settings.mainNumber("Audio", key, fallback) * 10) * 10;
  const saveVolume = (key: string) => (value: number) => save(key, (value / 100).toFixed(6));
  const toggle = (key: string) => (on: boolean) => save(key, on ? "yes" : "no");
  const saveMenuMusic = (on: boolean) => {
    setMenuMusic(on);
    void saveSoundPreference("menuMusic", on);
  };

  return (
    <>
      <TabBar>
        <DefaultsNote show={loaded.mainFromDefaults} />
        <ResetButton
          onClick={() => {
            saveMenuMusic(true);
            void settings.update(
              "main",
              resetSectionsEdit(["Audio"]),
              "Could not reset the game settings",
            );
          }}
        />
      </TabBar>
      <Group title="VOLUME">
        <PipBar
          label="Sound"
          value={volume("SoundVolume", 0.7)}
          min={0}
          max={100}
          step={10}
          format={percent}
          onChange={saveVolume("SoundVolume")}
        />
        <PipBar
          label="Voices"
          value={volume("VoiceVolume", 0.7)}
          min={0}
          max={100}
          step={10}
          format={percent}
          onChange={saveVolume("VoiceVolume")}
        />
        <PipBar
          label="Music"
          value={volume("ScoreVolume", 0.4)}
          min={0}
          max={100}
          step={10}
          format={percent}
          onChange={saveVolume("ScoreVolume")}
        />
      </Group>
      <Group title="MUSIC">
        <Toggle
          label="Menu music"
          info="Off: music starts at the loading screen."
          checked={menuMusic}
          onChange={saveMenuMusic}
        />
        <Toggle
          label="Repeat"
          checked={settings.mainToggle("Audio", "IsScoreRepeat", false)}
          onChange={toggle("IsScoreRepeat")}
        />
        <Toggle
          label="Shuffle"
          checked={settings.mainToggle("Audio", "IsScoreShuffle", true)}
          onChange={toggle("IsScoreShuffle")}
        />
        <Toggle
          label="In-game music"
          checked={settings.mainToggle("Audio", "InGameMusic", true)}
          onChange={toggle("InGameMusic")}
        />
      </Group>
      <Group title="ADVANCED">
        <PipBar
          label="Sound buffer"
          info="The game's default is 9. Lower it only if sound crackles."
          value={settings.mainNumber("Audio", "SoundLatency", 9)}
          min={0}
          max={9}
          onChange={(value) => save("SoundLatency", String(value))}
        />
      </Group>
    </>
  );
}
