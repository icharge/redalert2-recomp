import { SpeakerLoudIcon, SpeakerModerateIcon, SpeakerOffIcon } from "@radix-ui/react-icons";
import { Button, Flex, IconButton, Popover, Slider } from "@radix-ui/themes";
import { useSyncExternalStore } from "react";
import type { GameAudio } from "../game/audio";
import styles from "./SoundControl.module.css";

/**
 * The page's sound controls over the game: a bar asking for a click while the browser holds the sound,
 * and, once it plays, a speaker with the volume. Both leave the keyboard to the game (Esc is the
 * game's key), so they hand the focus back when they are used.
 */
export function SoundControl({
  audio,
  volume,
  onVolume,
  giveBack,
}: {
  audio: GameAudio;
  volume: number;
  onVolume: (volume: number) => void;
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
      <Popover.Content size="1" width="200px" onCloseAutoFocus={(event) => event.preventDefault()}>
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
      </Popover.Content>
    </Popover.Root>
  );
}
