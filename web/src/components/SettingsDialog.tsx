import { Dialog } from "@radix-ui/themes";
import { SCALES, Setting, type HostSettings } from "../game/protocol";
import { Group, InfoTip, Row, Segmented, Toggle } from "../screens/launcher/settings/controls";
import {
  BROWSER_VIDEO_SIZE,
  launcherVideoOptions,
  type VideoChoice,
} from "../storage/video-preferences";
import styles from "./SettingsDialog.module.css";

const SCALE_LABELS: Record<(typeof SCALES)[number], string> = {
  sharp: "Sharp",
  smooth: "Smooth",
  crt: "CRT",
  nearest: "Nearest",
  integer: "Integer",
};

/** The host's F10 settings, as a panel at the right: commands go through its ring, acknowledgements
 * come back as settings events. No second copy of game settings in the page. */
export function SettingsDialog({
  settings,
  command,
  onClose,
  fullscreen,
  pointerLocked,
  pointerLockDisabled,
  onFullscreen,
  onPointerLock,
  statsOn,
  onStatsChange,
  videoChoice,
  onVideoChange,
}: {
  settings: HostSettings | null;
  command(key: number, value: number, extra?: number): void;
  onClose(): void;
  fullscreen?: boolean;
  pointerLocked?: boolean;
  pointerLockDisabled?: boolean;
  onFullscreen?(): void;
  onPointerLock?(): void;
  statsOn: boolean;
  onStatsChange(on: boolean): void;
  videoChoice: VideoChoice;
  onVideoChange(choice: VideoChoice): void;
}) {
  if (!settings) return null;
  const videoSizes = launcherVideoOptions();
  if (
    settings.width > 0 &&
    settings.height > 0 &&
    !videoSizes.some((size) => size.w === settings.width && size.h === settings.height)
  ) {
    videoSizes.push({ w: settings.width, h: settings.height, native: false });
    videoSizes.sort((a, b) => a.w - b.w || a.h - b.h);
  }
  return (
    <Dialog.Root
      open={settings.open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content
        className={styles.panel}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.code === "F10") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <header className={styles.header}>
          <Dialog.Title className={styles.title}>Settings</Dialog.Title>
          <kbd className={styles.key} title="Opens and closes this panel.">
            F10
          </kbd>
        </header>

        <div className={styles.body}>
          <Group title="DISPLAY">
            <Segmented
              label="Scaling"
              value={settings.scale}
              choices={SCALES.map((mode) => ({ value: mode, label: SCALE_LABELS[mode] }))}
              onChange={(mode) => command(Setting.Scale, SCALES.indexOf(mode))}
            />
            <Row label="Resolution" info="Takes effect next match." htmlFor="game-resolution">
              <select
                id="game-resolution"
                aria-label="Resolution"
                className={styles.select}
                value={
                  videoChoice === BROWSER_VIDEO_SIZE
                    ? BROWSER_VIDEO_SIZE
                    : `${settings.width}x${settings.height}`
                }
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === BROWSER_VIDEO_SIZE) {
                    onVideoChange(BROWSER_VIDEO_SIZE);
                    return;
                  }
                  const [w, h] = value.split("x").map(Number);
                  if (Number.isInteger(w) && Number.isInteger(h) && w && h) onVideoChange({ w, h });
                }}
              >
                <option value={BROWSER_VIDEO_SIZE}>Match browser size</option>
                {videoSizes.map(({ w, h, native }) => (
                  <option key={`${w}x${h}`} value={`${w}x${h}`}>
                    {w} × {h}
                    {native ? " (Native)" : ""}
                  </option>
                ))}
              </select>
            </Row>
            <Toggle
              label="Blur menu bars"
              checked={settings.bars}
              onChange={(on) => command(Setting.Bars, Number(on))}
            />
            <Toggle
              label="HD vehicles"
              checked={settings.hd}
              onChange={(on) => command(Setting.Hd, Number(on))}
            />
          </Group>

          <Group title="CONTROLS">
            <Toggle
              label="MOBA style"
              info="Left-click selects, right-click orders. Shift-click a build icon to queue five."
              checked={settings.modern}
              onChange={(on) => command(Setting.Modern, Number(on))}
            />
            <Toggle
              label="Lock pointer"
              info={
                pointerLockDisabled
                  ? "Off while ?show-cursor=1 keeps the browser's cursor visible."
                  : "Keeps the pointer in the game for edge scrolling. Esc releases it."
              }
              keyHint="Esc"
              checked={!!pointerLocked}
              disabled={!!pointerLockDisabled}
              onChange={() => onPointerLock?.()}
            />
            <Toggle
              label="FPS counter"
              info="Shows game and page frame rates in a corner."
              keyHint="Alt+Shift+F"
              checked={statsOn}
              onChange={onStatsChange}
            />
          </Group>

          <Row label="Mod">
            <span className={styles.mod}>{settings.mod || "Vanilla"}</span>
            <kbd className={styles.key}>F9</kbd>
            <InfoTip text="Press F9 at the main menu to switch." />
          </Row>
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.secondary}
            aria-label={fullscreen ? "Leave fullscreen" : "Fullscreen"}
            aria-pressed={!!fullscreen}
            onClick={onFullscreen}
          >
            F11
          </button>
          <button type="button" className={styles.primary} onClick={onClose}>
            BACK TO GAME
          </button>
        </footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
