import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { account, useAccount, type AccountStore } from "../../account/store";
import { KeyArt } from "../../components/KeyArt";
import { EDITION_BRAND } from "../../components/brand";
import {
  LADDER_SKU,
  LadderClient,
  type LadderRecord,
  type Leaderboard,
  type PlayerProfile,
  type Season,
} from "../../ladder/api";
import { chevrons, rankTitle } from "../../ladder/ranks";
import type { GameId } from "../../storage/install";
import type { GameRecord } from "../../storage/manifest";
import styles from "./LadderScreen.module.css";
import page from "./Page.module.css";

/** One request is at most this many records (the server's cap). */
const TOP = 100;

const GAMES: GameId[] = ["ra2", "ra2md"];

type Loader<T> = (signal: AbortSignal) => Promise<T>;
type Load<T> = { status: "loading" } | { status: "error" } | { status: "ready"; data: T };

/**
 * Runs `load` when its identity (or `again`, a retry counter) changes and gives the answer for the
 * current one only, so a slower answer for an earlier choice never shows. `null` runs nothing.
 */
function useLoad<T>(load: Loader<T> | null, again = 0): Load<T> | null {
  const [state, setState] = useState<{
    for: Loader<T>;
    again: number;
    value: Load<T>;
  } | null>(null);
  useEffect(() => {
    if (!load) return;
    const controller = new AbortController();
    load(controller.signal).then(
      (data) => setState({ for: load, again, value: { status: "ready", data } }),
      () => {
        if (!controller.signal.aborted) setState({ for: load, again, value: { status: "error" } });
      },
    );
    return () => controller.abort();
  }, [load, again]);
  if (!load) return null;
  return state?.for === load && state.again === again ? state.value : { status: "loading" };
}

const number = new Intl.NumberFormat("en-US");

export function winRate(wins: number, losses: number): string {
  const games = wins + losses;
  return games === 0 ? "—" : `${Math.round((wins / games) * 100)}%`;
}

