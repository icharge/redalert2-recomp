import { useState } from "react";
import {
  defaultKeyboardIni,
  hotkeyFromEvent,
  hotkeyLabel,
  setIniValue,
} from "../../../storage/game-settings";
import { HOTKEY_CATEGORY_ORDER, hotkeyAction, hotkeyCategory, hotkeyDescription } from "./hotkeys";
import { Reading, ResetButton, TabBar, type TabProps } from "./shared";
import styles from "./SettingsScreen.module.css";

export function KeyboardTab({ settings }: TabProps) {
  const [category, setCategory] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const { loaded } = settings;
  if (!loaded) return <Reading />;

  const groups = new Map<string, typeof loaded.hotkeys>();
  for (const hotkey of loaded.hotkeys) {
    const name = hotkeyCategory(hotkey.name);
    groups.set(name, [...(groups.get(name) ?? []), hotkey]);
  }
  const categories: string[] = HOTKEY_CATEGORY_ORDER.filter((name) => groups.has(name));
  const shown = category && groups.has(category) ? category : (categories[0] ?? "Control");
  const commands = groups.get(shown) ?? [];
  const selected = commands.find((hotkey) => hotkey.name === selectedName) ?? commands[0] ?? null;
  const conflict = selected
    ? loaded.hotkeys.find(
        (hotkey) =>
          hotkey.value === selected.value && hotkey.name !== selected.name && hotkey.value > 0,
      )
    : undefined;

  const assign = (name: string, value: number) =>
    void settings.update("keyboard", (ini, _game, files) =>
      // some commands are Yuri's Revenge only
      files.hotkeys.some((hotkey) => hotkey.name === name)
        ? setIniValue(ini, "Hotkey", name, String(value))
        : null,
    );

  return (
    <>
      <TabBar>
        {loaded.keyboardFromDefaults ? (
          <p className={styles.note}>No keyboard file yet: these are the standard keys.</p>
        ) : (
          <span />
        )}
        <ResetButton
          label="RESET ALL KEYS"
          onClick={() => {
            setCapturing(false);
            void settings.update(
              "keyboard",
              (_ini, game) => defaultKeyboardIni(game.id),
              "Could not reset the keyboard settings",
            );
          }}
        />
      </TabBar>
      <div className={styles.keys}>
        <nav className={styles.keyGroups} aria-label="Key groups">
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              className={styles.keyGroup}
              aria-pressed={name === shown}
              onClick={() => {
                setCategory(name);
                setSelectedName(null);
                setCapturing(false);
              }}
            >
              {name}
            </button>
          ))}
        </nav>
        <ul className={styles.commands} aria-label={`${shown} commands`}>
          {commands.map((hotkey) => (
            <li key={hotkey.name}>
              <button
                type="button"
                className={styles.command}
                aria-pressed={hotkey.name === selected?.name}
                onClick={() => {
                  setSelectedName(hotkey.name);
                  setCapturing(false);
                }}
              >
                <span>{hotkeyAction(hotkey.name)}</span>
                <kbd className={styles.key}>
                  {hotkey.value > 0 ? hotkeyLabel(hotkey.value) : "—"}
                </kbd>
              </button>
            </li>
          ))}
        </ul>
        {selected ? (
          <div className={styles.keyDetail}>
            <h3 className={styles.keyTitle}>{hotkeyAction(selected.name)}</h3>
            <p className={styles.note}>{hotkeyDescription(selected.name)}</p>
            <kbd className={styles.bigKey}>{capturing ? "…" : hotkeyLabel(selected.value)}</kbd>
            <button
              type="button"
              className={styles.capture}
              data-capturing={capturing || undefined}
              aria-label="CHANGE KEY"
              onClick={() => setCapturing((now) => !now)}
              onBlur={() => setCapturing(false)}
              onKeyDown={(event) => {
                if (!capturing) return;
                event.preventDefault();
                event.stopPropagation();
                const value = hotkeyFromEvent(event.nativeEvent);
                if (value === null) return;
                setCapturing(false);
                assign(selected.name, value);
              }}
            >
              {capturing ? "PRESS A KEY…" : "CHANGE KEY"}
            </button>
            {conflict && <p className={styles.warn}>Also used by {hotkeyAction(conflict.name)}.</p>}
          </div>
        ) : (
          <p className={styles.note}>No commands in this group.</p>
        )}
      </div>
    </>
  );
}
