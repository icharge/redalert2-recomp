import { Cross2Icon } from "@radix-ui/react-icons";
import { useCallback, useMemo, useState, type FormEvent } from "react";
import { account, useAccount, type AccountStore } from "../account/store";
import {
  FRIENDS_MAX,
  FriendsClient,
  describeFriendsError,
  friendNameProblem,
} from "../friends/api";
import { StatusCell, useFriends } from "../screens/launcher/FriendsScreen";
import styles from "./FriendsTab.module.css";

/** One room, however it is written: the friends list says "#Bob's game", the channel is "Bob's_game". */
export function sameRoom(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = (room: string) => room.replace(/^#/, "").replace(/_/g, " ").toLowerCase();
  return !!a && !!b && key(a) === key(b);
}

/**
 * The FRIENDS tab of the MESSAGES panel: the buddy list of the game name being played (the launcher's
 * FRIENDS page and Yuri's Revenge's Buddy List show the same list), with each friend's whereabouts,
 * an Add box, and for each friend MESSAGE, PROFILE and remove; JOIN for a friend in a game room, and
 * INVITE while this player is in one. Members only: a guest has no name the server keeps a list for.
 */
export function FriendsTab({
  nick,
  onMessage,
  onProfile,
  room = null,
  onJoin,
  onInvite,
  store = account,
}: {
  /** the name being played (the WOL nick), whose list this is */
  nick: string | null;
  onMessage: (name: string) => void;
  onProfile: (name: string) => void;
  /** the game room this player is in (INVITE asks friends into it), or null */
  room?: string | null;
  /** join the game room a friend is in */
  onJoin?: (room: string) => void;
  /** invite a friend into `room` */
  onInvite?: (name: string) => void;
  store?: AccountStore;
}) {
  const state = useAccount(store);
  const client = useMemo(() => new FriendsClient(store.client), [store]);
  const names = useMemo(
    () => (state.status === "member" ? state.gameAccounts.map((entry) => entry.username) : []),
    [state],
  );
  // the list of the name being played, else the member's first
  const who =
    names.find((name) => nick && name.toLowerCase() === nick.toLowerCase()) ?? names[0] ?? null;
  const passAccount = names.length > 1 ? (who ?? undefined) : undefined;
  const friends = useFriends(client, who, passAccount);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const refreshList = friends.refresh;

  const change = useCallback(
    async (run: () => Promise<void>, name?: string): Promise<boolean> => {
      setBusy(true);
      setFailure(null);
      try {
        await run();
        return true;
      } catch (error) {
        setFailure(describeFriendsError(error, name));
        return false;
      } finally {
        setBusy(false);
        void refreshList();
      }
    },
    [refreshList],
  );

  if (state.status !== "member")
    return (
      <p className={styles.note}>
        {state.status === "unknown"
          ? "Checking your session…"
          : "Friends are for members: sign in at the launcher to keep a friends list."}
      </p>
    );

  const problem = friendNameProblem(name.trim());
  const add = async (event: FormEvent) => {
    event.preventDefault();
    const wanted = name.trim();
    if (!wanted || problem) return;
    if (await change(() => client.add(wanted, passAccount), wanted)) setName("");
  };

  const value = friends.value;
  const list = value?.status === "ready" ? value.friends : [];
  return (
    <div className={styles.tab}>
      <form className={styles.add} onSubmit={(event) => void add(event)}>
        <input
          className={styles.field}
          aria-label="Add a friend"
          placeholder="Game name"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={name}
          maxLength={9}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="submit"
          className={styles.small}
          disabled={busy || !name.trim() || !!problem || list.length >= FRIENDS_MAX}
        >
          ADD
        </button>
      </form>
      {(problem || failure) && (
        <p className={styles.error} role="alert">
          {problem ?? failure}
        </p>
      )}
      {(!value || value.status === "loading") && (
        <p className={styles.note} role="status">
          Loading your friends…
        </p>
      )}
      {value?.status === "error" && (
        <p className={styles.error} role="alert">
          {describeFriendsError(value.error)}{" "}
          <button type="button" className={styles.link} onClick={friends.retry}>
            Try again
          </button>
        </p>
      )}
      {value?.status === "ready" && list.length === 0 && (
        <p className={styles.note}>No friends yet. Add one by their game name.</p>
      )}
      {list.length > 0 && (
        <ul className={styles.list} aria-label={`Friends of ${who}`}>
          {list.map((friend) => (
            <li key={friend.name.toLowerCase()} className={styles.row}>
              <span className={styles.name} dir="auto">
                {friend.name}
              </span>
              <StatusCell friend={friend} />
              <span className={styles.actions}>
                <button
                  type="button"
                  className={styles.small}
                  onClick={() => onMessage(friend.name)}
                >
                  MESSAGE
                </button>
                <button
                  type="button"
                  className={styles.small}
                  onClick={() => onProfile(friend.name)}
                >
                  PROFILE
                </button>
                {onJoin &&
                  friend.status === "game" &&
                  friend.room &&
                  !sameRoom(friend.room, room) && (
                    <button
                      type="button"
                      className={styles.small}
                      title={`Join ${friend.room}`}
                      onClick={() => onJoin(friend.room!)}
                    >
                      JOIN
                    </button>
                  )}
                {onInvite &&
                  room &&
                  friend.status !== "offline" &&
                  !sameRoom(friend.room, room) && (
                    <button
                      type="button"
                      className={styles.small}
                      title={`Invite to ${room}`}
                      onClick={() => onInvite(friend.name)}
                    >
                      INVITE
                    </button>
                  )}
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`Remove ${friend.name}`}
                  title="Remove from friends"
                  disabled={busy}
                  onClick={() => void change(() => client.remove(friend.name, passAccount))}
                >
                  <Cross2Icon aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Adds `name` to the friends list of the name being played (as the FRIENDS tab does), for the player
 * menu of the lobby: what to tell the player, in a line.
 */
export async function addFriendFor(
  nick: string | null,
  name: string,
  store: AccountStore = account,
): Promise<string> {
  const state = store.getState();
  if (state.status !== "member") return "Friends are for members: sign in at the launcher.";
  const names = state.gameAccounts.map((entry) => entry.username);
  const who =
    names.find((entry) => nick && entry.toLowerCase() === nick.toLowerCase()) ?? names[0] ?? null;
  if (!who) return "Add a game name at the launcher to keep friends.";
  try {
    await new FriendsClient(store.client).add(name, names.length > 1 ? who : undefined);
    return `${name} is now on your friends list.`;
  } catch (error) {
    return describeFriendsError(error, name);
  }
}
