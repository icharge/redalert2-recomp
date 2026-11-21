/**
 * The launcher's client for the ra2web clan routes (CL-1; ra2web `docs/clans.md`).
 *
 * Member routes (`/v1/clans/*`) go through the account client's bearer call, so they carry the
 * access token, refresh once on a 401 and raise `AccountError` with the server's `errorCode`.
 * A member with several game accounts names the one to act as: `?account=` on a read, `account`
 * in the body of a change. The public routes (`/clans`, `/clans/{tag}`) need no sign-in.
 */
import { AccountError, describeAccountError, wolHttpUrl, type AccountClient } from "../account/api";

export type ClanRole = "owner" | "officer" | "member";

/** What the server allows. Tag: 2 to 6 of letters, digits, `_` and `-`. Name: 3 to 40 printable ASCII. */
export const TAG_MIN = 2;
export const TAG_MAX = 6;
export const NAME_MIN = 3;
export const NAME_MAX = 40;
/** A clan holds at most this many members. */
export const CLAN_MAX_MEMBERS = 50;

/** Why a tag is not allowed, or null. An empty tag is not a complaint yet (the form is just empty). */
export function tagProblem(tag: string): string | null {
  if (tag === "") return null;
  if (!/^[A-Za-z0-9_-]*$/.test(tag))
    return "A tag uses letters, digits, dashes and underscores only.";
  if (tag.length < TAG_MIN) return `A tag is at least ${TAG_MIN} characters.`;
  if (tag.length > TAG_MAX) return `A tag is at most ${TAG_MAX} characters.`;
  return null;
}

/** Why a name is not allowed, or null. */
export function nameProblem(name: string): string | null {
  if (name === "") return null;
  if (!/^[\x20-\x7e]*$/.test(name)) {
    return "A name uses printable ASCII characters only (no accents or emoji).";
  }
  if (name.startsWith(" ") || name.endsWith(" ")) {
    return "A name cannot start or end with a space.";
  }
  if (name.includes("  ")) return "A name cannot have two spaces in a row.";
  if (name.length < NAME_MIN) return `A name is at least ${NAME_MIN} characters.`;
  if (name.length > NAME_MAX) return `A name is at most ${NAME_MAX} characters.`;
  return null;
}

export interface ClanSummary {
  id: number;
  tag: string;
  name: string;
  /** Epoch milliseconds. */
  createdAt: number;
  memberCount: number;
}

export interface ClanMember {
  nick: string;
  role: ClanRole;
  joinedAt: number;
}

export interface ClanDetail extends ClanSummary {
  members: ClanMember[];
}

/** A waiting invitation to a clan, as an owner or officer sees it. */
export interface SentInvite {
  nick: string;
  createdAt: number;
  expiresAt: number;
}

/** The player's own clan: the detail, their role and (owner or officer) the waiting invitations. */
export interface MyClan extends ClanDetail {
  role: ClanRole;
  invites?: SentInvite[];
}

export interface Mine {
  gameAccount: string;
  clan: MyClan | null;
}

export interface Invite {
  clan: { id: number; tag: string; name: string };
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
}

export interface Search {
  clans: ClanSummary[];
  total: number;
}

export type MemberAction = "kick" | "promote" | "demote" | "transfer";

/** A public route answered something other than the data (not a 404: that is "no such clan"). */
export class ClanError extends Error {
  constructor(readonly status: number) {
    super(status === 0 ? "The clans cannot be reached." : `The clans answered ${status}.`);
    this.name = "ClanError";
  }
}

