import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { account, useAccount, type AccountStore } from "../../account/store";
import { KeyArt } from "../../components/KeyArt";
import {
  FRIENDS_MAX,
  FriendsClient,
  NAME_MAX,
  describeFriendsError,
  friendNameProblem,
  type Friend,
  type FriendStatus,
} from "../../friends/api";
import type { GameId } from "../../storage/install";
import type { GameRecord } from "../../storage/manifest";
import c from "./ClanScreen.module.css";
import f from "./FriendsScreen.module.css";
import ladder from "./LadderScreen.module.css";
import page from "./Page.module.css";

/** The list is read again this often while the page is on screen. */
export const REFRESH_MS = 30_000;

type Load =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; friends: Friend[]; stale?: unknown };

/**
 * The buddy list of one game name, read when the name changes, every `REFRESH_MS` while the page
 * is visible, when the page comes back to the front, and on `refresh`. A read that fails after a
 * good one keeps the list on screen (`stale` says why it is old); an answer to an older read never
 * replaces a newer one.
 */
function useFriends(client: FriendsClient, who: string | null, passAccount: string | undefined) {
  const [load, setLoad] = useState<{ key: string; value: Load } | null>(null);
  const latest = useRef(0);
  const key = who ?? "";

  const refresh = useCallback(async () => {
    if (!who) return;
    const mine = ++latest.current;
    try {
      const friends = await client.list(passAccount);
      if (mine === latest.current) setLoad({ key, value: { status: "ready", friends } });
    } catch (error) {
      if (mine !== latest.current) return;
      setLoad((was) =>
        was?.key === key && was.value.status === "ready"
          ? { key, value: { ...was.value, stale: error } }
          : { key, value: { status: "error", error } },
      );
    }
  }, [client, who, passAccount, key]);

  // an answer still on its way when the page leaves, or the name changes, is not wanted
  const forgetPending = useCallback(() => {
    latest.current++;
  }, []);

  const retry = useCallback(() => {
    setLoad(null);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!who) return;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, REFRESH_MS);
    const shown = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", shown);
    return () => {
      forgetPending();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [refresh, forgetPending, who]);

  const value: Load | null = !who ? null : load?.key === key ? load.value : { status: "loading" };
  return { value, refresh, retry };
}

const STATUS_TEXT: Record<FriendStatus, string> = {
  offline: "Offline",
  lobby: "In the lobby",
  game: "In a game",
  online: "Online",
  hidden: "Hidden",
};

function StatusCell({ friend }: { friend: Friend }) {
  // a status this launcher does not know is shown as offline rather than as nothing
  const status: FriendStatus = friend.status in STATUS_TEXT ? friend.status : "offline";
  // A chat lobby's key ("#Lob 41 0") means nothing to a player; a game room's name does.
  const withRoom =
    (status === "lobby" || status === "game") &&
    !!friend.room &&
    !/^#?Lob[ _]\d/i.test(friend.room);
  return (
    <span className={f.status}>
      <span className={f.dot} data-status={status} aria-hidden="true" />
      <span className={f.statusText} data-status={status}>
        {STATUS_TEXT[status]}
        {withRoom && <span className={f.room}> · {friend.room}</span>}
      </span>
    </span>
  );
}

