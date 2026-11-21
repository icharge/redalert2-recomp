/**
 * The game's ladder and high-score requests (WOLAPI INetUtil::RequestLadderList,
 * RequestLadderSearch, RequestHighscore), answered from RA2Web's ladder routes
 * (`docs/ranked-ladder.md`, ra2web). The shim in `src/web/wolapi.c` asks through the chat
 * socket's raw-line hook with `@ladder ...` lines and takes the answer as an
 * `@wolapi ladder ...` line; see docs/wol/handoff-wolapi.md ("Ladder and high-score
 * records") for both formats and the native record layouts.
 */

const E_FAIL = 0x80004005;

/** One record in the form the shim copies into the game's Ladder / Highscore structs. */
export interface LadderRecord {
  name: string;
  /** Place on the ladder (1 is the best); the game sorts and draws the digits from it. */
  rank: number;
  points: number;
  wins: number;
  losses: number;
  disconnects: number;
  /** The points the game's badge table reads (Private 0 ... Commander in Chief 2001). */
  badgePoints: number;
}

/** What the server's `listsearch` answers for one player; a player still placing has no rank. */
interface ProfileWire {
  name?: unknown;
  rank?: unknown;
  points?: unknown;
  wins?: unknown;
  losses?: unknown;
  disconnects?: unknown;
  badgePoints?: unknown;
  rankType?: unknown;
  placementMatchesLeft?: unknown;
}

const BADGE_POINTS_BY_RANK_TYPE = [0, 32, 201, 401, 601, 801, 1001, 1201, 1501, 2001];

function count(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : fallback;
}

/** A placed player's record, or null for one that is still placing (the game shows no rank then). */
export function recordFromProfile(profile: ProfileWire): LadderRecord | null {
  if (typeof profile.name !== "string" || !profile.name) return null;
  const rank = count(profile.rank, 0);
  if (!rank) return null;
  const rankType = count(profile.rankType, 1);
  return {
    name: profile.name,
    rank,
    points: count(profile.points),
    wins: count(profile.wins),
    losses: count(profile.losses),
    disconnects: count(profile.disconnects),
    badgePoints: count(
      profile.badgePoints,
      BADGE_POINTS_BY_RANK_TYPE[Math.min(Math.max(rankType, 1), 10) - 1] ?? 0,
    ),
  };
}

/** A `rungsearch` row (standings carry no badge or disconnect fields). */
export function recordFromRung(row: ProfileWire): LadderRecord | null {
  return recordFromProfile({ ...row, placementMatchesLeft: 0 });
}

function token(record: LadderRecord): string {
  const name = record.name.replace(/[\s|]/g, "_");
  return [
    name,
    record.rank,
    record.points,
    record.wins,
    record.losses,
    record.disconnects,
    record.badgePoints,
  ].join("|");
}

export type LadderKind = "list" | "score" | "search" | "self";

/**
 * The line the shim reads: `@wolapi ladder <kind> <id> <status> <total> <keyRung> <records...>`.
 * `status` is 0 or an HRESULT in decimal; each record is
 * `name|rank|points|wins|losses|disconnects|badgePoints`.
 */
export function ladderAnswer(
  kind: LadderKind,
  id: number,
  status: number,
  records: readonly LadderRecord[],
  total = records.length,
  keyRung = 0,
): string {
  return [`@wolapi ladder ${kind} ${id} ${status >>> 0} ${total} ${keyRung}`, ...records.map(token)]
    .join(" ")
    .trimEnd();
}

export interface LadderRequest {
  kind: LadderKind;
  id: number;
  sku: number;
  /** list/score: the lower-cased names. search: [key]. */
  names: string[];
  /** search: how many records and how many before the key's own. */
  number: number;
  leading: number;
}

/**
 * `@ladder list <id> <sku> <name,name,...>` and `@ladder score ...` (a high-score request for the
 * same names), `@ladder self <id> <sku> <nick>` (the player's own record, read afresh), `@ladder search <id> <sku> <number> <leading> <key>`; null for anything else.
 */
export function parseLadderRequest(line: string): LadderRequest | null {
  const parts = line.split(" ");
  if (parts[0] !== "@ladder") return null;
  const kind = parts[1];
  const id = Number(parts[2]);
  const sku = Number(parts[3]);
  if (!Number.isInteger(id) || !Number.isInteger(sku)) return null;
  if (kind === "list" || kind === "score" || kind === "self") {
    const names = (parts[4] ?? "").split(",").filter(Boolean).slice(0, 64);
    return { kind, id, sku, names, number: 0, leading: 0 };
  }
  if (kind === "search") {
    const number = Number(parts[4]);
    const leading = Number(parts[5]);
    if (!Number.isInteger(number) || !Number.isInteger(leading)) return null;
    return { kind, id, sku, names: parts[6] ? [parts[6]] : [], number, leading };
  }
  return null;
}

interface CacheEntry {
  at: number;
  record: LadderRecord | null;
}

const CACHE_MS = 20_000;
const SEASON = "current";
const LADDER_TYPE = "1v1";

