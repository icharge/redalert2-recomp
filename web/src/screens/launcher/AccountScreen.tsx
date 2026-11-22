import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { describeAccountError, OfflineError } from "../../account/api";
import { account, useAccount, type AccountStore } from "../../account/store";
import { KeyArt } from "../../components/KeyArt";
import styles from "./AccountScreen.module.css";
import page from "./Page.module.css";

/** A game account's name is at most 9 characters (the game's own dialog width). */
export const NICK_MAX = 9;

type Task = "idle" | "working";

/** Runs a form's action once at a time and keeps the refusal's text for the form. */
export function useAction() {
  const [task, setTask] = useState<Task>("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setTask("working");
    setFailure(null);
    try {
      await action();
      return true;
    } catch (error) {
      setFailure(describeAccountError(error));
      return false;
    } finally {
      setTask("idle");
    }
  };
  return { busy: task === "working", failure, run, clear: () => setFailure(null) };
}

function Field({
  label,
  hint,
  ...input
}: {
  label: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
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

function SignIn({ store }: { store: AccountStore }) {
  const { busy, failure, run } = useAction();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => store.signIn(login.trim(), password));
  };
  return (
    <form className={page.panel} onSubmit={submit} aria-labelledby="account-signin">
      <h2 id="account-signin" className={page.label}>
        SIGN IN
      </h2>
      <Field
        label="Login or email"
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
      <button type="submit" className={page.primary} disabled={busy}>
        {busy ? "SIGNING IN…" : "SIGN IN"}
      </button>
    </form>
  );
}

function CreateMember({ store }: { store: AccountStore }) {
  const { busy, failure, run } = useAction();
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => store.register(login.trim(), password, email.trim() || undefined));
  };
  return (
    <form className={page.panel} onSubmit={submit} aria-labelledby="account-register">
      <h2 id="account-register" className={page.label}>
        CREATE A MEMBER
      </h2>
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
      <button type="submit" className={page.outline} disabled={busy}>
        {busy ? "CREATING…" : "CREATE MEMBER"}
      </button>
    </form>
  );
}

/**
 * What a game account's password is for: the game's own login dialog and native clients. The
 * launcher signs in without it, so a new game account starts "launcher sign-in only".
 */
function GamePassword({
  store,
  game,
}: {
  store: AccountStore;
  game: { username: string; hasPassword: boolean };
}) {
  const { busy, failure, run, clear } = useAction();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const verb = game.hasPassword ? "CHANGE GAME PASSWORD" : "SET GAME PASSWORD";
  const close = () => {
    setOpen(false);
    setPassword("");
    clear();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setDone(null);
    void run(async () => {
      await store.setGameAccountPassword(game.username, password);
      setDone(`Game password saved for ${game.username}.`);
      close();
    });
  };
  return (
    <div className={styles.gamePassword}>
      <p className={page.status}>
        {game.username}: {game.hasPassword ? "game password set" : "Launcher sign-in only"}
      </p>
      {open ? (
        <form className={styles.form} onSubmit={submit} aria-label={verb}>
          <Field
            label={`New game password for ${game.username}`}
            hint="8 to 64 characters. Used to sign in without the launcher"
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
          <div className={styles.actions}>
            <button type="submit" className={page.primary} disabled={busy}>
              {busy ? "SAVING…" : "SAVE PASSWORD"}
            </button>
            <button type="button" className={page.quiet} disabled={busy} onClick={close}>
              CANCEL
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={page.outline}
            onClick={() => {
              setDone(null);
              setOpen(true);
            }}
          >
            {verb}
          </button>
        </div>
      )}
      {done && (
        <p className={`${page.status} ${page.ok}`} role="status">
          {done}
        </p>
      )}
    </div>
  );
}

