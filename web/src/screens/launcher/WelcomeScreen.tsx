import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { OfflineError, describeAccountError } from "../../account/api";
import { account, useAccount, type AccountState, type AccountStore } from "../../account/store";
import { BrandImage } from "../../components/BrandImage";
import { LOGO_SRC } from "../../components/brand";
import { KeyArt } from "../../components/KeyArt";
import { appPath } from "../../paths";
import { writeWelcomeDismissed } from "../../storage/welcome-preferences";
import { useAction } from "./AccountScreen";
import page from "./Page.module.css";
import styles from "./WelcomeScreen.module.css";

/** The navigation state of the launcher's own redirect from `/` (a first run, nothing installed). */
export const WELCOME_REDIRECT = { welcome: "redirect" } as const;

type Tab = "login" | "register";
const TABS: { id: Tab; label: string }[] = [
  { id: "login", label: "LOGIN" },
  { id: "register", label: "CREATE ACCOUNT" },
];

function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      <input
        id={id}
        className={styles.input}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...input}
      />
      {hint && (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      )}
    </div>
  );
}

function LoginForm({ store, onDone }: { store: AccountStore; onDone(): void }) {
  const { busy, failure, run } = useAction();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => store.signIn(login.trim(), password)).then((ok) => ok && onDone());
  };
  return (
    <form className={styles.form} onSubmit={submit} aria-label="Login">
      <Field
        label="Name or email"
        value={login}
        onChange={(event) => setLogin(event.target.value)}
        autoComplete="username"
        required
      />
      <Field
        label="Password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        required
      />
      {failure && (
        <p className={page.failure} role="alert">
          {failure}
        </p>
      )}
      <button type="submit" className={`${page.primary} ${styles.submit}`} disabled={busy}>
        {busy ? "SIGNING IN…" : "LOGIN"}
      </button>
    </form>
  );
}

function RegisterForm({ store, onDone }: { store: AccountStore; onDone(): void }) {
  const { busy, failure, run } = useAction();
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => store.register(login.trim(), password, email.trim() || undefined)).then(
      (ok) => ok && onDone(),
    );
  };
  return (
    <form className={styles.form} onSubmit={submit} aria-label="Create account">
      <Field
        label="Login"
        hint="3 to 32 letters, digits, dots, dashes or underscores"
        value={login}
        onChange={(event) => setLogin(event.target.value)}
        autoComplete="username"
        required
      />
      <Field
        label="Email (optional)"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
      />
      <Field
        label="Password"
        hint="8 to 64 characters"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        required
      />
      {failure && (
        <p className={page.failure} role="alert">
          {failure}
        </p>
      )}
      <button type="submit" className={`${page.primary} ${styles.submit}`} disabled={busy}>
        {busy ? "CREATING…" : "CREATE ACCOUNT"}
      </button>
    </form>
  );
}

/**
 * The navigation state the welcome page hands on: `/` then shows PLAY even while nothing is
 * installed (its "no game installed" state, with INSTALL THE GAME) instead of coming back here.
 */
export const WELCOME_PASSED = { welcome: "passed" } as const;

/** Whether a location state came from the welcome page moving the player on. */
export function welcomePassed(state: unknown): boolean {
  return (
    typeof state === "object" && state !== null && "welcome" in state && state.welcome === "passed"
  );
}

/** Where a player goes on from the welcome page. */
function nextPage(installed: boolean, state: AccountState): string {
  // with nothing installed, PLAY shows its "no game installed" state and the way to install
  if (!installed) return "/";
  // a member needs a game account (their online name) to play online
  if (state.status === "member" && state.gameAccounts.length === 0) return "/account";
  return "/";
}

/**
 * The first page a new player sees: what this is, that they bring their own copy of the game, and
 * the choice to become a member (the tab it opens on), log in, or play as a guest.
 */