/** The rank insignia: chevrons for the badge, a dash before a first ranked finish. */
export function RankIcon({ badge, large }: { badge: number | null; large?: boolean }) {
  const count = chevrons(badge);
  const first = 10 - (4 + (count - 1) * 4.5) / 2 + 4;
  const d = Array.from({ length: count }, (_, i) => `M4 ${first + i * 4.5}l6-4 6 4`).join("");
  return (
    <span
      aria-hidden="true"
      className={large ? styles.insigniaLarge : styles.insignia}
      data-unranked={badge === null || undefined}
    >
      <svg
        width={large ? 44 : 14}
        height={large ? 44 : 14}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={large ? 2 : 2.4}
      >
        {count === 0 ? <path d="M6 10h8" /> : <path d={d} />}
      </svg>
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

/** The last ten games as win / loss blocks, newest first. */
export function Form({ games }: { games: PlayerProfile["games"] }) {
  const last = games.slice(0, 10);
  const wins = last.filter((game) => game.won).length;
  const draws = last.filter((game) => !game.won && game.resultType === 2).length;
  const losses = last.length - wins - draws;
  const label =
    `${wins} ${wins === 1 ? "win" : "wins"}, ${losses} ${losses === 1 ? "loss" : "losses"}` +
    (draws ? `, ${draws} ${draws === 1 ? "draw" : "draws"}` : "");
  return (
    <div className={styles.form}>
      <span className={styles.statLabel}>
        LAST 10 MATCHES <span className={styles.aside}>newest first</span>
      </span>
      {last.length === 0 ? (
        <p className={page.status}>No ranked matches yet.</p>
      ) : (
        <div role="img" aria-label={label} className={styles.blocks}>
          {last.map((game) => (
            <span
              key={game.gameId}
              data-result={game.won ? "win" : game.resultType === 2 ? "draw" : "loss"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProfilePanel({
  store,
  nick,
  profile,
}: {
  store: AccountStore;
  nick: string;
  profile: Load<PlayerProfile | null> | null;
}) {
  const data = profile?.status === "ready" ? profile.data : null;
  const name = data?.name ?? nick;
  const badge = data?.ranked ? data.badge : null;
  return (
    <section className={styles.profile} aria-label="Your profile">
      <div className={styles.who}>
        <RankIcon badge={badge} large />
        <div className={styles.whoText}>
          <h2 className={styles.name}>{name}</h2>
          <span className={styles.title}>{rankTitle(badge).toUpperCase()}</span>
        </div>
      </div>
      {profile?.status === "error" && (
        <p className={page.failure} role="alert">
          Your rank cannot be loaded.
        </p>
      )}
      {(!profile || profile.status === "loading") && (
        <p className={page.status} role="status">
          Loading your rank…
        </p>
      )}
      {profile?.status === "ready" && (
        <>
          {data ? (
            <div className={styles.stats}>
              <Stat label="RATING" value={number.format(data.rating)} />
              <Stat label="RANK" value={data.rank ? `#${number.format(data.rank)}` : "—"} />
              <Stat label="WINS – LOSSES" value={`${data.wins} – ${data.losses}`} />
              <Stat label="WIN RATE" value={winRate(data.wins, data.losses)} />
            </div>
          ) : (
            <p className={page.status}>No ranked season is running yet.</p>
          )}
          {data && !data.ranked && (
            <p className={page.status}>
              {data.placementMatchesLeft > 0
                ? `Play ${data.placementMatchesLeft} more ranked ${data.placementMatchesLeft === 1 ? "match" : "matches"} to get a rank.`
                : "Play a ranked match to get a rank."}
            </p>
          )}
          {data && <Form games={data.games} />}
        </>
      )}
      <div className={styles.actions}>
        <Link to="/account" className={page.quiet}>
          EDIT PROFILE
        </Link>
        <button
          type="button"
          className={page.quiet}
          onClick={() => void store.signOut().catch(() => {})}
        >
          SIGN OUT
        </button>
      </div>
    </section>
  );
}

function GuestPanel({ checking, hasMember }: { checking: boolean; hasMember: boolean }) {
  return (
    <section className={styles.profile} aria-label="Your profile">
      <h2 className={styles.label}>YOUR PROFILE</h2>
      {checking ? (
        <p className={page.status} role="status">
          Checking your session…
        </p>
      ) : (
        <>
          <p className={page.status}>
            {hasMember
              ? "Add a game name to your account to see your rank."
              : "Sign in to see your rank."}
          </p>
          <Link to="/account" className={page.outline}>
            {hasMember ? "ADD A GAME NAME" : "SIGN IN"}
          </Link>
        </>
      )}
    </section>
  );
}

function Row({ record, me }: { record: LadderRecord; me: boolean }) {
  return (
    <tr data-me={me || undefined} aria-current={me ? "true" : undefined}>
      <td className={styles.rankCell} data-podium={record.rank <= 3 ? record.rank : undefined}>
        {record.rank}
      </td>
      <td>
        <span className={styles.commander}>
          <RankIcon badge={record.badge} />
          <span className={styles.commanderName}>{record.name}</span>
          <span className={page.visuallyHidden}>, {rankTitle(record.badge)}</span>
        </span>
      </td>
      <td className={styles.num}>{number.format(record.rating)}</td>
      <td className={`${styles.num} ${styles.muted}`}>
        {record.wins} – {record.losses}
      </td>
      <td className={styles.num}>{winRate(record.wins, record.losses)}</td>
    </tr>
  );
}

function Table({
  board,
  around,
  nick,
}: {
  board: Leaderboard;
  around: LadderRecord[];
  nick: string | undefined;
}) {
  const mine = nick?.toLowerCase();
  const last = board.records[board.records.length - 1]?.rank ?? 0;
  const rest = around.filter((record) => record.rank > last);
  const gap = rest.length > 0 && rest[0]!.rank > last + 1;
  return (
    <div className={styles.tableBox}>
      <table className={styles.table}>
        <caption className={page.visuallyHidden}>
          {board.season}: the ranked 1v1 ladder, best rating first
        </caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">COMMANDER</th>
            <th scope="col" className={styles.num}>
              RATING
            </th>
            <th scope="col" className={styles.num}>
              W – L
            </th>
            <th scope="col" className={styles.num}>
              WIN %
            </th>
          </tr>
        </thead>
        <tbody>
          {board.records.map((record) => (
            <Row key={record.rank} record={record} me={record.name.toLowerCase() === mine} />
          ))}
          {gap && (
            <tr aria-hidden="true" className={styles.gap}>
              <td colSpan={5}>···</td>
            </tr>
          )}
          {rest.map((record) => (
            <Row key={record.rank} record={record} me={record.name.toLowerCase() === mine} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function seasonLabel(season: Season): string {
  return season.slug === "current" ? `${season.name} (current)` : season.name;
}

const CURRENT_FALLBACK = (sku: number): Season => ({
  id: 0,
  sku,
  name: "Current season",
  slug: "current",
  status: "running",
  startTime: 0,
  endTime: 0,
});

/**
 * `/ladder`: the ranked 1v1 table of an edition (the server's public `/leaderboard`), the season
 * to read, and the signed-in player's own standing (their first game account's `/players` profile).
 * The server has no all-time table, so the period control is a season picker.
 */
export function LadderScreen({
  edition,
  store = account,
  fetch: fetcher,
  baseUrl,
}: {
  /** the edition chosen in the rail: the one shown first */
  edition: GameRecord | null;
  store?: AccountStore;
  fetch?: typeof fetch;
  baseUrl?: string;
}) {
  const state = useAccount(store);
  const nick = state.status === "member" ? state.gameAccounts[0]?.username : undefined;
  const client = useMemo(
    () =>
      new LadderClient({
        ...(fetcher ? { fetch: fetcher } : {}),
        ...(baseUrl ? { baseUrl } : {}),
      }),
    [fetcher, baseUrl],
  );

  const railGame: GameId = edition?.id ?? "ra2md";
  const [choice, setChoice] = useState<{ rail: GameId; game: GameId; season: string }>({
    rail: railGame,
    game: railGame,
    season: "current",
  });
  // choosing another edition in the rail moves the ladder with it
  let { game, season } = choice;
  if (choice.rail !== railGame) {
    game = railGame;
    season = "current";
    setChoice({ rail: railGame, game, season });
  }
  const [attempt, setAttempt] = useState(0);
  const sku = LADDER_SKU[game];

  const loadSeasons = useCallback<Loader<Season[]>>(
    (signal) => client.seasons(sku, signal),
    [client, sku],
  );
  const seasons = useLoad(loadSeasons);
  const seasonList = seasons?.status === "ready" ? seasons.data : [];

  const loadBoard = useCallback<Loader<Leaderboard | null>>(
    (signal) => client.leaderboard(sku, season, 1, TOP, signal),
    [client, sku, season],
  );
  // TRY AGAIN loads it again
  const board = useLoad(loadBoard, attempt);

  const loadProfile = useMemo<Loader<PlayerProfile | null> | null>(
    () => (nick ? (signal) => client.profile(nick, sku, signal) : null),
    [client, nick, sku],
  );
  const profile = useLoad(loadProfile);

  // A player below the first hundred: the three around them are fetched too, like the mockup's gap.
  const rank = profile?.status === "ready" ? profile.data?.rank : null;
  const seasonId = profile?.status === "ready" ? profile.data?.seasonId : null;
  const boardData = board?.status === "ready" ? board.data : null;
  const needsWindow =
    !!rank &&
    !!boardData &&
    boardData.totalCount > boardData.records.length &&
    rank > boardData.records.length &&
    boardData.seasonId === seasonId;
  const loadAround = useMemo<Loader<Leaderboard | null> | null>(
    () =>
      needsWindow && rank
        ? (signal) => client.leaderboard(sku, season, Math.max(1, rank - 1), 3, signal)
        : null,
    [needsWindow, client, sku, season, rank],
  );
  const around = useLoad(loadAround);

  const options = seasonList.some((entry) => entry.slug === season)
    ? seasonList
    : [CURRENT_FALLBACK(sku), ...seasonList];

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <KeyArt edition={game} dim={0.82} />
      <div className={`${page.page} ${styles.page}`}>
        {state.status === "member" && nick ? (
          <ProfilePanel store={store} nick={nick} profile={profile} />
        ) : (
          <GuestPanel checking={state.status === "unknown"} hasMember={state.status === "member"} />
        )}

        <section className={styles.ladder} aria-label="Ladder">
          <div className={styles.head}>
            <h1 className={page.title}>LADDER</h1>
            <div className={styles.controls}>
              <div role="radiogroup" aria-label="Game" className={styles.segmented}>
                {GAMES.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={id === game}
                    className={styles.segment}
                    onClick={() => setChoice({ ...choice, game: id, season: "current" })}
                  >
                    {EDITION_BRAND[id].title.toUpperCase()}
                  </button>
                ))}
              </div>
              <label className={styles.season}>
                <span className={page.visuallyHidden}>Season</span>
                <select
                  value={season}
                  onChange={(event) => setChoice({ ...choice, season: event.target.value })}
                >
                  {options.map((entry) => (
                    <option key={entry.slug} value={entry.slug}>
                      {seasonLabel(entry)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {(!board || board.status === "loading") && (
            <p className={page.status} role="status">
              Loading the ladder…
            </p>
          )}
          {board?.status === "error" && (
            <div className={page.panel}>
              <p className={page.failure} role="alert">
                The ladder cannot be reached. Check your connection and try again.
              </p>
              <div>
                <button
                  type="button"
                  className={page.outline}
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  TRY AGAIN
                </button>
              </div>
            </div>
          )}
          {board?.status === "ready" &&
            (board.data && board.data.records.length > 0 ? (
              <>
                <Table
                  board={board.data}
                  around={around?.status === "ready" ? (around.data?.records ?? []) : []}
                  nick={nick}
                />
                {board.data.totalCount > board.data.records.length && (
                  <p className={page.status}>
                    Showing the top {board.data.records.length} of{" "}
                    {number.format(board.data.totalCount)} ranked players.
                  </p>
                )}
              </>
            ) : (
              <div className={page.panel}>
                <p className={page.status}>
                  No ranked players this season yet. Finish the placement matches of a ranked Quick
                  Match to appear here.
                </p>
              </div>
            ))}
        </section>
      </div>
    </div>
  );
}
