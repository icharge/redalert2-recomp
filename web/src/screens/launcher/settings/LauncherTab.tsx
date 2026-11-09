import { useState } from "react";
import { forEachEdition } from "../../../storage/all-games";
import { setIniValue } from "../../../storage/game-settings";
import {
  readSkipIntroPreference,
  writeSkipIntroPreference,
} from "../../../storage/intro-preferences";
import { readStatsPreference, writeStatsPreference } from "../../../storage/stats-preferences";
import { Group, Segmented, Toggle } from "./controls";
import type { TabProps } from "./shared";

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

export function LauncherTab({ editions, edition, settings }: TabProps) {
  const [skipIntro, setSkipIntro] = useState(() => readSkipIntroPreference(edition.storage));
  const [fps, setFps] = useState(() => readStatsPreference());

  const saveHost = (key: string, value: string, what: string) =>
    void settings.update(
      "host",
      (ini) => setIniValue(ini, "present", key, value),
      `Could not save ${what}`,
    );
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
        {/* Off for now: HD vehicles make the game lag. */}
        <Toggle
          label="HD vehicles (experimental, causes lag)"
          checked={false}
          disabled
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
    </>
  );
}
