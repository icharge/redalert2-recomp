/**
 * The launcher's client for the ladder's public routes on the operator's WOL HTTP server
 * (`ra2web/server/src/http/routes.ts`, "Shared ranked views"). No sign-in is needed to read them,
 * so a request carries no credentials.
 */
import { wolHttpUrl } from "../account/api";
import type { GameId } from "../storage/install";

/** The server's ladder SKUs (`KNOWN_SKUS` in LadderService.ts): the client's own, one per edition. */
export const LADDER_SKU: Record<GameId, number> = { ra2: 16640, ra2md: 18688 };

/** Only the 1v1 ladder is shown. */
const LADDER = "1v1";

export interface Season {
  id: number;
  sku: number;
  name: string;
  /** `current`, `prev`, or the numeric id: what `/leaderboard` takes as the season. */
  slug: string;
  /** The server's state: `scheduled` (not started, never listed), the running one, or `archived`. */
  status: string;
  startTime: number;
  endTime: number;
}

export interface LadderRecord {
  name: string;
  rank: number;
  rating: number;
  /** The rating plus the win-streak bonus: what the game's own score screen shows. */
  points: number;
  /** 0 to 9, the rank insignia (`ranks.ts`); null before a first ranked finish. */
  badge: number | null;
  wins: number;
  losses: number;
  draws: number;
}

export interface Leaderboard {
  seasonId: number;
  season: string;
  archived: boolean;
  records: LadderRecord[];
  totalCount: number;
}

export interface PlayerGame {
  gameId: string;
  /** Epoch seconds. */
  ended: number;
  won: boolean;
  /** 0 win, 1 loss, 2 draw. */
  resultType: number;
}

export interface PlayerProfile {
  name: string;
  seasonId: number;
  season: string;
  ranked: boolean;
  rank: number | null;
  ratedPlayers: number;
  rating: number;
  badge: number | null;
  wins: number;
  losses: number;
  draws: number;
  placementMatchesLeft: number;
  /** The newest rated games first. */
  games: PlayerGame[];
}

/** The server answered, but not with the table (not a 404: that is an empty ladder). */
export class LadderError extends Error {
  constructor(readonly status: number) {
    super(status === 0 ? "The ladder cannot be reached." : `The ladder answered ${status}.`);
    this.name = "LadderError";
  }
}

export interface LadderClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class LadderClient {
  private readonly base: string;
  private readonly fetcher: typeof fetch;

  constructor(options: LadderClientOptions = {}) {
    const base = options.baseUrl ?? wolHttpUrl();
    this.base = base.endsWith("/") ? base : `${base}/`;
    // a deferred call: tests stub the global after this module loads
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** The JSON at `path`; `null` for a 404 (no such season, no season running yet). */
  private async get<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, this.base), { signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new LadderError(0);
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new LadderError(response.status);
    try {
      return (await response.json()) as T;
    } catch {
      throw new LadderError(response.status);
    }
  }

  /** The seasons that have started, newest first. */
  async seasons(sku: number, signal?: AbortSignal): Promise<Season[]> {
    const body = await this.get<{ seasons: Season[] }>(`seasons?sku=${sku}`, signal);
    return (body?.seasons ?? [])
      .filter((season) => season.status !== "scheduled")
      .sort((a, b) => b.startTime - a.startTime);
  }

  /** `count` records from rank `start` (at most 100 a request); null when the season is unknown. */
  leaderboard(
    sku: number,
    season: string,
    start: number,
    count: number,
    signal?: AbortSignal,
  ): Promise<Leaderboard | null> {
    return this.get<Leaderboard>(
      `leaderboard/${sku}/${LADDER}/${encodeURIComponent(season)}?start=${start}&count=${count}`,
      signal,
    );
  }

  /** A player's standing in the current season; null when no season is running. */
  profile(name: string, sku: number, signal?: AbortSignal): Promise<PlayerProfile | null> {
    return this.get<PlayerProfile>(
      `players/${encodeURIComponent(name)}?sku=${sku}&ladderType=${LADDER}`,
      signal,
    );
  }
}