function GameAccountPanel({
  store,
  gameAccounts,
  maxGameAccounts,
}: {
  store: AccountStore;
  gameAccounts: { username: string; hasPassword: boolean }[];
  maxGameAccounts: number;
}) {
  const { busy, failure, run, clear } = useAction();
  const [nick, setNick] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const full = gameAccounts.length >= maxGameAccounts;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setDone(null);
    void run(async () => {
      const result = await store.addGameAccount(nick.trim(), password);
      setDone(
        result.created
          ? `Game account ${result.gameAccount.username} created.`
          : `Game account ${result.gameAccount.username} is now yours.`,
      );
      setNick("");
      setPassword("");
    });
  };
  return (
    <section className={page.panel} aria-labelledby="account-game">
      <h2 id="account-game" className={page.label}>
        GAME ACCOUNT
        <span className={styles.count} data-full={full || undefined}>
          {gameAccounts.length} of {maxGameAccounts}
        </span>
      </h2>
      {gameAccounts.length > 0 && (
        <ul className={styles.nicks}>
          {gameAccounts.map((game) => (
            <li key={game.username} className={styles.nick}>
              {game.username}
            </li>
          ))}
        </ul>
      )}
      {gameAccounts.map((game) => (
        <GamePassword key={game.username} store={store} game={game} />
      ))}
      {full ? (
        <p className={page.status}>
          This member has all the game accounts it can have: {gameAccounts.length} of{" "}
          {maxGameAccounts}. You play as {gameAccounts[0]?.username ?? "it"} in the online lobby.
        </p>
      ) : (
        <form className={styles.form} onSubmit={submit}>
          <p className={page.status}>
            Your name in the online lobby. A new name is created; the name of a game account you
            already have is claimed with its password (not optional then).
          </p>
          <Field
            label="Game name"
            hint={`Up to ${NICK_MAX} characters`}
            value={nick}
            maxLength={NICK_MAX}
            onChange={(event) => {
              setNick(event.target.value);
              clear();
            }}
            autoComplete="off"
            required
          />
          <Field
            label="Game account password (optional)"
            hint="Optional. Only needed to sign in without the launcher."
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
          />
          {failure && (
            <p className={page.failure} role="alert">
              {failure}
            </p>
          )}
          <button type="submit" className={page.primary} disabled={busy}>
            {busy ? "WORKING…" : "CREATE OR CLAIM"}
          </button>
        </form>
      )}
      {done && (
        <p className={`${page.status} ${page.ok}`} role="status">
          {done}
        </p>
      )}
    </section>
  );
}

function MemberSection({
  store,
  state,
}: {
  store: AccountStore;
  state: Extract<ReturnType<typeof useAccount>, { status: "member" }>;
}) {
  const out = useAction();
  const everywhere = useAction();
  return (
    <>
      <section className={page.panel} aria-labelledby="account-member">
        <h2 id="account-member" className={page.label}>
          MEMBER
        </h2>
        <p className={styles.who}>{state.member.login}</p>
        {state.member.email && <p className={page.status}>{state.member.email}</p>}
        <div className={styles.actions}>
          <button
            type="button"
            className={page.outline}
            disabled={out.busy}
            onClick={() => void out.run(() => store.signOut())}
          >
            SIGN OUT
          </button>
          <button
            type="button"
            className={page.quiet}
            disabled={everywhere.busy}
            onClick={() => void everywhere.run(() => store.signOutEverywhere())}
          >
            SIGN OUT EVERYWHERE
          </button>
        </div>
        <p className={page.status}>
          Sign out ends this browser&apos;s session. Sign out everywhere ends it on every device.
        </p>
        {(out.failure ?? everywhere.failure) && (
          <p className={page.failure} role="alert">
            {out.failure ?? everywhere.failure}
          </p>
        )}
      </section>
      <GameAccountPanel
        store={store}
        gameAccounts={state.gameAccounts}
        maxGameAccounts={state.maxGameAccounts}
      />
    </>
  );
}

/**
 * `/account`: sign in or create a member, then the member's one game account (create or claim) and
 * sign out. Without a reachable server the launcher stays a guest and says so.
 */
export function AccountScreen({ store = account }: { store?: AccountStore }) {
  const state = useAccount(store);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <KeyArt edition={null} dim={0.78} />
      <div className={`${page.page} ${styles.page}`}>
        <h1 className={page.title}>ACCOUNT</h1>
        {state.status === "unknown" && (
          <p className={page.status} role="status">
            Checking your session…
          </p>
        )}
        {state.status === "offline" && (
          <section className={page.panel} aria-label="Offline">
            <p className={page.warn} role="status">
              {state.notice ?? describeAccountError(new OfflineError())}
            </p>
            <div className={styles.actions}>
              <button type="button" className={page.outline} onClick={() => void store.retry()}>
                TRY AGAIN
              </button>
              <Link to="/" className={page.quiet}>
                BACK TO PLAY
              </Link>
            </div>
          </section>
        )}
        {state.status === "guest" && (
          <>
            <p className={page.status}>
              You are playing as a guest. A member keeps one online name and signs in to the
              game&apos;s lobby without typing.
            </p>
            {state.notice && (
              <p className={page.warn} role="status">
                {state.notice}
              </p>
            )}
            <div className={styles.forms}>
              <SignIn store={store} />
              <CreateMember store={store} />
            </div>
          </>
        )}
        {state.status === "member" && <MemberSection store={store} state={state} />}
      </div>
    </div>
  );
}