/**
 * Looks the game's requests up on the ladder routes. Names are fetched once a batch and kept per
 * season for a short while, so the game's ladder request and its high-score request for the same
 * names, and a lobby that lists a name again, cost one round trip. `fresh()` drops the cache: the
 * player's own record is read again after a scored match.
 */
export class LadderLookup {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly httpUrl: string,
    private readonly fetcher: typeof fetch,
    private readonly timeoutMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  fresh(): void {
    this.cache.clear();
  }

  /** The answer line for a request; never throws. */
  async answer(request: LadderRequest): Promise<string> {
    try {
      if (request.kind === "search") return await this.search(request);
      if (request.kind === "self") this.fresh();
      const records = await this.profiles(request.sku, request.names);
      return ladderAnswer(request.kind, request.id, 0, records);
    } catch {
      return ladderAnswer(request.kind, request.id, E_FAIL, []);
    }
  }

  private url(sku: number, action: string): URL {
    const base = this.httpUrl.endsWith("/") ? this.httpUrl : `${this.httpUrl}/`;
    return new URL(`ladder/${sku}/${LADDER_TYPE}/${SEASON}/${action}`, base);
  }

  private async post(
    url: URL,
    body: unknown,
  ): Promise<unknown[] | { records?: unknown[]; totalCount?: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    // Called as a plain function: the browser's fetch throws "Illegal invocation" otherwise.
    const fetcher = this.fetcher;
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // 404: no such season/ladder, or nobody placed yet. The game takes that as an empty ladder.
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`ladder request failed (${response.status})`);
      return (await response.json()) as never;
    } finally {
      clearTimeout(timer);
    }
  }

  private async profiles(sku: number, names: readonly string[]): Promise<LadderRecord[]> {
    const now = this.now();
    const key = (name: string) => `${sku}/${SEASON}/${name.toLowerCase()}`;
    const missing = [
      ...new Set(
        names.filter((name) => {
          const hit = this.cache.get(key(name));
          return !hit || now - hit.at > CACHE_MS;
        }),
      ),
    ];
    if (missing.length) {
      const profiles = (await this.post(this.url(sku, "listsearch"), {
        players: missing,
        locale: "en",
      })) as ProfileWire[];
      const byName = new Map<string, LadderRecord | null>();
      for (const profile of Array.isArray(profiles) ? profiles : []) {
        if (typeof profile?.name === "string")
          byName.set(profile.name.toLowerCase(), recordFromProfile(profile));
      }
      for (const name of missing) {
        this.cache.set(key(name), { at: now, record: byName.get(name.toLowerCase()) ?? null });
      }
    }
    const records: LadderRecord[] = [];
    for (const name of names) {
      const record = this.cache.get(key(name))?.record;
      if (record) records.push(record);
    }
    return records;
  }

  /** The records around `key`'s place: `leading` above it and `number` in all; the key's own rank is `keyRung`. */
  private async search(request: LadderRequest): Promise<string> {
    const key = request.names[0] ?? "";
    let keyRung = 0;
    if (key) {
      keyRung = (await this.profiles(request.sku, [key]))[0]?.rank ?? 0;
      if (!keyRung) return ladderAnswer("search", request.id, 0, [], 0, 0);
    }
    const start = Math.max(1, (keyRung || 1) - Math.max(0, request.leading));
    const count = Math.min(100, Math.max(1, request.number));
    const page = (await this.post(this.url(request.sku, "rungsearch"), {
      ladderId: LADDER_TYPE,
      start,
      count,
    })) as { records?: ProfileWire[]; totalCount?: number };
    const rows = Array.isArray(page?.records) ? page.records : [];
    const records = rows.map(recordFromRung).filter((record): record is LadderRecord => !!record);
    return ladderAnswer(
      "search",
      request.id,
      0,
      records,
      typeof page?.totalCount === "number" ? page.totalCount : records.length,
      keyRung,
    );
  }
}

/**
 * Runs the game's requests against a lookup and hands the answers on. The lobby asks for the ladder
 * records and then, in the same call, for the high scores of the same names. The game refills its
 * player list when the ladder records arrive and never when the high scores do, so a high-score
 * answer that follows would not show until a later refill: the high scores are delivered first.
 */
export class LadderSession {
  private held: { key: string; answer: Promise<string> } | null = null;

  constructor(
    private readonly lookup: LadderLookup,
    private readonly deliver: (line: string) => void,
  ) {}

  request(request: LadderRequest): void {
    const key = request.names.join(",");
    const answer = this.lookup.answer(request);
    if (request.kind === "list") {
      const held = { key, answer };
      this.held = held;
      // The high-score request comes in the same call; a list nobody pairs goes out on the next tick.
      setTimeout(() => {
        if (this.held !== held) return;
        this.held = null;
        void answer.then(this.deliver);
      }, 0);
      return;
    }
    const list = request.kind === "score" && this.held?.key === key ? this.held : null;
    if (list) {
      this.held = null;
      void Promise.all([answer, list.answer]).then(([score, ladder]) => {
        this.deliver(score);
        this.deliver(ladder);
      });
      return;
    }
    void answer.then(this.deliver);
  }
}
