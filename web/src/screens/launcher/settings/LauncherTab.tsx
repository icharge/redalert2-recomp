import { useState } from "react";
import { buildAllowsLanPlay } from "../../../config";
import { forEachEdition } from "../../../storage/all-games";
import {
  readChatTimePreference,
  writeChatTimePreference,
} from "../../../storage/chat-time-preferences";
import { setIniValue } from "../../../storage/game-settings";
import {
  readSkipIntroPreference,
  writeSkipIntroPreference,
} from "../../../storage/intro-preferences";
import { readLanPlayPreference, writeLanPlayPreference } from "../../../storage/lan-preferences";
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
  const [chatTime, setChatTime] = useState(() => readChatTimePreference());
  const [lan, setLan] = useState(() => readLanPlayPreference());

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
      <Group title="ONLINE">
        <Toggle
          label="Chat times"
          checked={chatTime}
          onChange={(on) => {
            setChatTime(on);
            writeChatTimePreference(on);
          }}
        />
      </Group>
      {/* a build with VITE_SHOW_NETWORK_LAN=false has no LAN play, and so no switch for it */}
      {buildAllowsLanPlay() && (
        <Group title="LAN">
          <Toggle
            label="LAN play"
            info="The game's Network button pairs two browsers over WebRTC, and the game tray has a LAN button. Off: the main menu has no Network button and the tray no LAN button. Applies at the next launch."
            checked={lan}
            onChange={(on) => {
              setLan(on);
              writeLanPlayPreference(on);
            }}
          />
        </Group>
      )}
    </>
  );
}
