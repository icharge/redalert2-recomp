import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { KeyArt } from "../../components/KeyArt";
import { writeWelcomeDismissed } from "../../storage/welcome-preferences";
import page from "./Page.module.css";
import styles from "./WelcomeScreen.module.css";

/** The navigation state of the launcher's own redirect from `/` (a first run, nothing installed). */
export const WELCOME_REDIRECT = { welcome: "redirect" } as const;

/**
 * The first page a new player sees: what this is, that they bring their own copy of the game, and
 * the choice to play as a guest or sign in as a member.
 */
export function WelcomeScreen({ installed }: { installed: boolean }) {
  const navigate = useNavigate();
  const state: unknown = useLocation().state;
  const redirected =
    typeof state === "object" &&
    state !== null &&
    "welcome" in state &&
    state.welcome === "redirect";
  // `/` can redirect here before the records are read again (BACK from an import just started):
  // once an install shows up, the page the player asked for is PLAY.
  useEffect(() => {
    if (redirected && installed) void navigate("/", { replace: true });
  }, [redirected, installed, navigate]);
  // a guest with nothing installed has to bring the game in first
  const guest = installed ? "/" : "/install/guide";
  return (
    <div className={styles.screen}>
      <KeyArt edition={null} dim={0.55} />
      <div className={`${page.page} ${styles.page}`}>
        <header className={styles.intro}>
          <p className={styles.kicker}>WELCOME TO YURINET</p>
          <h1 className={styles.title}>RED ALERT 2 AND YURI’S REVENGE, IN YOUR BROWSER</h1>
          <p className={styles.lead}>
            The original games, recompiled to run in this page: campaign, skirmish, LAN and online
            play, with your saves kept in this browser.
          </p>
        </header>

        <section className={page.panel} aria-labelledby="welcome-byog">
          <h2 id="welcome-byog" className={page.label}>
            BRING YOUR OWN GAME
          </h2>
          <p className={styles.text}>
            You play with your own copy: the original CDs, The First Decade, the EA App (Origin) or
            Steam. Nothing of the game is downloaded from this site. You pick your game folder, and
            the launcher copies the files the game reads into this browser&apos;s storage. They are
            never uploaded.
          </p>
          <div className={styles.actions}>
            <Link to="/install/guide" className={page.outline}>
              READ THE INSTALL GUIDE
            </Link>
            {!installed && (
              <Link to="/import" className={page.quiet}>
                I HAVE MY GAME FOLDER
              </Link>
            )}
          </div>
        </section>

        <section className={styles.choices} aria-labelledby="welcome-how">
          <h2 id="welcome-how" className={`${page.label} ${styles.choicesLabel}`}>
            HOW DO YOU WANT TO PLAY?
          </h2>
          <article className={`${page.panel} ${styles.choice}`} aria-labelledby="welcome-guest">
            <h3 id="welcome-guest" className={styles.choiceTitle}>
              GUEST
            </h3>
            <p className={styles.text}>
              Play straight away, with no account. Your games, saves and settings stay in this
              browser.
            </p>
            <Link to={guest} className={page.primary}>
              PLAY AS GUEST
            </Link>
          </article>
          <article className={`${page.panel} ${styles.choice}`} aria-labelledby="welcome-member">
            <h3 id="welcome-member" className={styles.choiceTitle}>
              MEMBER
            </h3>
            <p className={styles.text}>
              A member account keeps your online name and signs you in to the game&apos;s online
              lobby without typing.
            </p>
            <Link to="/account" className={page.outline}>
              SIGN IN
            </Link>
          </article>
        </section>

        <footer className={styles.footer}>
          <button
            type="button"
            className={page.quiet}
            onClick={() => {
              writeWelcomeDismissed();
              void navigate("/");
            }}
          >
            DON&apos;T SHOW THIS AGAIN
          </button>
        </footer>
      </div>
    </div>
  );
}
