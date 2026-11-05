import { Button, Dialog, Flex, Select, Switch, Text } from "@radix-ui/themes";
import { SCALES, Setting, type HostSettings } from "../game/protocol";
import {
  BROWSER_VIDEO_SIZE,
  launcherVideoOptions,
  type VideoChoice,
} from "../storage/video-preferences";

/** The host's F10 settings: commands go through its ring, acknowledgements
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
        maxWidth="440px"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.code === "F10") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <Dialog.Title>Game settings</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          These settings apply while the game is running.
        </Dialog.Description>
        <Flex direction="column" gap="4">
          <Flex justify="between" align="center">
            <Text as="label" htmlFor="game-scaling">
              Scaling
            </Text>
            <Select.Root
              value={settings.scale}
              onValueChange={(v) =>
                command(Setting.Scale, SCALES.indexOf(v as typeof settings.scale))
              }
            >
              <Select.Trigger id="game-scaling" aria-label="Scaling" />
              <Select.Content>
                {SCALES.map((mode) => (
                  <Select.Item key={mode} value={mode}>
                    {mode === "sharp"
                      ? "Sharp bilinear"
                      : mode === "crt"
                        ? "CRT"
                        : mode[0]?.toUpperCase() + mode.slice(1)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
          <Flex justify="between" align="center" gap="3">
            <Text as="label" htmlFor="game-resolution">
              Resolution
            </Text>
            <Select.Root
              value={
                videoChoice === BROWSER_VIDEO_SIZE
                  ? BROWSER_VIDEO_SIZE
                  : `${settings.width}x${settings.height}`
              }
              onValueChange={(value) => {
                if (value === BROWSER_VIDEO_SIZE) {
                  onVideoChange(BROWSER_VIDEO_SIZE);
                  return;
                }
                const [w, h] = value.split("x").map(Number);
                if (Number.isInteger(w) && Number.isInteger(h) && w && h) onVideoChange({ w, h });
              }}
            >
              <Select.Trigger id="game-resolution" aria-label="Resolution" />
              <Select.Content>
                <Select.Item value={BROWSER_VIDEO_SIZE}>Match browser size</Select.Item>
                {videoSizes.map(({ w, h, native }) => (
                  <Select.Item key={`${w}x${h}`} value={`${w}x${h}`}>
                    {w} × {h}
                    {native ? " (Native)" : ""}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
          <Text size="1" color="gray">
            Resolution applies to the next match. "Match browser size" uses this window's pixel
            size.
          </Text>
          {(
            [
              ["Blur menu bars", settings.bars, Setting.Bars],
              ["HD vehicles", settings.hd, Setting.Hd],
              ["Modern controls and Queue Five", settings.modern, Setting.Modern],
            ] as const
          ).map(([label, checked, key]) => (
            <Flex key={key} justify="between" align="center" gap="3">
              <Text as="label" htmlFor={`setting-${key}`}>
                {label}
              </Text>
              <Switch
                id={`setting-${key}`}
                checked={checked}
                onCheckedChange={(on) => command(key, Number(on))}
              />
            </Flex>
          ))}
          <Text size="1" color="gray">
            Modern controls: left-click to select, right-click to order. Shift-click a build icon to
            queue five.
          </Text>
          <Flex justify="between" align="center" gap="3">
            <Text as="label" htmlFor="setting-fps-overlay">
              FPS overlay
            </Text>
            <Switch id="setting-fps-overlay" checked={statsOn} onCheckedChange={onStatsChange} />
          </Flex>
          <Text size="1" color="gray">
            Press Alt+Shift+F to toggle the FPS overlay.
          </Text>
          <Text size="2">
            Mod: {settings.mod || "Original game"}. Press F9 at the main menu to switch.
          </Text>
          <Flex gap="2" wrap="wrap">
            <Button variant="soft" onClick={onFullscreen}>
              {fullscreen ? "Leave fullscreen" : "Fullscreen (F11)"}
            </Button>
            <Button
              variant="soft"
              onClick={onPointerLock}
              disabled={pointerLockDisabled}
              title={
                pointerLockDisabled ? "?show-cursor=1 keeps the system cursor visible" : undefined
              }
            >
              {pointerLocked ? "Release pointer" : "Lock pointer for edge scrolling"}
            </Button>
          </Flex>
          <Text size="1" color="gray">
            {pointerLockDisabled
              ? "Cursor debug: Pointer Lock stays off so the browser's cursor is visible."
              : "Press Esc to release the pointer or leave fullscreen."}
          </Text>
          <Flex justify="end">
            <Button onClick={onClose}>Back to game</Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
