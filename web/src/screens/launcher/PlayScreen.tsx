import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { prepareLaunch } from "../../account/launch";
import { account, useAccount, type AccountStore } from "../../account/store";
import { EDITION_BRAND } from "../../components/brand";
import { KeyArt } from "../../components/KeyArt";
import type { ActiveInstall } from "../../storage/active-install";
import type { BuildInfo, GameId } from "../../storage/install";
import {
  GUEST_NAME_MAX,
  readGuestName,
  writeGuestName,
} from "../../storage/guest-name-preferences";
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

/**
 * What PLAY says about online play: a guest can give a name (remembered in this browser), a member
 * without a game account is pointed to the Account page, and a refusal of the ticket shows here.
 */
function OnlineName({
  store,
  name,
  onName,
  refusal,
}: {
  store: AccountStore;
  name: string;
  onName(name: string): void;
  refusal: string | null;
}) {
  const state = useAccount(store);
  const id = useId();
  const guest = state.status === "guest";
  const needsAccount = state.status === "member" && state.gameAccounts.length === 0;
  if (!guest && !needsAccount && !refusal) return null;
  return (
    <div className={styles.online}>
      {guest && (
        <>
          <label htmlFor={id} className={styles.label}>
            ONLINE NAME
          </label>
          <input
            id={id}
            className={styles.nameInput}
            value={name}
            maxLength={GUEST_NAME_MAX}
            placeholder="Optional, for playing online"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={refusal ? true : undefined}
            onChange={(event) => onName(event.target.value)}
          />
        </>
      )}
      {needsAccount && (
        <p className={styles.onlineHint}>
          No game account yet. <Link to="/account">Add one on the Account page</Link> to play online
          as yourself.
        </p>
      )}
      {refusal && (
        <p className={styles.onlineFailure} role="alert">
          {refusal}
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
  accountStore = account,
}: {
  install: ActiveInstall | null;
  edition: GameRecord | null;
  build?: BuildInfo;
  mods: ModRecord[];
  activeMod: string;
  onActiveMod(name: string): Promise<void>;
  /** Opens the game; `ticket` goes into the address as `#ticket=` for the game to log in with. */
  onPlay(game: GameRecord, ticket?: string): void;
  onInstall(): void;
  onResume(slot: number): void;
  accountStore?: AccountStore;
}) {
  const [guestName, setGuestName] = useState(() => readGuestName());
  const [refusal, setRefusal] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  // after a refusal of the member's own ticket, the next PLAY opens the game without one
  const skipTicket = useRef(false);

  const changeName = (name: string) => {
    setGuestName(name);
    writeGuestName(name.trim());
    setRefusal(null);
  };

  /** Mint the ticket now (it lives 60 s), then open the game; a refusal stays on this page. */
  async function play(game: GameRecord) {
    if (launching) return;
    setLaunching(true);
    setRefusal(null);
    try {
      if (skipTicket.current) {
        skipTicket.current = false;
        onPlay(game);
        return;
      }
      const plan = await prepareLaunch(accountStore, game.id, guestName);
      if (plan.kind === "refused") {
        skipTicket.current = plan.skippable;
        setRefusal(
          plan.skippable ? `${plan.message} Press PLAY again to play without it.` : plan.message,
        );
        return;
      }
      onPlay(game, plan.ticket);
    } finally {
      setLaunching(false);
    }
  }

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
          {edition && activeMod && (
            <p className={styles.modNote}>
              Quick Match uses the stock maps. A mod that replaces a stock map gives it another
              digest, so Quick Match may not find a match.
            </p>
          )}
        </div>
        <OnlineName store={accountStore} name={guestName} onName={changeName} refusal={refusal} />
        <div className={styles.center}>
          {edition && edition.complete ? (
            <button
              type="button"
              className={styles.play}
              disabled={!status?.canPlay || launching}
              onClick={() => void play(edition)}
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
