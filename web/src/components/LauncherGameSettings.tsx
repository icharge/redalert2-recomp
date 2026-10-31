import {
  Button,
  Callout,
  Dialog,
  Flex,
  Grid,
  Select,
  Slider,
  Switch,
  Tabs,
  Text,
  TextField,
} from "@radix-ui/themes";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  defaultKeyboardIni,
  defaultMainIni,
  emptyIni,
  formatHandle,
  getIniValue,
  hotkeyFromEvent,
  hotkeyLabel,
  loadGameSettings,
  parseHandle,
  parseHotkeys,
  serializeIni,
  setIniValue,
  withDefaultHotkeys,
  writeGameSettings,
  type GameSettingsDeps,
  type Ini,
  type LoadedGameSettings,
} from "../storage/game-settings";
import {
  defaultMainValue,
  gameSettingsDefaults,
  type SettingsSection,
} from "../storage/game-settings-defaults";
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
import { readStatsPreference, writeStatsPreference } from "../storage/stats-preferences";
import { readSkipIntroPreference, writeSkipIntroPreference } from "../storage/intro-preferences";
import {
  readCampaignSpeedControlPreference,
  writeCampaignSpeedControlPreference,
} from "../storage/speed-control-preferences";

const thaiFonts = [...BUILT_IN_THAI_FONTS].sort((a, b) => a.name.localeCompare(b.name));

const DIFFICULTY = [
  { value: 0, label: "Easy" },
  { value: 1, label: "Normal" },
  { value: 2, label: "Hard" },
];

const SCROLL_METHOD = [
  { value: 0, label: "Hold to pan (classic)" },
  { value: 1, label: "Drag to pan (pointer recenters)" },
  { value: 2, label: "Drag to pan (reversed)" },
];

