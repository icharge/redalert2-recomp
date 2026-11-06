import { SpeakerLoudIcon, SpeakerModerateIcon, SpeakerOffIcon } from "@radix-ui/react-icons";
import { Popover } from "@radix-ui/themes";
import { useSyncExternalStore } from "react";
import type { GameAudio } from "../game/audio";
import type { SoundPreferences } from "../game/sound-preferences";
import styles from "./SoundControl.module.css";

const CHOICES = [
  ["muteOnBlur", "Mute when in background"],
  ["menuMusic", "Menu music"],
] as const satisfies readonly (readonly [keyof SoundPreferences, string])[];

const PIPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/**
 * The page's sound controls over the game: a bar asking for a click while the browser holds the sound,
 * and, once it plays, a volume button (in the page controls) with the volume and when the game may be
 * heard. Both leave the keyboard to the game (Esc is the game's key), so they hand the focus back.
 */
export function SoundControl({
  audio,
  volume,
  onVolume,
  preferences,
  onPreference,
  giveBack,
  className,
}: {
  audio: GameAudio;
  volume: number;
  onVolume: (volume: number) => void;
  preferences: SoundPreferences;
  onPreference: (key: keyof SoundPreferences, value: boolean) => void;
  giveBack: () => void;
  /** the class of the volume button */
  className?: string;
}) {
  const state = useSyncExternalStore(audio.subscribe, () => audio.state);
  if (state === "starting" || state === "unavailable") return null;
  if (state === "suspended") {
    return (
      <div className={styles.bar} role="status">
        <SpeakerOffIcon aria-hidden="true" />
        <span>Sound is off until you click.</span>
        <button
          type="button"
          className={styles.start}
          onClick={() => void audio.resume().then(giveBack)}
        >
          TURN ON
        </button>
      </div>
    );
  }
  const percent = Math.round(volume * 100);
  const shown = Math.round(volume * 10) * 10;
  const Icon = volume === 0 ? SpeakerOffIcon : volume < 0.5 ? SpeakerModerateIcon : SpeakerLoudIcon;
  return (
    <Popover.Root onOpenChange={(open) => open || giveBack()}>
      <Popover.Trigger>
        <button type="button" className={className} aria-label="Volume">
          <Icon aria-hidden="true" />
          {percent}%
        </button>
      </Popover.Trigger>
      <Popover.Content
        className={styles.panel}
        width="300px"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <section aria-label="Sound" className={styles.body}>
          <div className={styles.volume}>
            <div role="group" aria-label="Volume" className={styles.pips}>
              {PIPS.map((pip) => (
                <button
                  key={pip}
                  type="button"
                  className={styles.pip}
                  data-on={pip <= shown || undefined}
                  aria-label={`Volume ${pip}%`}
                  aria-pressed={pip === shown}
                  onClick={() => onVolume(pip / 100)}
                />
              ))}
            </div>
            <span className={styles.percent}>{percent}%</span>
          </div>
          {CHOICES.map(([key, label]) => (
            <div key={key} className={styles.choice}>
              <span>{label}</span>
              <button
                type="button"
                role="switch"
                aria-checked={preferences[key]}
                aria-label={label}
                className={styles.switch}
                onClick={() => onPreference(key, !preferences[key])}
              >
                <span />
              </button>
            </div>
          ))}
        </section>
      </Popover.Content>
    </Popover.Root>
  );
}
