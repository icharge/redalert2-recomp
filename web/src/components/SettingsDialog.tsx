import { Button, Dialog, Flex, Select, Switch, Text } from "@radix-ui/themes";
import { SCALES, Setting, type HostSettings } from "../game/protocol";

const resolutions = [
  "800x600",
  "1024x768",
  "1280x720",
  "1366x768",
  "1600x900",
  "1920x1080",
  "2560x1440",
];

/** The host's F10 settings: commands go through its ring, acknowledgements
 * come back as settings events. No second copy of game settings in the page. */
export function SettingsDialog({
  settings,
  command,
  onClose,
  fullscreen,
  pointerLocked,
  onFullscreen,
  onPointerLock,
}: {
  settings: HostSettings | null;
  command(key: number, value: number, extra?: number): void;
  onClose(): void;
  fullscreen?: boolean;
  pointerLocked?: boolean;
  onFullscreen?(): void;
  onPointerLock?(): void;
}) {
  if (!settings) return null;
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
          Changes are saved for the next time you play.
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
          <Flex justify="between" align="center">
            <Text as="label" htmlFor="game-resolution">
              Resolution (next game)
            </Text>
            <Select.Root
              value={`${settings.width}x${settings.height}`}
              onValueChange={(v) => {
                const [w, h] = v.split("x").map(Number);
                command(Setting.Resolution, w ?? 800, h ?? 600);
              }}
            >
              <Select.Trigger id="game-resolution" aria-label="Resolution" />
              <Select.Content>
                {[...new Set([...resolutions, `${settings.width}x${settings.height}`])].map(
                  (size) => (
                    <Select.Item key={size} value={size}>
                      {size.replace("x", " × ")}
                    </Select.Item>
                  ),
                )}
              </Select.Content>
            </Select.Root>
          </Flex>
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
          <Text size="2">
            Mod: {settings.mod || "Original game"}. Press F9 at the main menu to switch.
          </Text>
          <Flex gap="2" wrap="wrap">
            <Button variant="soft" onClick={onFullscreen}>
              {fullscreen ? "Leave fullscreen" : "Fullscreen (F11)"}
            </Button>
            <Button variant="soft" onClick={onPointerLock}>
              {pointerLocked ? "Release pointer" : "Lock pointer for edge scrolling"}
            </Button>
          </Flex>
          <Text size="1" color="gray">
            Press Esc to release the pointer or leave fullscreen.
          </Text>
          <Flex justify="end">
            <Button onClick={onClose}>Back to game</Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
