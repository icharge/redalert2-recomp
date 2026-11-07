import { useEffect, useState } from "react";
import changelogText from "../../../../CHANGELOG.md?raw";
import { loadBuildInfo, type BuildInfo } from "../../../storage/install";
import { APP_VERSION } from "../../../version";
import { newestRelease, type Release } from "./changelog";
import type { GameRecord } from "../../../storage/manifest";
import type { TabProps } from "./shared";
import styles from "./AboutTab.module.css";

export interface AboutDeps {
  version: string;
  release: Release | null;
  loadBuild(): Promise<BuildInfo>;
}

const browserDeps: AboutDeps = {
  version: APP_VERSION,
  release: newestRelease(changelogText),
  loadBuild: () => loadBuildInfo(),
};

/** How many changes are shown before "Show all". */
const FIRST = 5;

const TAGS: Record<string, string> = { Added: "NEW", Changed: "CHANGED", Fixed: "FIX" };
const COUNTED: Record<string, string> = { Added: "new", Changed: "changed", Fixed: "fixed" };

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** 2026-11-07 → 7 November 2026, the same in every locale. */
function longDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

const CREDITS: { role: string; who: string; href?: string }[] = [
  {
    role: "Web port & Launcher",
    who: "iCharge · redalert2-recomp",
    href: "https://github.com/icharge/redalert2-recomp",
  },
  {
    role: "Recompilation",
    who: "sp00nz · redalert2-recomp",
    href: "https://github.com/sp00nznet/redalert2-recomp",
  },
  {
    role: "Windows layer",
    who: "sp00nz · pcrecomp",
    href: "https://github.com/sp00nznet/pcrecomp",
  },
  { role: "Original game", who: "Westwood Studios" },
  { role: "Built with", who: "Emscripten, React, Radix UI, Vite" },
];

const LICENCES: [string, string][] = [
  ["YuriNET launcher", "MIT"],
  ["pcrecomp", "MIT"],
  ["React, React DOM", "MIT"],
  ["React Router", "MIT"],
  ["Radix UI Themes and Icons", "MIT"],
  ["Emscripten runtime", "MIT / University of Illinois NCSA"],
];

/** Settings › About: the launcher's version and build, what changed in it, credits and the legal notes. */
/** The other tabs' props are taken but not needed: About shows with no game installed too. */
export function AboutTab({
  edition = null,
  deps = browserDeps,
}: Partial<Omit<TabProps, "edition">> & { edition?: GameRecord | null; deps?: AboutDeps }) {
  const [build, setBuild] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [licences, setLicences] = useState(false);

  const editionId = edition?.id;
  useEffect(() => {
    let live = true;
    deps
      .loadBuild()
      .then((info) => {
        // the shown game's build, or with none installed the first game the page was built with
        const game = editionId
          ? info.games[editionId]
          : Object.values(info.games).find((g) => g?.build);
        if (live) setBuild(game?.build ?? null);
      })
      .catch(() => live && setBuild(null));
    return () => {
      live = false;
    };
  }, [deps, editionId]);

  const { release } = deps;
  const changes = (release?.groups ?? []).flatMap((group) =>
    group.entries.map((entry) => ({ ...entry, kind: group.kind })),
  );
  const shown = showAll ? changes : changes.slice(0, FIRST);
  const counts = (release?.groups ?? [])
    .filter((group) => group.entries.length > 0)
    .map((group) => `${group.entries.length} ${COUNTED[group.kind] ?? group.kind.toLowerCase()}`)
    .join(" · ");
  const heading =
    release && release.version !== "Unreleased" ? `What's new in ${release.version}` : "What's new";

  return (
    <div className={styles.about}>
      <div className={styles.column}>
        <section aria-label="Version" className={styles.card}>
          <h2 className={styles.name}>YURINET</h2>
          <p className={styles.lede}>
            Red Alert 2 and Yuri’s Revenge, recompiled and running in your browser.
          </p>
          <dl className={styles.facts}>
            <dt>Version</dt>
            <dd>{deps.version}</dd>
            <dt>Build</dt>
            <dd>{build ?? "…"}</dd>
            {edition && (
              <>
                <dt>Game</dt>
                <dd>{edition.title}</dd>
              </>
            )}
          </dl>
        </section>

        <section aria-labelledby="about-news">
          <div className={styles.sectionHead}>
            <h2 id="about-news" className={styles.label}>
              {heading}
            </h2>
            {release?.date && <span className={styles.meta}>{longDate(release.date)}</span>}
          </div>
          {changes.length === 0 ? (
            <p className={styles.meta}>No changes are listed yet.</p>
          ) : (
            <>
              {counts && <p className={styles.meta}>{counts}</p>}
              <ul className={styles.changes} data-all={showAll || undefined}>
                {shown.map((change, i) => (
                  <li key={i} className={styles.change}>
                    <span className={styles.tag} data-kind={change.kind}>
                      {TAGS[change.kind] ?? change.kind.toUpperCase()}
                    </span>
                    <span className={styles.changeText}>
                      {change.title && <span className={styles.changeTitle}>{change.title}</span>}
                      <span>{change.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {changes.length > FIRST && (
                <button
                  type="button"
                  className={styles.more}
                  aria-expanded={showAll}
                  onClick={() => setShowAll((now) => !now)}
                >
                  {showAll ? "Show fewer" : `Show all ${changes.length} changes`}
                </button>
              )}
            </>
          )}
        </section>
      </div>

      <div className={styles.column}>
        <section aria-labelledby="about-credits">
          <h2 id="about-credits" className={styles.label}>
            Credits
          </h2>
          <dl className={styles.credits}>
            {CREDITS.map((credit) => (
              <div key={credit.role} className={styles.credit}>
                <dt>{credit.role}</dt>
                <dd>
                  {credit.href ? (
                    <a
                      href={credit.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.link}
                    >
                      {credit.who}
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        aria-hidden="true"
                      >
                        <path d="M6 3H3v10h10v-3M9 2.5h4.5V7M13.5 2.5L7.5 8.5" />
                      </svg>
                    </a>
                  ) : (
                    credit.who
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="about-legal" className={styles.legal}>
          <h2 id="about-legal" className={styles.label}>
            Legal
          </h2>
          <p>
            Command &amp; Conquer: Red Alert 2 and Yuri’s Revenge are © Electronic Arts Inc. YuriNET
            is a fan project. It is not made, endorsed or supported by Electronic Arts.
          </p>
          <p className={styles.meta}>
            The game files come from your own copy and stay in this browser.
          </p>
          <p className={styles.meta}>
            YuriNET © 2026 THAI RA2. Its code is under the MIT licence and builds on the
            recompilation, © 2026 sp00nz.
          </p>
          <button
            type="button"
            className={styles.quiet}
            aria-expanded={licences}
            onClick={() => setLicences((now) => !now)}
          >
            OPEN-SOURCE LICENCES
          </button>
          {licences && (
            <ul className={styles.licences}>
              {LICENCES.map(([name, licence]) => (
                <li key={name}>
                  <span>{name}</span>
                  <span className={styles.meta}>{licence}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