const SCROLL_RATE = [
  { value: 0, label: "0 — fastest" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3 — default" },
  { value: 4, label: "4" },
  { value: 5, label: "5" },
  { value: 6, label: "6 — slowest" },
];

const DETAIL_LEVEL = [
  { value: 0, label: "Low" },
  { value: 1, label: "Medium" },
  { value: 2, label: "High" },
];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function Row({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Flex justify="between" align="center" gap="3">
      <Flex direction="column" gap="1">
        <Text as="label" htmlFor={id}>
          {label}
        </Text>
        {hint ? (
          <Text size="1" color="gray">
            {hint}
          </Text>
        ) : null}
      </Flex>
      {children}
    </Flex>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Flex direction="column" gap="3" className={styles.section}>
      <Flex direction="column" gap="1">
        <Text size="2" weight="bold">
          {title}
        </Text>
        {hint ? (
          <Text size="1" color="gray">
            {hint}
          </Text>
        ) : null}
      </Flex>
      {children}
    </Flex>
  );
}

function TextRow({
  id,
  label,
  hint,
  value,
  placeholder,
  maxLength,
  onCommit,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  onCommit(value: string): void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Row id={id} label={label} hint={hint}>
      <TextField.Root
        className={styles.textInput}
        id={id}
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    </Row>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange(on: boolean): void;
}) {
  return (
    <Row id={id} label={label} hint={hint}>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Row>
  );
}

function ChoiceRow({
  id,
  label,
  hint,
  value,
  choices,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  choices: { value: number; label: string }[];
  onChange(value: number): void;
}) {
  return (
    <Row id={id} label={label} hint={hint}>
      <Select.Root value={String(value)} onValueChange={(next) => onChange(Number(next))}>
        <Select.Trigger id={id} aria-label={label} />
        <Select.Content>
          {choices.map((choice) => (
            <Select.Item key={choice.value} value={String(choice.value)}>
              {choice.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Row>
  );
}

function SliderRow({
  id,
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?(value: number): string;
  onChange(value: number): void;
}) {
  const [draft, setDraft] = useState(value);
  const rootRef = useRef<HTMLSpanElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    rootRef.current
      ?.querySelector<HTMLElement>('[role="slider"]')
      ?.setAttribute("aria-label", label);
  }, [label]);

  return (
    <Flex direction="column" gap="2">
      <Flex justify="between" align="center" gap="3">
        <Flex direction="column" gap="1">
          <Text as="label" htmlFor={id}>
            {label}
          </Text>
          {hint ? (
            <Text size="1" color="gray">
              {hint}
            </Text>
          ) : null}
        </Flex>
        <Text size="2" color="gray">
          {format ? format(draft) : draft}
        </Text>
      </Flex>
      <Slider
        ref={rootRef}
        id={id}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[draft]}
        onValueChange={([next]) => setDraft(next ?? min)}
        onValueCommit={([next]) => {
          const committed = next ?? min;
          setDraft(committed);
          if (committed !== value) onChange(committed);
        }}
      />
    </Flex>
  );
}

/** The game's own dialog groups its bindings; this keeps the launcher's list just as short. */
const HOTKEY_CATEGORY_ORDER = [
  "Control",
  "View",
  "Team",
  "Interface",
  "Sidebar",
  "Taunt",
  "Other",
] as const;

const HOTKEY_LABELS: Record<string, string> = {
  ToggleAlliance: "Alliance",
  AllToCheer: "Cheer",
  DeployObject: "Deploy Object",
  GuardObject: "Guard",
  ScatterObject: "Scatter",
  StopObject: "Stop Object",
  PlanningMode: "Waypoints",
  Follow: "Follow",
  ToggleRepair: "Repair Mode",
  ToggleSell: "Sell Mode",
  PlaceBeacon: "Place Beacon",
  CenterView: "Center View",
  CenterOnRadarEvent: "Center on Radar Event",
  CenterBase: "Center on Base",
  Options: "Game Menu",
  InfantryTab: "Infantry Tab",
  StructureTab: "Structure Tab",
  UnitTab: "Unit Tab",
  DefenseTab: "Defense Tab",
  PageUser: "Page User",
  TypeSelect: "Type Select",
  VeterancyNav: "Veterancy Select",
  PreviousObject: "Previous Object",
  NextObject: "Next Object",
  CombatantSelect: "Select All",
  Delete: "Delete",
  ScreenCapture: "Screen Capture",
  CursorCheat: "Cursor Debug",
  RightSidebarUp: "Right Sidebar Up",
  RightSidebarDown: "Right Sidebar Down",
  LeftSidebarUp: "Left Sidebar Up",
  LeftSidebarDown: "Left Sidebar Down",
  SidebarPageUp: "Sidebar Page Up",
  SidebarPageDown: "Sidebar Page Down",
  SidebarUp: "Sidebar Up",
  SidebarDown: "Sidebar Down",
};

const HOTKEY_DESCRIPTIONS: Record<string, string> = {
  CenterView: "Center the view on the selected object, or on the last radar event.",
  Options: "Open or close the game menu.",
  CenterOnRadarEvent: "Center the view on the last radar event.",
  ToggleAlliance: "Open the alliance choices for the selected object.",
  PlaceBeacon: "Place a map beacon at the pointer.",
  AllToCheer: "Make every unit you own cheer.",
  DeployObject: "Deploy or undeploy the selected object.",
  InfantryTab: "Switch the sidebar to the infantry tab.",
  Follow: "Follow the selected object with the camera.",
  GuardObject: "Guard the selected object or area.",
  CenterBase: "Center the view on your construction yard.",
  ToggleRepair: "Toggle repair mode.",
  ToggleSell: "Toggle sell mode.",
  PreviousObject: "Select the previous object.",
  NextObject: "Select the next object.",
  CombatantSelect: "Select all combat units on screen.",
  StructureTab: "Switch the sidebar to the structures tab.",
  UnitTab: "Switch the sidebar to the units tab.",
  StopObject: "Stop the selected units.",
  TypeSelect: "Select every unit of the same type.",
  PageUser: "Page the last player who paged you.",
  DefenseTab: "Switch the sidebar to the defenses tab.",
  ScatterObject: "Scatter the selected units.",
  VeterancyNav: "Cycle the selection between regular, veteran and elite units.",
  PlanningMode: "Toggle waypoint planning mode.",
  Delete: "Delete the selected object or waypoint.",
  ScreenCapture: "Save a screenshot of the game.",
  CursorCheat: "Toggle the cursor debug overlay.",
  RightSidebarUp: "Scroll the right sidebar pane up.",
  RightSidebarDown: "Scroll the right sidebar pane down.",
  LeftSidebarUp: "Scroll the left sidebar pane up.",
  LeftSidebarDown: "Scroll the left sidebar pane down.",
  SidebarPageUp: "Scroll the sidebar up one page.",
  SidebarPageDown: "Scroll the sidebar down one page.",
  SidebarUp: "Scroll the sidebar up one row.",
  SidebarDown: "Scroll the sidebar down one row.",
};

const CONTROL_COMMANDS = new Set([
  "ToggleAlliance",
  "AllToCheer",
  "DeployObject",
  "GuardObject",
  "ScatterObject",
  "StopObject",
  "PlanningMode",
  "ToggleRepair",
  "ToggleSell",
  "PlaceBeacon",
]);

const VIEW_COMMANDS = new Set(["CenterView", "CenterOnRadarEvent", "CenterBase", "Follow"]);

const INTERFACE_COMMANDS = new Set([
  "Options",
  "InfantryTab",
  "StructureTab",
  "UnitTab",
  "DefenseTab",
  "PageUser",
  "TypeSelect",
  "VeterancyNav",
  "PreviousObject",
  "NextObject",
  "CombatantSelect",
  "Delete",
  "ScreenCapture",
  "CursorCheat",
]);

function hotkeyAction(name: string): string {
  return HOTKEY_LABELS[name] ?? name.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function hotkeyCategory(name: string): string {
  if (/^Team(?:Select|AddSelect|Create|Center)_\d+$/.test(name)) return "Team";
  if (/^Taunt_\d+$/.test(name)) return "Taunt";
  if (/^(?:Set)?View[1-4]$/.test(name)) return "View";
  if (/Sidebar/.test(name)) return "Sidebar";
  if (CONTROL_COMMANDS.has(name)) return "Control";
  if (VIEW_COMMANDS.has(name)) return "View";
  if (INTERFACE_COMMANDS.has(name)) return "Interface";
  return "Other";
}

function hotkeyDescription(name: string): string {
  const team = /^Team(Select|AddSelect|Create|Center)_(\d+)$/.exec(name);
  if (team) {
    const number = team[2];
    if (team[1] === "TeamSelect") return `Select team ${number}.`;
    if (team[1] === "TeamAddSelect") return `Add team ${number} to the current selection.`;
    if (team[1] === "TeamCreate") return `Assign the current selection to team ${number}.`;
    return `Center the view on team ${number}.`;
  }
  const taunt = /^Taunt_(\d+)$/.exec(name);
  if (taunt) return `Send taunt ${taunt[1]} to your team.`;
  const view = /^(Set)?View([1-4])$/.exec(name);
  if (view)
    return view[1] ? `Save the current view to slot ${view[2]}.` : `Jump to saved view ${view[2]}.`;
  return HOTKEY_DESCRIPTIONS[name] ?? "No description for this command.";
}

export function LauncherGameSettings({
  game,
  onClose,
  gameSettingsDeps,
}: {
  game: GameRecord;
  onClose(): void;
  gameSettingsDeps?: Partial<GameSettingsDeps>;
}) {
  const [preference, setPreference] = useState(() => readThaiFontPreference(game.storage));
  const [videoPreference, setVideoPreference] = useState(() => readVideoPreference(game.storage));
  const [fpsOverlay, setFpsOverlay] = useState(() => readStatsPreference());
  const [skipIntro, setSkipIntro] = useState(() => readSkipIntroPreference(game.storage));
  const [campaignSpeedControl, setCampaignSpeedControl] = useState(() =>
    readCampaignSpeedControlPreference(game.storage),
  );
  const [loaded, setLoaded] = useState<LoadedGameSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [keyboardCategory, setKeyboardCategory] = useState<string | null>(null);
  const [selectedHotkey, setSelectedHotkey] = useState<string | null>(null);
  const [pendingHotkey, setPendingHotkey] = useState<number | null>(null);
  const loadedRef = useRef<LoadedGameSettings | null>(null);
  const depsRef = useRef(gameSettingsDeps);

  useEffect(() => {
    let cancelled = false;
    loadGameSettings(game, depsRef.current)
      .then((next) => {
        if (cancelled) return;
        loadedRef.current = next;
        setLoaded(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(`Could not read the game settings: ${message(cause)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [game]);

  const selectedFont = thaiFonts.find((font) => font.id === preference.fontId) ?? thaiFonts[0]!;
  const fontPreview = (asset: string) =>
    `${import.meta.env.BASE_URL}thai-font-previews/font-preview-${asset}.png`;
  const save = (next: typeof preference) => {
    setPreference(next);
    writeThaiFontPreference(game.storage, next);
  };

  const settingId = (section: string, key: string) =>
    `launcher-game-${game.slot}-${game.id}-${section}-${key}`;

  const mainValue = (section: string, key: string, fallback = ""): string => {
    const value = loaded?.main.ini ? getIniValue(loaded.main.ini, section, key) : null;
    return value ?? defaultMainValue(game.id, section, key) ?? fallback;
  };
  const playerName = parseHandle(mainValue("MultiPlayer", "Handle"));
  const modernControls =
    (loaded?.host.ini ? getIniValue(loaded.host.ini, "present", "controls") : null) === "modern";
  const mainNumber = (section: string, key: string, fallback: number): number => {
    const value = Number(mainValue(section, key, String(fallback)));
    return Number.isFinite(value) ? value : fallback;
  };
  const mainToggle = (section: string, key: string, fallback = true): boolean =>
    mainValue(section, key, fallback ? "yes" : "no").toLowerCase() === "yes";

  async function writeMain(nextIni: Ini, errorText = "Could not save the game settings") {
    const current = loadedRef.current;
    if (!current) return;
    const data = serializeIni(nextIni);
    const previous = current.main;
    const optimistic = {
      ...current,
      main: { ...previous, ini: nextIni, data },
      mainFromDefaults: false,
    };
    loadedRef.current = optimistic;
    setLoaded(optimistic);

    try {
      await writeGameSettings(game, previous.name, data, depsRef.current);
      setError(null);
    } catch (cause) {
      const now = loadedRef.current;
      if (now && now.main.ini === nextIni) {
        const reverted = {
          ...now,
          main: previous,
          mainFromDefaults: current.mainFromDefaults,
        };
        loadedRef.current = reverted;
        setLoaded(reverted);
      }
      setError(`${errorText}: ${message(cause)}`);
    }
  }

  async function saveMain(section: string, key: string, value: string) {
    const current = loadedRef.current;
    if (!current) return;
    const ini = current.main.ini ?? emptyIni();
    if (getIniValue(ini, section, key) === value) return;
    await writeMain(setIniValue(ini, section, key, value));
  }

  async function saveHostControls(modern: boolean) {
    const current = loadedRef.current;
    if (!current) return;
    const ini = current.host.ini ?? emptyIni();
    const nextIni = setIniValue(ini, "present", "controls", modern ? "modern" : "classic");
    const data = serializeIni(nextIni);
    const previous = current.host;
    const optimistic = { ...current, host: { ...previous, ini: nextIni, data } };
    loadedRef.current = optimistic;
    setLoaded(optimistic);

    try {
      await writeGameSettings(game, previous.name, data, depsRef.current);
      setError(null);
    } catch (cause) {
      const now = loadedRef.current;
      if (now && now.host.ini === nextIni) {
        const reverted = { ...now, host: previous };
        loadedRef.current = reverted;
        setLoaded(reverted);
      }
      setError(`Could not save the control setting: ${message(cause)}`);
    }
  }

  async function resetSections(sections: SettingsSection[]) {
    const current = loadedRef.current;
    if (!current) return;
    const defaults = gameSettingsDefaults(game.id);
    let ini = current.main.ini ?? defaultMainIni(game.id);
    for (const section of sections)
      for (const [key, value] of Object.entries(defaults[section]))
        ini = setIniValue(ini, section, key, value);
    await writeMain(ini, "Could not reset the game settings");
  }

  /** Reset the whole Gameplay tab: its INI section plus the two launcher-side toggles. */
  async function resetGameplayDefaults() {
    setCampaignSpeedControl(false);
    writeCampaignSpeedControlPreference(game.storage, false);
    if (modernControls) await saveHostControls(false);
    await resetSections(["Options"]);
  }

  async function saveHotkey(name: string, value: number) {
    const current = loadedRef.current;
    if (!current) return;
    // A game with no keyboard file starts from the built-in bindings, so the file it writes is
    // complete rather than a single command the game has to fill in.
    const base = current.keyboardFromDefaults
      ? withDefaultHotkeys(game.id, current.keyboard.ini ?? emptyIni())
      : (current.keyboard.ini ?? emptyIni());
    const nextIni = setIniValue(base, "Hotkey", name, String(value));
    const data = serializeIni(nextIni);
    const previous = current.keyboard;
    const hotkeys = current.hotkeys.map((hotkey) =>
      hotkey.name === name ? { ...hotkey, value } : hotkey,
    );
    const optimistic = {
      ...current,
      keyboard: { ...previous, ini: nextIni, data },
      hotkeys,
      keyboardFromDefaults: false,
    };
    loadedRef.current = optimistic;
    setLoaded(optimistic);

    try {
      await writeGameSettings(game, previous.name, data, depsRef.current);
      setError(null);
    } catch (cause) {
      const now = loadedRef.current;
      if (now && now.keyboard.ini === nextIni) {
        const reverted = {
          ...now,
          keyboard: previous,
          hotkeys: current.hotkeys,
          keyboardFromDefaults: current.keyboardFromDefaults,
        };
        loadedRef.current = reverted;
        setLoaded(reverted);
      }
      setError(`Could not save the keyboard settings: ${message(cause)}`);
    }
  }

  async function resetAllHotkeys() {
    const current = loadedRef.current;
    if (!current) return;
    const ini = defaultKeyboardIni(game.id);
    const data = serializeIni(ini);
    const previous = current.keyboard;
    const optimistic = {
      ...current,
      keyboard: { ...previous, ini, data },
      hotkeys: parseHotkeys(ini),
      keyboardFromDefaults: false,
    };
    loadedRef.current = optimistic;
    setLoaded(optimistic);
    setPendingHotkey(null);

    try {
      await writeGameSettings(game, previous.name, data, depsRef.current);
      setError(null);
    } catch (cause) {
      const now = loadedRef.current;
      if (now && now.keyboard.ini === ini) {
        const reverted = {
          ...now,
          keyboard: previous,
          hotkeys: current.hotkeys,
          keyboardFromDefaults: current.keyboardFromDefaults,
        };
        loadedRef.current = reverted;
        setLoaded(reverted);
      }
      setError(`Could not reset the keyboard settings: ${message(cause)}`);
    }
  }

  const hotkeyGroups = new Map<string, LoadedGameSettings["hotkeys"]>();
  for (const hotkey of loaded?.hotkeys ?? []) {
    const group = hotkeyGroups.get(hotkeyCategory(hotkey.name)) ?? [];
    group.push(hotkey);
    hotkeyGroups.set(hotkeyCategory(hotkey.name), group);
  }
  const hotkeyCategories: string[] = HOTKEY_CATEGORY_ORDER.filter((name) => hotkeyGroups.has(name));
  const category =
    keyboardCategory && hotkeyGroups.has(keyboardCategory)
      ? keyboardCategory
      : (hotkeyCategories[0] ?? "Control");
  const commands = hotkeyGroups.get(category) ?? [];
  const selected = commands.find((hotkey) => hotkey.name === selectedHotkey) ?? commands[0] ?? null;
  const conflict =
    pendingHotkey !== null && selected
      ? (loaded?.hotkeys.find(
          (hotkey) => hotkey.value === pendingHotkey && hotkey.name !== selected.name,
        ) ?? null)
      : null;

  const choose = (section: string, key: string) => (value: number) =>
    void saveMain(section, key, String(value));
  const toggle = (section: string, key: string) => (on: boolean) =>
    void saveMain(section, key, on ? "yes" : "no");

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content maxWidth="600px" style={{ maxHeight: "85vh", overflowY: "auto" }}>
        <Dialog.Title>{game.title} settings</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          Set launcher options and the game's own settings for the next launch.
        </Dialog.Description>

        {error ? (
          <Callout.Root color="red" role="alert" mb="3">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        ) : null}

        <Tabs.Root defaultValue="launcher">
          <Tabs.List className={styles.tabs}>
            <Tabs.Trigger value="launcher">Launcher</Tabs.Trigger>
            <Tabs.Trigger value="gameplay">Gameplay</Tabs.Trigger>
            <Tabs.Trigger value="audio">Audio</Tabs.Trigger>
            <Tabs.Trigger value="video">Video</Tabs.Trigger>
            <Tabs.Trigger value="keyboard">Keyboard</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="launcher">
            <Flex direction="column" gap="4" pt="4">
              <ToggleRow
                id={`launcher-skip-intro-${game.slot}-${game.id}`}
                label="Skip intro"
                checked={skipIntro}
                onChange={(skip) => {
                  setSkipIntro(skip);
                  writeSkipIntroPreference(game.storage, skip);
                }}
              />
              <ToggleRow
                id={`launcher-fps-overlay-${game.slot}-${game.id}`}
                label="FPS overlay"
                checked={fpsOverlay}
                onChange={(on) => {
                  setFpsOverlay(on);
                  writeStatsPreference(on);
                }}
              />
              <ToggleRow
                id={`launcher-thai-font-fix-${game.slot}-${game.id}`}
                label="Thai font fix"
                checked={preference.enabled}
                onChange={(enabled) => save({ ...preference, enabled })}
              />
              <Row id={`launcher-thai-font-${game.slot}-${game.id}`} label="Font">
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
              </Row>
              <img
                className={styles.selectedPreview}
                src={fontPreview(selectedFont.asset)}
                alt={`${selectedFont.name} font sample`}
              />
              <Text size="1" color="gray">
                The selected bundled font replaces imported and mod game.fnt files while the fix is
                enabled.
              </Text>
            </Flex>
          </Tabs.Content>

          <Tabs.Content value="gameplay">
            <Flex direction="column" gap="4" pt="4">
              {!loaded ? (
                <Text color="gray">Reading the game's settings…</Text>
              ) : (
                <>
                  {loaded.mainFromDefaults ? (
                    <Text size="1" color="gray">
                      No settings file was found, so the game's defaults are shown. Changing one
                      writes a new file for the next launch.
                    </Text>
                  ) : null}
                  <Section title="Player" hint="Used in multiplayer lobbies and saved games.">
                    <TextRow
                      id={settingId("MultiPlayer", "Handle")}
                      label="Player name"
                      value={playerName}
                      placeholder="Player"
                      maxLength={16}
                      onCommit={(name) => {
                        const handle = formatHandle(name);
                        if (handle === null) {
                          setError("That name uses characters the game cannot store.");
                          return;
                        }
                        void saveMain("MultiPlayer", "Handle", handle);
                      }}
                    />
                  </Section>
                  <Section title="Match">
                    <SliderRow
                      id={settingId("Options", "GameSpeed")}
                      label="Game speed"
                      value={mainNumber("Options", "GameSpeed", 5)}
                      min={0}
                      max={6}
                      format={(value) =>
                        value === 0 ? "0 (slowest)" : value === 6 ? "6 (fastest)" : String(value)
                      }
                      onChange={(value) => void saveMain("Options", "GameSpeed", String(value))}
                    />
                    <ChoiceRow
                      id={settingId("Options", "Difficulty")}
                      label="Difficulty"
                      value={mainNumber("Options", "Difficulty", 2)}
                      choices={DIFFICULTY}
                      onChange={choose("Options", "Difficulty")}
                    />
                    {game.id === "ra2md" ? (
                      <ChoiceRow
                        id={settingId("Options", "CampDifficulty")}
                        label="Campaign difficulty"
                        value={mainNumber("Options", "CampDifficulty", 2)}
                        choices={DIFFICULTY}
                        onChange={choose("Options", "CampDifficulty")}
                      />
                    ) : null}
                  </Section>
                  <Section title="Campaign">
                    <ToggleRow
                      id={`launcher-speed-control-${game.slot}-${game.id}`}
                      label="Campaign speed control"
                      hint="Adds -SPEEDCONTROL, so the game speed slider is available in campaign missions."
                      checked={campaignSpeedControl}
                      onChange={(on) => {
                        setCampaignSpeedControl(on);
                        writeCampaignSpeedControlPreference(game.storage, on);
                      }}
                    />
                  </Section>
                  <Section title="Camera">
                    <ChoiceRow
                      id={settingId("Options", "ScrollMethod")}
                      label="Scroll method"
                      hint="How the held right mouse button pans the map."
                      value={mainNumber("Options", "ScrollMethod", 0)}
                      choices={SCROLL_METHOD}
                      onChange={choose("Options", "ScrollMethod")}
                    />
                    <ChoiceRow
                      id={settingId("Options", "ScrollRate")}
                      label="Scroll rate"
                      hint="Lower is faster; 0 is the fastest and 6 the slowest."
                      value={mainNumber("Options", "ScrollRate", 3)}
                      choices={SCROLL_RATE}
                      onChange={choose("Options", "ScrollRate")}
                    />
                    <ToggleRow
                      id={settingId("Options", "AutoScroll")}
                      label="Auto scroll"
                      checked={mainToggle("Options", "AutoScroll", true)}
                      onChange={toggle("Options", "AutoScroll")}
                    />
                  </Section>
                  <Section title="Controls">
                    <ToggleRow
                      id={settingId("present", "controls")}
                      label="MOBA style"
                      hint="Left-click to select; right-click to order. Shift-click a build icon to queue five."
                      checked={modernControls}
                      onChange={(on) => void saveHostControls(on)}
                    />
                  </Section>
                  <Section title="Interface">
                    <ChoiceRow
                      id={settingId("Options", "DetailLevel")}
                      label="Detail level"
                      value={mainNumber("Options", "DetailLevel", 2)}
                      choices={DETAIL_LEVEL}
                      onChange={choose("Options", "DetailLevel")}
                    />
                    <ToggleRow
                      id={settingId("Options", "SidebarCameoText")}
                      label="Sidebar cameo text"
                      checked={mainToggle("Options", "SidebarCameoText", true)}
                      onChange={toggle("Options", "SidebarCameoText")}
                    />
                    <ToggleRow
                      id={settingId("Options", "UnitActionLines")}
                      label="Unit action lines"
                      checked={mainToggle("Options", "UnitActionLines", true)}
                      onChange={toggle("Options", "UnitActionLines")}
                    />
                    <ToggleRow
                      id={settingId("Options", "ShowHidden")}
                      label="Show hidden objects"
                      checked={mainToggle("Options", "ShowHidden", true)}
                      onChange={toggle("Options", "ShowHidden")}
                    />
                    <ToggleRow
                      id={settingId("Options", "ToolTips")}
                      label="Tooltips"
                      checked={mainToggle("Options", "ToolTips", true)}
                      onChange={toggle("Options", "ToolTips")}
                    />
                  </Section>
                  <Flex justify="end">
                    <Button variant="soft" onClick={() => void resetGameplayDefaults()}>
                      Reset gameplay defaults
                    </Button>
                  </Flex>
                </>
              )}
            </Flex>
          </Tabs.Content>

          <Tabs.Content value="audio">
            <Flex direction="column" gap="4" pt="4">
              {!loaded ? (
                <Text color="gray">Reading the game's settings…</Text>
              ) : (
                <>
                  {loaded.mainFromDefaults ? (
                    <Text size="1" color="gray">
                      No settings file was found, so the game's defaults are shown. Changing one
                      writes a new file for the next launch.
                    </Text>
                  ) : null}
                  <Section title="Volume">
                    <SliderRow
                      id={settingId("Audio", "SoundVolume")}
                      label="Sound volume"
                      value={Math.round(mainNumber("Audio", "SoundVolume", 0.7) * 100)}
                      min={0}
                      max={100}
                      format={(value) => `${value}%`}
                      onChange={(value) =>
                        void saveMain("Audio", "SoundVolume", (value / 100).toFixed(6))
                      }
                    />
                    <SliderRow
                      id={settingId("Audio", "VoiceVolume")}
                      label="Voice volume"
                      value={Math.round(mainNumber("Audio", "VoiceVolume", 0.7) * 100)}
                      min={0}
                      max={100}
                      format={(value) => `${value}%`}
                      onChange={(value) =>
                        void saveMain("Audio", "VoiceVolume", (value / 100).toFixed(6))
                      }
                    />
                    <SliderRow
                      id={settingId("Audio", "ScoreVolume")}
                      label="Music volume"
                      value={Math.round(mainNumber("Audio", "ScoreVolume", 0.4) * 100)}
                      min={0}
                      max={100}
                      format={(value) => `${value}%`}
                      onChange={(value) =>
                        void saveMain("Audio", "ScoreVolume", (value / 100).toFixed(6))
                      }
                    />
                  </Section>
                  <Section title="Music">
                    <ToggleRow
                      id={settingId("Audio", "IsScoreRepeat")}
                      label="Repeat music"
                      checked={mainToggle("Audio", "IsScoreRepeat", false)}
                      onChange={toggle("Audio", "IsScoreRepeat")}
                    />
                    <ToggleRow
                      id={settingId("Audio", "IsScoreShuffle")}
                      label="Shuffle music"
                      checked={mainToggle("Audio", "IsScoreShuffle", true)}
                      onChange={toggle("Audio", "IsScoreShuffle")}
                    />
                    <ToggleRow
                      id={settingId("Audio", "InGameMusic")}
                      label="In-game music"
                      checked={mainToggle("Audio", "InGameMusic", true)}
                      onChange={toggle("Audio", "InGameMusic")}
                    />
                  </Section>
                  <Section
                    title="Advanced"
                    hint="The rest of the game's audio settings are best left alone."
                  >
                    <SliderRow
                      id={settingId("Audio", "SoundLatency")}
                      label="Sound latency"
                      hint="Audio buffer setting (0–9). The game's default is 9; leave it unless sound is crackling."
                      value={mainNumber("Audio", "SoundLatency", 9)}
                      min={0}
                      max={9}
                      onChange={(value) => void saveMain("Audio", "SoundLatency", String(value))}
                    />
                  </Section>
                  <Flex justify="end">
                    <Button variant="soft" onClick={() => void resetSections(["Audio"])}>
                      Reset audio defaults
                    </Button>
                  </Flex>
                </>
              )}
            </Flex>
          </Tabs.Content>

          <Tabs.Content value="video">
            <Flex direction="column" gap="4" pt="4">
              <Section
                title="Display"
                hint="The launcher resolution overrides the game's saved size for the next launch."
              >
                <Row id={`launcher-resolution-${game.slot}-${game.id}`} label="Resolution">
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
                </Row>
                {!loaded ? (
                  <Text color="gray">Reading the game's settings…</Text>
                ) : (
                  <>
                    <Text size="1" color="gray">
                      The game's saved size is {mainValue("Video", "ScreenWidth", "1920")} ×{" "}
                      {mainValue("Video", "ScreenHeight", "1080")}.
                    </Text>
                    <ToggleRow
                      id={settingId("Video", "StretchMovies")}
                      label="Stretch movies"
                      checked={mainToggle("Video", "StretchMovies", true)}
                      onChange={toggle("Video", "StretchMovies")}
                    />
                  </>
                )}
              </Section>
              {loaded ? (
                <Flex justify="end">
                  <Button variant="soft" onClick={() => void resetSections(["Video"])}>
                    Reset video defaults
                  </Button>
                </Flex>
              ) : null}
            </Flex>
          </Tabs.Content>

          <Tabs.Content value="keyboard">
            <Flex direction="column" gap="3" pt="4">
              {!loaded ? (
                <Text color="gray">Reading the game's settings…</Text>
              ) : (
                <>
                  {loaded.keyboardFromDefaults ? (
                    <Text size="2" color="gray">
                      This game has no keyboard file yet. These are its standard bindings; changing
                      one writes a complete keyboard file to the save store.
                    </Text>
                  ) : null}
                  <Grid columns="1fr 1fr" gap="4">
                    <Flex direction="column" gap="2">
                      <Text
                        as="label"
                        size="2"
                        weight="bold"
                        htmlFor={`launcher-hotkey-category-${game.slot}-${game.id}`}
                      >
                        Category
                      </Text>
                      <Select.Root
                        value={category}
                        onValueChange={(next) => {
                          setKeyboardCategory(next);
                          setSelectedHotkey(null);
                          setPendingHotkey(null);
                          setCapturing(false);
                        }}
                      >
                        <Select.Trigger
                          id={`launcher-hotkey-category-${game.slot}-${game.id}`}
                          aria-label="Category"
                        />
                        <Select.Content>
                          {hotkeyCategories.map((name) => (
                            <Select.Item key={name} value={name}>
                              {name}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                      <Text size="2" weight="bold" mt="2">
                        Description
                      </Text>
                      <div className={styles.hotkeyDescription}>
                        <Text size="2">
                          {selected
                            ? hotkeyDescription(selected.name)
                            : "No commands in this group."}
                        </Text>
                      </div>
                    </Flex>
                    <Flex direction="column" gap="2">
                      <Text size="2" weight="bold">
                        Commands
                      </Text>
                      <div className={styles.hotkeyCommands}>
                        {commands.map((hotkey) => (
                          <Button
                            key={hotkey.name}
                            className={styles.hotkeyCommand}
                            variant={selected?.name === hotkey.name ? "solid" : "ghost"}
                            color={selected?.name === hotkey.name ? undefined : "gray"}
                            onClick={() => {
                              setSelectedHotkey(hotkey.name);
                              setPendingHotkey(null);
                              setCapturing(false);
                            }}
                          >
                            {hotkeyAction(hotkey.name)}
                          </Button>
                        ))}
                      </div>
                    </Flex>
                  </Grid>

                  <Flex direction="column" gap="1">
                    <Text size="2" weight="bold">
                      Current hotkey
                    </Text>
                    <Text size="3">{selected ? hotkeyLabel(selected.value) : "—"}</Text>
                  </Flex>

                  <Flex direction="column" gap="2">
                    <Text size="2" weight="bold">
                      Assign new hotkey
                    </Text>
                    <Flex gap="2" align="center" wrap="wrap">
                      <Button
                        className={styles.hotkeyCapture}
                        variant="soft"
                        aria-label="Assign new hotkey"
                        onClick={() => {
                          setPendingHotkey(null);
                          setCapturing(true);
                        }}
                        onBlur={() => setCapturing(false)}
                        onKeyDown={(event) => {
                          if (!capturing) return;
                          event.preventDefault();
                          event.stopPropagation();
                          const value = hotkeyFromEvent(event.nativeEvent);
                          if (value === null) return;
                          setCapturing(false);
                          setPendingHotkey(value);
                        }}
                      >
                        {capturing
                          ? "Press a key…"
                          : pendingHotkey !== null
                            ? hotkeyLabel(pendingHotkey)
                            : "Click, then press a key"}
                      </Button>
                      <Button
                        disabled={
                          !selected || pendingHotkey === null || pendingHotkey === selected.value
                        }
                        onClick={() => {
                          if (!selected || pendingHotkey === null) return;
                          const value = pendingHotkey;
                          setPendingHotkey(null);
                          void saveHotkey(selected.name, value);
                        }}
                      >
                        Assign
                      </Button>
                    </Flex>
                    <Text size="1" color="gray">
                      {conflict
                        ? `Currently assigned to ${hotkeyAction(conflict.name)}.`
                        : "Choose a command, then press the key you want to use."}
                    </Text>
                  </Flex>

                  <Flex justify="end">
                    <Button variant="soft" color="red" onClick={() => void resetAllHotkeys()}>
                      Reset All
                    </Button>
                  </Flex>
                </>
              )}
            </Flex>
          </Tabs.Content>
        </Tabs.Root>

        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button>Done</Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