function FriendsTable({
  friends,
  asked,
  busy,
  onAsk,
  onCancel,
  onRemove,
}: {
  friends: Friend[];
  asked: string | null;
  busy: boolean;
  onAsk: (name: string) => void;
  onCancel: () => void;
  onRemove: (name: string) => void;
}) {
  return (
    <div className={ladder.tableBox}>
      <table className={ladder.table}>
        <caption className={page.visuallyHidden}>Your friends</caption>
        <thead>
          <tr>
            <th scope="col">PLAYER</th>
            <th scope="col">STATUS</th>
            <th scope="col">
              <span className={page.visuallyHidden}>ACTIONS</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {friends.map((friend) => (
            <tr key={friend.name}>
              <td className={c.nickCell}>
                <span className={ladder.commanderName}>{friend.name}</span>
              </td>
              <td>
                <StatusCell friend={friend} />
              </td>
              <td>
                {asked === friend.name ? (
                  <span className={c.ask} role="group" aria-label="Confirm remove">
                    <span>Remove {friend.name}?</span>
                    <button
                      type="button"
                      className={`${c.small} ${c.danger}`}
                      disabled={busy}
                      onClick={() => onRemove(friend.name)}
                    >
                      YES, REMOVE
                    </button>
                    <button type="button" className={c.small} onClick={onCancel}>
                      CANCEL
                    </button>
                  </span>
                ) : (
                  <span className={c.rowActions}>
                    <button
                      type="button"
                      className={c.small}
                      disabled={busy}
                      aria-label={`Remove ${friend.name}`}
                      onClick={() => onAsk(friend.name)}
                    >
                      REMOVE
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddForm({
  friends,
  own,
  busy,
  failure,
  onAdd,
  onEdit,
}: {
  friends: Friend[] | null;
  /** the member's own game names: nobody befriends themselves */
  own: string[];
  busy: boolean;
  failure: string | null;
  onAdd: (name: string) => Promise<boolean>;
  onEdit: () => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const name = text.trim();
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const problem =
    friendNameProblem(name) ??
    (own.some((mine) => same(mine, name)) ? "You cannot add yourself." : null) ??
    (friends?.some((friend) => same(friend.name, name)) ? `${name} is already a friend.` : null);
  const full = (friends?.length ?? 0) >= FRIENDS_MAX;
  const ready = name !== "" && !problem && !full;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (ready && (await onAdd(name))) setText("");
  };
  return (
    <form className={c.form} onSubmit={(event) => void submit(event)} noValidate>
      <div className={c.field}>
        <label htmlFor={id} className={c.fieldLabel}>
          ADD A FRIEND
        </label>
        <div className={f.addRow}>
          <input
            id={id}
            className={c.input}
            placeholder="Game name"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-note`}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              onEdit();
            }}
          />
          <button type="submit" className={page.outline} disabled={!ready || busy}>
            ADD
          </button>
        </div>
        <span id={`${id}-note`} className={problem ? c.problem : c.hint}>
          {problem ??
            (full
              ? `The list is full (${FRIENDS_MAX} friends). Remove one to add another.`
              : `The name of a player's game account, up to ${NAME_MAX} characters.`)}
        </span>
      </div>
      {failure && (
        <p className={page.failure} role="alert">
          {failure}
        </p>
      )}
    </form>
  );
}

function Backdrop({ edition, children }: { edition: GameRecord | null; children: ReactNode }) {
  const game: GameId = edition?.id ?? "ra2md";
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <KeyArt edition={game} dim={0.82} />
      <div className={`${page.page} ${ladder.page}`}>{children}</div>
    </div>
  );
}

/** The left panel: what the page is, and (for someone who cannot keep a list yet) why and where to fix it. */
function Side({ picker, children }: { picker?: ReactNode; children?: ReactNode }) {
  return (
    <section className={ladder.profile} aria-label="Your friends">
      <h2 className={ladder.label}>YOUR FRIENDS</h2>
      {picker}
      {children}
    </section>
  );
}

function Title({ children }: { children?: ReactNode }) {
  return (
    <section className={ladder.ladder} aria-label="Friends">
      <div className={ladder.head}>
        <h1 className={page.title}>FRIENDS</h1>
      </div>
      {children}
    </section>
  );
}

export interface FriendsScreenProps {
  /** the edition chosen in the rail: its art is the background */
  edition: GameRecord | null;
  store?: AccountStore;
}

/**
 * `/friends`: the buddy list of the signed-in player's game name (members only; a guest has no
 * name the server keeps a list for). It is the list Yuri's Revenge shows as its Buddy List.
 */
export function FriendsScreen({ edition, store = account }: FriendsScreenProps) {
  const state = useAccount(store);
  const client = useMemo(() => new FriendsClient(store.client), [store]);
  const names = useMemo(
    () => (state.status === "member" ? state.gameAccounts.map((entry) => entry.username) : []),
    [state],
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const nick = names.find((name) => name === chosen) ?? names[0] ?? null;
  // with several game names the server wants to be told which one
  const passAccount = names.length > 1 ? (nick ?? undefined) : undefined;
  const friends = useFriends(client, nick, passAccount);

  const [asked, setAsked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const refreshList = friends.refresh;
  const change = useCallback(
    async (run: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      setFailure(null);
      try {
        await run();
        return true;
      } catch (error) {
        setFailure(describeFriendsError(error));
        return false;
      } finally {
        setBusy(false);
        // either way show what is true now (the list may have changed in the game meanwhile)
        void refreshList();
      }
    },
    [refreshList],
  );

  if (state.status !== "member") {
    return (
      <Backdrop edition={edition}>
        <Side>
          {state.status === "unknown" ? (
            <p className={page.status} role="status">
              Checking your session…
            </p>
          ) : state.status === "offline" ? (
            <p className={page.failure} role="alert">
              The online service cannot be reached, so friends are not available right now.
            </p>
          ) : (
            <>
              <p className={page.status}>
                Friends are for members. Sign in with your member account to keep a list of the
                players you want to find online. Guests do not have a friends list.
              </p>
              <Link to="/account" className={page.outline}>
                SIGN IN
              </Link>
            </>
          )}
        </Side>
        <Title />
      </Backdrop>
    );
  }

  if (!nick) {
    return (
      <Backdrop edition={edition}>
        <Side>
          <p className={page.status}>
            A friends list belongs to a game name. Add a game name to your account first.
          </p>
          <Link to="/account" className={page.outline}>
            ADD A GAME NAME
          </Link>
        </Side>
        <Title />
      </Backdrop>
    );
  }

  const picker =
    names.length > 1 ? (
      <label className={c.picker}>
        <span className={ladder.statLabel}>PLAYING AS</span>
        <select
          value={nick}
          onChange={(event) => {
            setChosen(event.target.value);
            setAsked(null);
            setFailure(null);
          }}
        >
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  const value = friends.value;
  const list = value?.status === "ready" ? value.friends : null;
  return (
    <Backdrop edition={edition}>
      <Side picker={picker}>
        <div className={ladder.stat}>
          <span className={ladder.statLabel}>FRIENDS</span>
          <span className={`${ladder.statValue} ${f.count}`}>
            {list ? `${list.length} / ${FRIENDS_MAX}` : "–"}
          </span>
        </div>
        <AddForm
          key={nick}
          friends={list}
          own={names}
          busy={busy}
          failure={failure}
          onAdd={(name) => change(() => client.add(name, passAccount))}
          onEdit={() => setFailure(null)}
        />
        <p className={page.status}>
          In Yuri’s Revenge this is also your Buddy List: a change in either place shows in both.
        </p>
      </Side>
      <Title>
        <div className={f.toolbar}>
          <button type="button" className={c.small} onClick={() => void friends.refresh()}>
            REFRESH
          </button>
        </div>
        {(!value || value.status === "loading") && (
          <p className={page.status} role="status">
            Loading your friends…
          </p>
        )}
        {value?.status === "error" && (
          <div className={page.panel}>
            <p className={page.failure} role="alert">
              {describeFriendsError(value.error)}
            </p>
            <div>
              <button type="button" className={page.outline} onClick={friends.retry}>
                TRY AGAIN
              </button>
            </div>
          </div>
        )}
        {value?.status === "ready" && value.stale !== undefined && (
          <p className={page.failure} role="alert">
            The list could not be refreshed: {describeFriendsError(value.stale)}
          </p>
        )}
        {list &&
          (list.length === 0 ? (
            <div className={page.panel}>
              <p className={page.status}>
                No friends yet. Type the game name of a player under “Add a friend” to see when they
                are online.
              </p>
            </div>
          ) : (
            <FriendsTable
              friends={list}
              asked={asked}
              busy={busy}
              onAsk={(name) => {
                setFailure(null);
                setAsked(name);
              }}
              onCancel={() => setAsked(null)}
              onRemove={(name) => {
                setAsked(null);
                void change(() => client.remove(name, passAccount));
              }}
            />
          ))}
      </Title>
    </Backdrop>
  );
}
