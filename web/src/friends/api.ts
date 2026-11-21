/**
 * The launcher's client for the ra2web friends routes (LB-15). The list is the same one the game's
 * own Buddy List (Yuri's Revenge) shows: a change here appears there and the other way round.
 *
 *   GET    /v1/friends        -> { friends: [{ name, status, room? }] }, sorted by name
 *   PUT    /v1/friends/:name  -> { ok: true }; 400, 404 or 409 with { error }
 *   DELETE /v1/friends/:name  -> { ok: true }
 *
 * The routes go through the account client's bearer call, so they carry the access token and
 * refresh once on a 401. A buddy list belongs to a game name: a member with several names says
 * which one with `?account=`, as the clan routes do (a member with one name leaves it out).
 */
import { AccountError, describeAccountError, type AccountClient } from "../account/api";

/** A game name is 1 to 9 characters; a list holds at most this many buddies. */
export const NAME_MAX = 9;
export const FRIENDS_MAX = 100;

export type FriendStatus = "offline" | "lobby" | "game" | "online" | "hidden";

export interface Friend {
  name: string;
  status: FriendStatus;
  /** The channel (lobby) or the game room the buddy is in, when the server tells. */
  room?: string;
}

/** Why a name cannot be a buddy, or null. An empty name is not a complaint yet (the form is empty). */
export function friendNameProblem(name: string): string | null {
  if (name === "") return null;
  if (!/^[\x21-\x7e]+$/.test(name)) {
    return "A game name has no spaces and uses plain ASCII characters only.";
  }
  if (name.length > NAME_MAX) return `A game name is at most ${NAME_MAX} characters.`;
  return null;
}

export class FriendsClient {
  constructor(private readonly accounts: AccountClient) {}

  private withAccount(path: string, account: string | undefined): string {
    return account ? `${path}?account=${encodeURIComponent(account)}` : path;
  }

  /** `GET /v1/friends`. */
  async list(account?: string): Promise<Friend[]> {
    const body = await this.accounts.bearer<{ friends?: Friend[] }>(
      "GET",
      this.withAccount("v1/friends", account),
    );
    return Array.isArray(body.friends) ? body.friends : [];
  }

  /** `PUT /v1/friends/:name`. */
  async add(name: string, account?: string): Promise<void> {
    await this.accounts.bearer(
      "PUT",
      this.withAccount(`v1/friends/${encodeURIComponent(name)}`, account),
    );
  }

  /** `DELETE /v1/friends/:name`. */
  async remove(name: string, account?: string): Promise<void> {
    await this.accounts.bearer(
      "DELETE",
      this.withAccount(`v1/friends/${encodeURIComponent(name)}`, account),
    );
  }
}

/**
 * The text the player sees for a refusal. The friends routes answer `{ error }` with a sentence
 * (no error code) for a 400, 404 or 409: that sentence is shown as the server wrote it. Anything
 * else (a lapsed session, no network) is the account client's wording.
 */
export function describeFriendsError(error: unknown): string {
  if (
    error instanceof AccountError &&
    error.code === "unknown" &&
    (error.status === 400 || error.status === 404 || error.status === 409) &&
    error.message
  ) {
    return error.message;
  }
  return describeAccountError(error);
}
