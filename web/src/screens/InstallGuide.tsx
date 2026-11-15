import { Link } from "react-router";
import { KeyArt } from "../components/KeyArt";
import { ARCHIVE_ACCEPT } from "../storage/archive";
import {
  GAME_TITLE,
  REQUIRED_CONTENT,
  REQUIRED_MOVIE_ARCHIVES,
  type GameId,
} from "../storage/install";
import page from "./launcher/Page.module.css";
import styles from "./InstallGuide.module.css";

export interface GameSource {
  id: string;
  name: string;
  /** what the player has to do before there is a folder to pick */
  before: string;
  /** where the installed folder usually is */
  folders: string[];
  /** which folder to pick, and how to find it if it moved */
  pick: string;
}

/** Where each copy of the game puts its files, and the folder the import wants. */
export const SOURCES: GameSource[] = [
  {
    id: "cd",
    name: "Original CDs",
    before:
      "Install Red Alert 2 from its CD, then Yuri’s Revenge from its own CD into the same folder. The CD’s Setup.exe cannot be read here: install first, then pick the installed folder.",
    folders: ["C:\\Westwood\\RA2"],
    pick: "The folder you installed to, the one that holds RA2.MIX (and RA2MD.MIX once Yuri’s Revenge is in).",
  },
  {
    id: "tfd",
    name: "The First Decade",
    before: "Install The First Decade with Red Alert 2 and Yuri’s Revenge ticked.",
    folders: [
      "C:\\Program Files (x86)\\EA Games\\Command & Conquer The First Decade\\Command & Conquer Red Alert(tm) II",
    ],
    pick: "The Red Alert II folder inside The First Decade, not The First Decade’s own folder: both games are in it.",
  },
  {
    id: "ea",
    name: "EA App or Origin",
    before:
      "Install Command & Conquer Red Alert 2 and Yuri’s Revenge (part of The Ultimate Collection).",
    folders: [
      "C:\\Program Files\\EA Games\\Command and Conquer Red Alert II",
      "C:\\Program Files (x86)\\Origin Games\\Command and Conquer Red Alert II",
    ],
    pick: "The Red Alert II folder. If you chose another place when installing, it is the folder there that holds RA2.MIX and gamemd.exe.",
  },
  {
    id: "steam",
    name: "Steam",
    before:
      "Install Command & Conquer Red Alert 2 and Yuri’s Revenge (part of The Ultimate Collection).",
    folders: ["C:\\Program Files (x86)\\Steam\\steamapps\\common\\Command & Conquer Red Alert II"],
    pick: "The Red Alert II folder. In Steam, right-click the game, then Manage, then Browse local files to open it, wherever your library is.",
  },
];

/** What the import keeps of a folder (storage/install.ts decides; the guide's test checks these). */
export const COPIED: { label: string; files: string[] }[] = [
  { label: "The game’s archives", files: ["*.mix"] },
  { label: "Sound", files: ["audio.bag", "audio.idx", "audiomd.bag", "audiomd.idx"] },
  { label: "Rules, text and fonts", files: ["*.ini", "*.csf", "*.fnt"] },
  { label: "Custom maps (you choose)", files: ["*.map", "*.mpr", "*.yrm"] },
  { label: "Saved games (you choose)", files: ["*.sav", "Saved Games/"] },
  {
    label: "Settings and hotkeys (you choose)",
    files: ["ra2.ini", "ra2md.ini", "keyboard.ini", "keyboardmd.ini"],
  },
];

/** Never copied: the web build brings its own game code. */
export const NOT_COPIED = ["game.exe", "gamemd.exe", "Blowfish.dll", "binkw32.dll"];

const EDITIONS: GameId[] = ["ra2", "ra2md"];
const archives = ARCHIVE_ACCEPT.split(",").join(", ");

function Files({ names }: { names: readonly string[] }) {
  return (
    <span className={styles.files}>
      {names.map((name) => (
        <code key={name}>{name}</code>
      ))}
    </span>
  );
}

