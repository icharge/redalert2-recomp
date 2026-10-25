import { Button, Dialog, Flex, Select, Switch, Text } from "@radix-ui/themes";
import { useState } from "react";
import {
  BUILT_IN_THAI_FONTS,
  readThaiFontPreference,
  writeThaiFontPreference,
} from "../storage/thai-fonts";
import type { GameRecord } from "../storage/manifest";
import {
  LAUNCHER_VIDEO_SIZES,
  readVideoPreference,
  writeVideoPreference,
} from "../storage/video-preferences";
import styles from "./LauncherGameSettings.module.css";

const thaiFonts = [...BUILT_IN_THAI_FONTS].sort((a, b) => a.name.localeCompare(b.name));

export function LauncherGameSettings({ game, onClose }: { game: GameRecord; onClose(): void }) {
  const [preference, setPreference] = useState(() => readThaiFontPreference(game.storage));
  const [videoPreference, setVideoPreference] = useState(() => readVideoPreference(game.storage));
  const selectedFont = thaiFonts.find((font) => font.id === preference.fontId) ?? thaiFonts[0]!;
  const fontPreview = (asset: string) =>
    `${import.meta.env.BASE_URL}thai-font-previews/font-preview-${asset}.png`;
  const save = (next: typeof preference) => {
    setPreference(next);
    writeThaiFontPreference(game.storage, next);
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content maxWidth="420px">
        <Dialog.Title>{game.title} settings</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          Set the game resolution and Thai font fix for the next launch.
        </Dialog.Description>
        <Flex direction="column" gap="4">
          <Flex justify="between" align="center" gap="3">
            <Text as="label" htmlFor={`launcher-resolution-${game.slot}-${game.id}`}>
              Resolution
            </Text>
            <Select.Root
              value={videoPreference ? `${videoPreference.w}x${videoPreference.h}` : "game"}
              onValueChange={(value) => {
                const next =
                  value === "game"
                    ? null
                    : (() => {
                        const [w, h] = value.split("x").map(Number);
                        return { w: w ?? 0, h: h ?? 0 };
                      })();
                setVideoPreference(next);
                writeVideoPreference(game.storage, next);
              }}
            >
              <Select.Trigger
                id={`launcher-resolution-${game.slot}-${game.id}`}
                aria-label={`${game.title} resolution`}
              />
              <Select.Content>
                <Select.Item value="game">Use game setting</Select.Item>
                {LAUNCHER_VIDEO_SIZES.map(({ w, h }) => (
                  <Select.Item key={`${w}x${h}`} value={`${w}x${h}`}>
                    {w} × {h}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
          <Flex justify="between" align="center" gap="3">
            <Text as="label" htmlFor={`launcher-thai-font-fix-${game.slot}-${game.id}`}>
              Thai font fix
            </Text>
            <Switch
              id={`launcher-thai-font-fix-${game.slot}-${game.id}`}
              checked={preference.enabled}
              onCheckedChange={(enabled) => save({ ...preference, enabled })}
            />
          </Flex>
          <Flex justify="between" align="center" gap="3">
            <Text as="label" htmlFor={`launcher-thai-font-${game.slot}-${game.id}`}>
              Font
            </Text>
            <Select.Root
              value={preference.fontId}
              onValueChange={(fontId) => save({ enabled: true, fontId })}
            >
              <Select.Trigger
                id={`launcher-thai-font-${game.slot}-${game.id}`}
                aria-label={`${game.title} Thai font`}
              />
              <Select.Content>
                {thaiFonts.map((font) => (
                  <Select.Item key={font.id} value={font.id}>
                    {font.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
          <img
            className={styles.selectedPreview}
            src={fontPreview(selectedFont.asset)}
            alt={`${selectedFont.name} font sample`}
          />
          <Text size="1" color="gray">
            The selected bundled font replaces imported and mod game.fnt files while the fix is
            enabled.
          </Text>
          <Flex justify="end">
            <Dialog.Close>
              <Button>Done</Button>
            </Dialog.Close>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
