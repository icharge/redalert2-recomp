import { SpeakerLoudIcon, SpeakerModerateIcon, SpeakerOffIcon } from "@radix-ui/react-icons";
import { Button, Flex, IconButton, Popover, Slider, Switch, Text } from "@radix-ui/themes";
import { useSyncExternalStore } from "react";
import type { GameAudio } from "../game/audio";
import type { SoundPreferences } from "../game/sound-preferences";
import styles from "./SoundControl.module.css";

const CHOICES = [
  ["muteOnBlur", "Mute when the window loses focus"],
  ["menuMusic", "Play music in menus"],
] as const satisfies readonly (readonly [keyof SoundPreferences, string])[];

/**
 * The page's sound controls over the game: a bar asking for a click while the browser holds the sound,
 * and, once it plays, a speaker with the volume and when the game may be heard. Both leave the keyboard to the game (Esc is the
 * game's key), so they hand the focus back when they are used.
 */
export function SoundControl({
  audio,
  volume,
  onVolume,
  preferences,
  onPreference,
  giveBack,
}: {
  audio: GameAudio;
  volume: number;
  onVolume: (volume: number) => void;
  preferences: SoundPreferences;
  onPreference: (key: keyof SoundPreferences, value: boolean) => void;
  giveBack: () => void;
}) {
  const state = useSyncExternalStore(audio.subscribe, () => audio.state);
  if (state === "starting" || state === "unavailable") return null;
  if (state === "suspended") {
    return (
      <Flex className={styles.bar} role="status" align="center" justify="center" gap="3">
        <SpeakerOffIcon />
        <span>The browser is holding the sound.</span>
        <Button size="1" variant="solid" onClick={() => void audio.resume().then(giveBack)}>
          Click to start sound
        </Button>
      </Flex>
    );
  }
  const Icon = volume === 0 ? SpeakerOffIcon : volume < 0.5 ? SpeakerModerateIcon : SpeakerLoudIcon;
  return (
    <Popover.Root onOpenChange={(open) => open || giveBack()}>
      <Popover.Trigger>
        <IconButton className={styles.speaker} variant="soft" color="gray" aria-label="Volume">
          <Icon />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content size="1" width="260px" onCloseAutoFocus={(event) => event.preventDefault()}>
        <Flex direction="column" gap="3">
          <Flex align="center" gap="3">
            <Slider
              aria-label="Volume"
              min={0}
              max={100}
              step={1}
              value={[Math.round(volume * 100)]}
              onValueChange={([value]) => onVolume((value ?? 100) / 100)}
            />
            <span className={styles.percent}>{Math.round(volume * 100)}</span>
          </Flex>
          {CHOICES.map(([key, label]) => (
            <Flex key={key} justify="between" align="center" gap="3">
              <Text as="label" size="2" htmlFor={`sound-${key}`}>
                {label}
              </Text>
              <Switch
                id={`sound-${key}`}
                size="1"
                checked={preferences[key]}
                onCheckedChange={(on) => onPreference(key, on)}
              />
            </Flex>
          ))}
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}