/** The bring-your-own-game guide: where each copy of the game is, what is copied, where it stays. */
export function InstallGuide() {
  return (
    <div className={styles.screen}>
      <KeyArt edition={null} dim={0.78} />
      <div className={page.page}>
        <header className={styles.intro}>
          <h1 className={page.title}>INSTALL GUIDE</h1>
          <p className={styles.lead}>
            You bring your own copy of Red Alert 2 and Yuri’s Revenge. Install it on this computer
            as usual, then pick its folder on the install screen: the launcher copies what the game
            reads into this browser. Nothing of the game is downloaded from this site.
          </p>
        </header>

        <section aria-labelledby="guide-where" className={styles.block}>
          <h2 id="guide-where" className={page.label}>
            WHERE IS YOUR GAME?
          </h2>
          <div className={styles.sources}>
            {SOURCES.map((source) => (
              <article
                key={source.id}
                className={page.panel}
                aria-labelledby={`guide-${source.id}`}
              >
                <h3 id={`guide-${source.id}`} className={styles.sourceTitle}>
                  {source.name}
                </h3>
                <p className={styles.text}>{source.before}</p>
                <dl className={styles.facts}>
                  <dt>Usually in</dt>
                  <dd>
                    {source.folders.map((folder) => (
                      <code key={folder} className={styles.path}>
                        {folder}
                      </code>
                    ))}
                  </dd>
                  <dt>Pick</dt>
                  <dd>{source.pick}</dd>
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="guide-how" className={page.panel}>
          <h2 id="guide-how" className={page.label}>
            THE FOLDER, OR AN ARCHIVE OR INSTALLER
          </h2>
          <ul className={styles.list}>
            <li>
              <strong>A folder.</strong> In Chrome or Edge, CHOOSE FOLDER opens the folder picker.
              In Firefox or Safari, drag the folder onto the drop zone.
            </li>
            <li>
              <strong>An archive or installer.</strong> Use an archive or installer takes a{" "}
              {archives} file: an archive of the game folder, or an installer 7-Zip can open. The
              CD’s Setup.exe and some installers cannot be opened: install the game, then pick its
              folder.
            </li>
            <li>
              Before it copies, the install screen shows what it found and its size, and you choose
              whether to bring the movies, mods, custom maps, saved games and settings.
            </li>
          </ul>
        </section>

        <section aria-labelledby="guide-copied" className={page.panel}>
          <h2 id="guide-copied" className={page.label}>
            WHAT IS COPIED
          </h2>
          <p className={styles.text}>
            Only the files the game reads, from the top of the folder. Each game needs these:
          </p>
          <ul className={styles.list}>
            {EDITIONS.map((id) => (
              <li key={id}>
                <strong>{GAME_TITLE[id]}:</strong> <Files names={REQUIRED_CONTENT[id]} />, and the
                movies <Files names={REQUIRED_MOVIE_ARCHIVES[id]} /> (optional: without them the
                cutscenes are skipped)
              </li>
            ))}
          </ul>
          <dl className={styles.table}>
            {COPIED.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>
                  <Files names={row.files} />
                </dd>
              </div>
            ))}
            <div>
              <dt>Mods (you choose)</dt>
              <dd>
                each folder in <code>Mods</code> becomes a mod on the MODS tab
              </dd>
            </div>
            <div>
              <dt>Never copied</dt>
              <dd>
                <Files names={NOT_COPIED} />: the web build brings its own game code, and tools,
                backups and other files are left where they are
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="guide-stays" className={page.panel}>
          <h2 id="guide-stays" className={page.label}>
            WHERE IT STAYS
          </h2>
          <ul className={styles.list}>
            <li>
              In this browser’s own storage for this site, on this computer. Another browser,
              another profile or a private window does not see it.
            </li>
            <li>
              Saved games and settings the game writes stay there too. The GAME tab downloads your
              saves as a zip and removes the game when you want the space back.
            </li>
            <li>Clearing this site’s data in the browser removes the copy and its saves.</li>
          </ul>
        </section>

        <section aria-labelledby="guide-never" className={page.panel}>
          <h2 id="guide-never" className={page.label}>
            WHAT IS NEVER UPLOADED
          </h2>
          <p className={styles.text}>
            Your game files, saved games and settings. The page reads and copies them inside your
            browser; none of them is sent to this site or anyone else. Playing online sends only
            what the game itself sends to play: your name, chat and the moves of the match.
          </p>
        </section>

        <footer className={styles.footer}>
          <Link to="/import" className={page.primary}>
            INSTALL THE GAME
          </Link>
        </footer>
      </div>
    </div>
  );
}