export interface ClanClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class ClanClient {
  private readonly base: string;
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly accounts: AccountClient,
    options: ClanClientOptions = {},
  ) {
    const base = options.baseUrl ?? wolHttpUrl();
    this.base = base.endsWith("/") ? base : `${base}/`;
    // a deferred call: tests stub the global after this module loads
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  private withAccount(path: string, account: string | undefined): string {
    return account ? `${path}?account=${encodeURIComponent(account)}` : path;
  }

  private change<T>(path: string, account: string | undefined, body: object = {}): Promise<T> {
    return this.accounts.bearer<T>("POST", path, account ? { ...body, account } : { ...body });
  }

  /** `GET /v1/clans/mine`. */
  mine(account?: string): Promise<Mine> {
    return this.accounts.bearer<Mine>("GET", this.withAccount("v1/clans/mine", account));
  }

  /** `GET /v1/clans/invites`: the invitations waiting for the game account. */
  async invites(account?: string): Promise<Invite[]> {
    const body = await this.accounts.bearer<{ invites: Invite[] }>(
      "GET",
      this.withAccount("v1/clans/invites", account),
    );
    return body.invites;
  }

  /** `POST /v1/clans`: the game account founds a clan and owns it. */
  async create(tag: string, name: string, account?: string): Promise<MyClan> {
    return (await this.change<{ clan: MyClan }>("v1/clans", account, { tag, name })).clan;
  }

  /** `POST /v1/clans/{id}/invites` (owner or officer). */
  async invite(clanId: number, nick: string, account?: string): Promise<SentInvite> {
    const body = await this.change<{ invite: SentInvite }>(`v1/clans/${clanId}/invites`, account, {
      nick,
    });
    return body.invite;
  }

  accept(clanId: number, account?: string): Promise<{ clan: MyClan }> {
    return this.change(`v1/clans/invites/${clanId}/accept`, account);
  }

  async decline(clanId: number, account?: string): Promise<void> {
    await this.change(`v1/clans/invites/${clanId}/decline`, account);
  }

  async leave(clanId: number, account?: string): Promise<void> {
    await this.change(`v1/clans/${clanId}/leave`, account);
  }

  async disband(clanId: number, account?: string): Promise<void> {
    await this.change(`v1/clans/${clanId}/disband`, account);
  }

  /** Kick, promote, demote or transfer ownership to a member. */
  async member(
    clanId: number,
    nick: string,
    action: MemberAction,
    account?: string,
  ): Promise<void> {
    await this.change(`v1/clans/${clanId}/members/${encodeURIComponent(nick)}/${action}`, account);
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, this.base), { signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ClanError(0);
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new ClanError(response.status);
    try {
      return (await response.json()) as T;
    } catch {
      throw new ClanError(response.status);
    }
  }

  /** `GET /clans?search=`: newest first, a tag or name containing the text. */
  async search(text: string, limit: number, offset: number, signal?: AbortSignal): Promise<Search> {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (text) query.set("search", text);
    return (await this.get<Search>(`clans?${query}`, signal)) ?? { clans: [], total: 0 };
  }

  /** `GET /clans/{tag}`; null when there is no such clan. */
  publicClan(tag: string, signal?: AbortSignal): Promise<ClanDetail | null> {
    return this.get<ClanDetail>(`clans/${encodeURIComponent(tag)}`, signal);
  }
}

/** The text the player sees for a refusal; the clan error codes first, then the account ones. */
export function describeClanError(error: unknown): string {
  if (error instanceof AccountError) {
    switch (error.code) {
      case "bad_tag":
        return `A tag is ${TAG_MIN} to ${TAG_MAX} letters, digits, dashes or underscores.`;
      case "bad_name":
        return `A name is ${NAME_MIN} to ${NAME_MAX} printable ASCII characters, with no space at either end and none twice in a row.`;
      case "tag_taken":
        return "That tag is taken by another clan.";
      case "tag_reserved":
        return "That tag is not available.";
      case "already_in_clan":
        return "This game name is already in a clan.";
      case "clan_not_found":
        return "That clan does not exist any more.";
      case "not_a_member":
        return "This game name is not in that clan.";
      case "forbidden":
        return "Your role in the clan does not allow that.";
      case "member_not_found":
        return "That player is not in the clan.";
      case "no_such_player":
        return "No player has that name.";
      case "bad_target":
        return "That does not work on that player.";
      case "last_owner":
        return "The owner cannot leave: transfer the clan or disband it first.";
      case "clan_full":
        return `The clan is full (${CLAN_MAX_MEMBERS} members).`;
      case "invite_limit":
        return "Too many invitations are waiting. Try again later.";
      case "invite_not_found":
        return "That invitation is gone.";
      case "invite_expired":
        return "That invitation has expired.";
      case "no_game_account":
        return "Add a game name to your account first.";
      case "account_required":
        return "Choose which game name to act as.";
    }
  }
  return describeAccountError(error);
}
