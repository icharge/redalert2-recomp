import { useEffect, useMemo, useState } from "react";
import { LadderClient, type PlayerProfile as Profile } from "../ladder/api";
import { rankTitle } from "../ladder/ranks";
import { Form, RankIcon, Stat, winRate } from "../screens/launcher/LadderScreen";
import ladder from "../screens/launcher/LadderScreen.module.css";
import styles from "./PlayerProfile.module.css";

type Load =
  { status: "loading" } | { status: "error" } | { status: "ready"; profile: Profile | null };

const number = new Intl.NumberFormat("en-US");

/**
 * A player's ladder profile for one game (`GET /players`, the launcher's LADDER page has the same):
 * rank insignia and title, rating, rank, wins and losses, win rate and the last ten ranked matches.
 * Shown inside the MESSAGES panel for a friend or the player a conversation is with.
 */
export function PlayerProfile({
  name,
  sku,
  client,
}: {
  name: string;
  /** the game's ladder (LADDER_SKU) */
  sku: number;
  client?: LadderClient;
}) {
  const ladderClient = useMemo(() => client ?? new LadderClient({}), [client]);
  const [load, setLoad] = useState<{ name: string; value: Load } | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    ladderClient
      .profile(name, sku, abort.signal)
      .then((profile) => setLoad({ name, value: { status: "ready", profile } }))
      .catch(() => {
        if (!abort.signal.aborted) setLoad({ name, value: { status: "error" } });
      });
    return () => abort.abort();
  }, [ladderClient, name, sku]);

  const value: Load = load?.name === name ? load.value : { status: "loading" };
  const data = value.status === "ready" ? value.profile : null;
  const badge = data?.ranked ? data.badge : null;
  return (
    <section className={styles.profile} aria-label={`Profile of ${name}`}>
      <div className={ladder.who}>
        <RankIcon badge={badge} large />
        <div className={ladder.whoText}>
          <h3 className={ladder.name} dir="auto">
            {data?.name ?? name}
          </h3>
          <span className={ladder.title}>{rankTitle(badge).toUpperCase()}</span>
        </div>
      </div>
      {value.status === "loading" && (
        <p className={styles.note} role="status">
          Loading the profile…
        </p>
      )}
      {value.status === "error" && (
        <p className={styles.note} role="alert">
          The profile cannot be loaded right now.
        </p>
      )}
      {value.status === "ready" && !data && (
        <p className={styles.note}>No ranked profile for {name} in this game yet.</p>
      )}
      {data && (
        <>
          <div className={ladder.stats}>
            <Stat label="RATING" value={number.format(data.rating)} />
            <Stat label="RANK" value={data.rank ? `#${number.format(data.rank)}` : "—"} />
            <Stat label="WINS – LOSSES" value={`${data.wins} – ${data.losses}`} />
            <Stat label="WIN RATE" value={winRate(data.wins, data.losses)} />
          </div>
          {!data.ranked && (
            <p className={styles.note}>
              {data.placementMatchesLeft > 0
                ? `${data.placementMatchesLeft} placement ${data.placementMatchesLeft === 1 ? "match" : "matches"} left before a rank.`
                : "No rank yet."}
            </p>
          )}
          <Form games={data.games} />
        </>
      )}
    </section>
  );
}
