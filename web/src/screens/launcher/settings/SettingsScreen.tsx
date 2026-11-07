import { Link } from "react-router";
import { KeyArt } from "../../../components/KeyArt";
import type { GameSettingsDeps } from "../../../storage/game-settings";
import type { GameRecord } from "../../../storage/manifest";
import page from "../Page.module.css";
import { AboutTab } from "./AboutTab";
import { AudioTab } from "./AudioTab";
import { GameplayTab } from "./GameplayTab";
import { KeyboardTab } from "./KeyboardTab";
import { LauncherTab } from "./LauncherTab";
import { useAllGamesSettings } from "./useAllGamesSettings";
import { VideoTab } from "./VideoTab";
import styles from "./SettingsScreen.module.css";

export const SETTINGS_TABS = [
  "launcher",
  "gameplay",
  "audio",
  "video",
  "keyboard",
  "about",
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const isSettingsTab = (value: string | undefined): value is SettingsTab =>
  (SETTINGS_TABS as readonly string[]).includes(value ?? "");

const TABS = {
  launcher: LauncherTab,
  gameplay: GameplayTab,
  audio: AudioTab,
  video: VideoTab,
  keyboard: KeyboardTab,
  about: AboutTab,
};

/** Every setting of the install, shown from one edition and written to all of them ("All games"). */
export function SettingsScreen({
  editions,
  edition,
  tab,
  gameSettingsDeps,
}: {
  editions: GameRecord[];
  edition: GameRecord;
  tab: SettingsTab;
  gameSettingsDeps?: Partial<GameSettingsDeps>;
}) {
  const settings = useAllGamesSettings(editions, edition, gameSettingsDeps);
  const Tab = TABS[tab];
  return (
    <div className={styles.screen}>
      <KeyArt edition={edition.id} dim={0.84} />
      <div className={`${page.page} ${styles.layout}`}>
        <nav className={styles.nav} aria-label="Settings">
          {SETTINGS_TABS.map((name) => (
            <Link
              key={name}
              to={`/settings/${name}`}
              className={styles.navLink}
              aria-current={name === tab ? "page" : undefined}
            >
              {name.toUpperCase()}
            </Link>
          ))}
        </nav>
        <div className={styles.content}>
          <div className={styles.head}>
            <h1 className={page.title}>SETTINGS</h1>
          </div>
          {settings.error && (
            <p className={page.failure} role="alert">
              {settings.error}
            </p>
          )}
          {/* keyed by edition so per-edition choices are read again when the rail changes it */}
          <Tab
            key={`${edition.storage}/${tab}`}
            editions={editions}
            edition={edition}
            settings={settings}
          />
        </div>
      </div>
    </div>
  );
}

/** No game yet: the launcher's own settings still have nowhere to be stored, but About has nothing to store. */
export function SettingsEmpty({ tab }: { tab?: SettingsTab }) {
  return (
    <div className={styles.screen}>
      <KeyArt edition={null} dim={0.84} />
      <div className={page.page}>
        <h1 className={page.title}>{tab === "about" ? "ABOUT" : "SETTINGS"}</h1>
        {tab === "about" ? (
          <div className={styles.content}>
            <AboutTab />
          </div>
        ) : (
          <div className={page.empty}>
            <p>Install the game to change its settings.</p>
            <Link to="/import" className={page.primary}>
              INSTALL THE GAME
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
