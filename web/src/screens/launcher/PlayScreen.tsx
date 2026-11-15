import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { EDITION_BRAND } from "../../components/brand";
import { KeyArt } from "../../components/KeyArt";
import type { ActiveInstall } from "../../storage/active-install";
import type { BuildInfo, GameId } from "../../storage/install";
import type { GameRecord } from "../../storage/manifest";
import type { ModRecord } from "../../storage/mods";
import { needsResume, playStatus } from "./readiness";
import styles from "./PlayScreen.module.css";

const HEADING: Record<GameId, string[]> = {
  ra2: ["RED ALERT 2"],
  ra2md: ["YURI’S", "REVENGE"],
};

const EMPTY_HEADING = ["BRING YOUR", "OWN GAME"];
const STEPS = ["Choose your game folder", "Pick what to install, about 2 to 3 GB", "Play"];

function ModSwatch({ mod, edition }: { mod: string; edition: GameId }) {
  if (mod) return <span className={`${styles.swatch} ${styles.modSwatch}`} aria-hidden="true" />;
  const brand = EDITION_BRAND[edition];
  return (
    <span
      className={styles.swatch}
      style={{ background: brand.tile, borderColor: brand.tileBorder }}
      aria-hidden="true"
    />
  );
}

/** The mod the next PLAY loads: Vanilla or one of the edition's mods. */
function ProfilePicker({
  edition,
  mods,
  activeMod,
  onActiveMod,
}: {
  edition: GameId;
  mods: ModRecord[];
  activeMod: string;
  onActiveMod(name: string): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  async function pick(name: string) {
    setOpen(false);
    button.current?.focus();
    try {
      await onActiveMod(name);
      setFailure(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }

  const choices = ["", ...mods.map((mod) => mod.name)];
  return (
    <div
      className={styles.profile}
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      {open && (
        <div className={styles.menu}>
          <div role="listbox" aria-label="Profile">
            {choices.map((name) => (
              <button
                key={name || "vanilla"}
                type="button"
                role="option"
                aria-selected={name === activeMod}
                className={styles.option}
                onClick={() => void pick(name)}
              >
                <ModSwatch mod={name} edition={edition} />
                {name || "Vanilla"}
              </button>
            ))}
          </div>
          <Link to="/mods" className={styles.manage}>
            MANAGE MODS
          </Link>
        </div>
      )}
      <button
        ref={button}
        type="button"
        className={styles.profileButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
      >
        <ModSwatch mod={activeMod} edition={edition} />
        <span className={styles.profileText}>
          <span className={styles.label}>PROFILE</span>
          <span className={styles.profileName}>{activeMod || "Vanilla"}</span>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M4 10l4-4 4 4" />
        </svg>
      </button>
      {failure && (
        <p className={styles.failure} role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}

export function PlayScreen({
  install,
  edition,
  build,
  mods,
  activeMod,
  onActiveMod,
  onPlay,
  onInstall,
  onResume,
}: {
  install: ActiveInstall | null;
  edition: GameRecord | null;
  build?: BuildInfo;
  mods: ModRecord[];
  activeMod: string;
  onActiveMod(name: string): Promise<void>;
  onPlay(game: GameRecord): void;
  onInstall(): void;
  onResume(slot: number): void;
}) {
  if (!install) {
    return (
      <div className={styles.screen}>
        <KeyArt edition={null} dim={0.35} />
        <div className={styles.title}>
          <p className={`${styles.kicker} ${styles.emptyKicker}`}>NOTHING INSTALLED YET</p>
          <h1 className={styles.heading}>
            {EMPTY_HEADING.map((line, index) => (
              <span key={line}>
                {index > 0 ? " " : null}
                <span className={styles.line}>{line}</span>
              </span>
            ))}
          </h1>
          <p className={styles.intro}>
            Red Alert 2 and Yuri’s Revenge run here from your own copy: the CDs, The First Decade,
            the EA App or Steam. Nothing is uploaded.
          </p>
        </div>
        <footer className={`${styles.footer} ${styles.emptyFooter}`}>
          <ol className={styles.steps} aria-label="How it works">
            {STEPS.map((step, index) => (
              <li key={step}>
                <span className={styles.stepNumber}>{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <div className={`${styles.center} ${styles.emptyCenter}`}>
            <button
              type="button"
              className={`${styles.play} ${styles.install}`}
              onClick={onInstall}
            >
              INSTALL THE GAME
            </button>
          </div>
          <Link to="/install/guide" className={styles.guide}>
            <span className={styles.guideHint}>Files not ready?</span>
            <span className={styles.guideLink}>READ THE INSTALL GUIDE</span>
          </Link>
        </footer>
      </div>
    );
  }

  const slot = install.installation.slot;
  const resume = needsResume(install);
  const status = edition ? playStatus(edition, build) : null;
  const brand = edition ? EDITION_BRAND[edition.id] : null;

  return (
    <div className={styles.screen}>
      <KeyArt edition={edition?.id ?? null} />
      {edition && brand && (
        <div className={styles.title}>
          {brand.kicker && <p className={styles.kicker}>{brand.kicker}</p>}
          <h1 className={styles.heading}>
            {HEADING[edition.id].map((line, index) => (
              <span key={line}>
                {index > 0 ? " " : null}
                <span className={styles.line}>{line}</span>
              </span>
            ))}
          </h1>
        </div>
      )}
      <footer className={styles.footer}>
        <div className={styles.left}>
          {edition && (
            <ProfilePicker
              edition={edition.id}
              mods={mods}
              activeMod={activeMod}
              onActiveMod={onActiveMod}
            />
          )}
        </div>
        <div className={styles.center}>
          {edition && edition.complete ? (
            <button
              type="button"
              className={styles.play}
              disabled={!status?.canPlay}
              onClick={() => onPlay(edition)}
            >
              PLAY
            </button>
          ) : (
            <button type="button" className={styles.play} onClick={() => onResume(slot)}>
              RESUME INSTALL
            </button>
          )}
        </div>
        <div className={styles.right}>
          {edition?.complete && resume && (
            <button type="button" className={styles.textButton} onClick={() => onResume(slot)}>
              RESUME INSTALL
            </button>
          )}
          {status && (
            <div className={styles.status} role="status">
              <span
                className={status.ready ? styles.dotReady : styles.dotWait}
                aria-hidden="true"
              />
              {status.text}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