export function WelcomeScreen({
  installed,
  store = account,
}: {
  installed: boolean;
  store?: AccountStore;
}) {
  const navigate = useNavigate();
  const state: unknown = useLocation().state;
  const redirected =
    typeof state === "object" &&
    state !== null &&
    "welcome" in state &&
    state.welcome === "redirect";
  // `/` can redirect here before the records are read again (BACK from an import just started):
  // once an install shows up, the page the player asked for is PLAY.
  const who = useAccount(store);
  // a signed-in member is never held on this page: PLAY (or its "no game installed" state)
  const member = who.status === "member";
  useEffect(() => {
    if (redirected && (installed || member))
      void navigate("/", { replace: true, state: WELCOME_PASSED });
  }, [redirected, installed, member, navigate]);

  const [tab, setTab] = useState<Tab>("register");
  const tabs = useId();
  const proceed = () =>
    void navigate(nextPage(installed, store.getState()), { state: WELCOME_PASSED });

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const at = TABS.findIndex((entry) => entry.id === tab);
    const next = TABS[(at + step + TABS.length) % TABS.length]?.id ?? tab;
    setTab(next);
    document.getElementById(`${tabs}-${next}`)?.focus();
  };

  return (
    <div className={styles.screen}>
      <KeyArt edition={null} dim={0.4} />
      <div className={styles.content}>
        <header className={styles.intro}>
          <BrandImage
            src={appPath(LOGO_SRC)}
            alt="YuriNet"
            className={styles.logo}
            fallback={<span className={styles.logoText}>YURINET</span>}
          />
          <p className={styles.kicker}>WELCOME TO YURINET</p>
          <h1 className={styles.title}>
            <span>RED ALERT 2</span> <span>ONLINE</span>
          </h1>
          <p className={styles.lead}>
            Bring your own copy of the game. Its files stay in this browser and are never uploaded.{" "}
            <Link to="/install/guide" className={styles.guide}>
              Install guide
            </Link>
          </p>
        </header>

        <section className={styles.panel} aria-label="Account">
          {who.status === "member" ? (
            <div className={styles.member}>
              <p className={styles.memberLabel}>SIGNED IN AS</p>
              <p className={styles.memberName}>{who.member.login}</p>
              <button
                type="button"
                className={`${page.primary} ${styles.submit}`}
                onClick={proceed}
              >
                CONTINUE
              </button>
            </div>
          ) : (
            <>
              <div role="tablist" aria-label="Account" className={styles.tabs}>
                {TABS.map((entry) => (
                  <button
                    key={entry.id}
                    id={`${tabs}-${entry.id}`}
                    type="button"
                    role="tab"
                    className={styles.tab}
                    aria-selected={tab === entry.id}
                    aria-controls={`${tabs}-panel`}
                    tabIndex={tab === entry.id ? 0 : -1}
                    onClick={() => setTab(entry.id)}
                    onKeyDown={onTabKey}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <div role="tabpanel" id={`${tabs}-panel`} aria-labelledby={`${tabs}-${tab}`}>
                {who.status === "offline" && (
                  <p className={`${page.warn} ${styles.notice}`} role="status">
                    {describeAccountError(new OfflineError())}
                  </p>
                )}
                {who.status === "guest" && who.notice && (
                  <p className={`${page.warn} ${styles.notice}`} role="status">
                    {who.notice}
                  </p>
                )}
                {tab === "login" ? (
                  <LoginForm store={store} onDone={proceed} />
                ) : (
                  <RegisterForm store={store} onDone={proceed} />
                )}
              </div>
            </>
          )}

          <div className={styles.or} aria-hidden="true">
            OR
          </div>
          <Link to="/" state={WELCOME_PASSED} className={styles.guest}>
            PLAY AS GUEST
          </Link>
          <p className={styles.guestNote}>Guests play online unranked, with no clan.</p>
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => {
              writeWelcomeDismissed();
              void navigate("/");
            }}
          >
            DON&apos;T SHOW THIS AGAIN
          </button>
        </section>
      </div>
    </div>
  );
}
