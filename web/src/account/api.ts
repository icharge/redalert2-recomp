/**
 * The launcher's client for the ra2web member routes (MB-2; docs/wol/members-and-sso.md).
 *
 * Every request carries `credentials: "include"` so the `ra2refresh` cookie (HttpOnly, scoped to
 * `/v1/auth`) travels. The access token lives in this object's memory only: never in storage.
 *
 * Refreshes are serialized. The server rotates the cookie on every use and treats a second use of
 * an old value as theft (it signs the member out everywhere), so two refreshes must never overlap:
 * one in flight per page here, and a Web Lock (`navigator.locks`) across the tabs of this origin.
 */

export interface Member {
  id: number;
  login: string;
  email: string | null;
  status: string;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface GameAccount {
  username: string;
  linkedAt: number;
}

/** What register, login and refresh answer with. */
export interface Session {
  member: Member;
  gameAccounts: GameAccount[];
  maxGameAccounts: number;
  accessToken: string;
  expiresIn: number;
}

/** What `GET /v1/members/me` answers with: a session without a token. */
export type Profile = Omit<Session, "accessToken" | "expiresIn">;

export interface GameAccountResult {
  gameAccount: GameAccount;
  /** true when the nick was created, false when an existing one was claimed. */
  created: boolean;
  gameAccounts: GameAccount[];
  maxGameAccounts: number;
}

/** The server's edition names for a ticket: `ra2` and `yr` (the game's `ra2md`). */
export type TicketEdition = "ra2" | "yr";

/** What the launch and guest ticket routes answer with. A ticket lives 60 s and is single use. */
export interface TicketResult {
  ticket: string;
  edition: TicketEdition;
  /** The name the game logs in as: the account's own spelling, or the guest's nick. */
  user: string;
  guest?: true;
  expiresIn: number;
}

/** A refusal from the server: `{error, errorCode}` with the HTTP status. */
export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

/** The server could not be reached at all (no network, refused, blocked by CORS). */
export class OfflineError extends Error {
  constructor(cause?: unknown) {
    super("The online service cannot be reached.", { cause });
    this.name = "OfflineError";
  }
}

/** The operator's WOL HTTP server, the same one the game loader redeems tickets at. */
export function wolHttpUrl(): string {
  return import.meta.env.VITE_WOL_HTTP_URL ?? "http://127.0.0.1:9090";
}

const LOCK_NAME = "ra2-account-refresh";

type LockRunner = <T>(name: string, run: () => Promise<T>) => Promise<T>;

/** Web Locks when the browser has them (a secure page); otherwise the page-wide promise alone. */
function browserLocks(): LockRunner | null {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return null;
  return async (name, run) => await locks.request(name, run);
}

export interface ClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Runs `run` while holding the named cross-tab lock. `null` turns the lock off (no Web Locks). */
  locks?: LockRunner | null;
}

type Body = Record<string, unknown> | undefined;

export class AccountClient {
  private token: string | null = null;
  private inflight: Promise<Session> | null = null;
  private readonly base: string;
  private readonly fetcher: typeof fetch;
  private readonly locks: LockRunner | null;

  constructor(options: ClientOptions = {}) {
    const base = options.baseUrl ?? wolHttpUrl();
    this.base = base.endsWith("/") ? base : `${base}/`;
    // a deferred call: tests stub the global after this module loads
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.locks = options.locks === undefined ? browserLocks() : options.locks;
  }

  /** Whether a bearer token is held (in memory). */
  get signedIn(): boolean {
    return this.token !== null;
  }

  /** Forget the token without telling the server (the page learned the session is gone). */
  forget(): void {
    this.token = null;
  }

  private async call<T>(
    method: string,
    path: string,
    body: Body,
    bearer: string | null,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body) headers["Content-Type"] = "application/json";
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, this.base), {
        method,
        headers,
        credentials: "include",
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new OfflineError(error);
    }
    const parsed: unknown = await response.json().catch(() => ({}));
    const result = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      throw new AccountError(
        typeof result.error === "string" ? result.error : `The server answered ${response.status}.`,
        response.status,
        typeof result.errorCode === "string" ? result.errorCode : "unknown",
      );
    }
    return result as T;
  }

  private adopt(session: Session): Session {
    this.token = session.accessToken;
    return session;
  }

  /** `POST /v1/members/register`: a member, signed in. */
  async register(login: string, password: string, email?: string): Promise<Session> {
    const body: Record<string, unknown> = { login, password };
    if (email) body.email = email;
    return this.adopt(await this.call<Session>("POST", "v1/members/register", body, null));
  }

  /** `POST /v1/members/login`; `login` may be the member's email. */
  async login(login: string, password: string): Promise<Session> {
    return this.adopt(
      await this.call<Session>("POST", "v1/members/login", { login, password }, null),
    );
  }

  /**
   * `POST /v1/auth/refresh` with the cookie: restores or renews the session. Calls made while one
   * is in flight share it; across tabs the Web Lock queues them, so the cookie each one sends is
   * the one the previous refresh just set.
   */
  refresh(): Promise<Session> {
    if (this.inflight) return this.inflight;
    const run = () => this.call<Session>("POST", "v1/auth/refresh", undefined, null);
    const locked = this.locks ? this.locks(LOCK_NAME, run) : run();
    const attempt = locked
      .then((session) => this.adopt(session))
      .catch((error: unknown) => {
        // a refused refresh ends the session; an unreachable server keeps what the page holds
        if (error instanceof AccountError) this.token = null;
        throw error;
      })
      .finally(() => {
        this.inflight = null;
      });
    this.inflight = attempt;
    return attempt;
  }

  /**
   * A call with the access token. A 401 means the token expired (or the server restarted, which
   * forgets them): refresh once and retry once. No token yet counts as expired.
   */
  async bearer<T>(method: string, path: string, body?: Body): Promise<T> {
    if (this.token) {
      try {
        return await this.call<T>(method, path, body, this.token);
      } catch (error) {
        if (!(error instanceof AccountError) || error.status !== 401) throw error;
      }
    }
    const session = await this.refresh();
    return this.call<T>(method, path, body, session.accessToken);
  }

  /** `GET /v1/members/me`. */
  me(): Promise<Profile> {
    return this.bearer<Profile>("GET", "v1/members/me");
  }

  /** `POST /v1/members/game-accounts`: creates the nick (201) or claims an existing one (200). */
  addGameAccount(username: string, password: string): Promise<GameAccountResult> {
    return this.bearer<GameAccountResult>("POST", "v1/members/game-accounts", {
      username,
      password,
    });
  }

  /**
   * `POST /v1/auth/launch-ticket`: a ticket the game redeems to log in as `gameAccount`. Mint it at
   * the moment of PLAY: it is single use and valid for 60 seconds.
   */
  launchTicket(gameAccount: string, edition: TicketEdition): Promise<TicketResult> {
    return this.bearer<TicketResult>("POST", "v1/auth/launch-ticket", { gameAccount, edition });
  }

  /** `POST /v1/auth/guest`: a ticket for a guest session under `nick`; no member or password. */
  guestTicket(nick: string, edition: TicketEdition): Promise<TicketResult> {
    return this.call<TicketResult>("POST", "v1/auth/guest", { nick, edition }, null);
  }

  /**
   * Ends this browser's session: `POST /v1/auth/logout` with the cookie (it works after the access
   * token expired, which `/v1/members/logout` does not). The token is dropped even when the server
   * cannot be reached.
   */
  async logout(): Promise<void> {
    this.token = null;
    await this.call<unknown>("POST", "v1/auth/logout", undefined, null);
  }

  /** `POST /v1/members/logout-everywhere`: every browser of this member. */
  async logoutEverywhere(): Promise<void> {
    await this.bearer<unknown>("POST", "v1/members/logout-everywhere");
    this.token = null;
  }
}

/** The text the player sees for a refusal, by its `errorCode`. */
export function describeAccountError(error: unknown): string {
  if (error instanceof OfflineError) {
    return "The online service cannot be reached. You can keep playing as a guest.";
  }
  if (!(error instanceof AccountError)) return "Something went wrong. Try again.";
  switch (error.code) {
    case "bad_login":
      return "Choose a login of 3 to 32 letters, digits, dots, dashes or underscores.";
    case "bad_email":
      return "That email address does not look right.";
    case "bad_password":
      return "A password is 8 to 64 characters.";
    case "login_taken":
      return "That login is taken.";
    case "email_taken":
      return "That email is already used by a member.";
    case "bad_credentials":
      return "The login or password is wrong.";
    case "locked":
      return "Too many wrong passwords. Wait 15 minutes and try again.";
    case "inactive":
      return "This member is suspended.";
    case "registration_closed":
      return "New members and names are closed on this server.";
    case "rate_limited":
      return "Too many tries. Wait a little and try again.";
    case "origin_refused":
      return "This server does not accept the launcher from this address.";
    case "invalid_refresh":
    case "refresh_reused":
    case "unauthorized":
      return "Your session ended. Sign in again.";
    case "bad_username":
      return "A game name is up to 9 letters, digits, dashes or underscores.";
    case "limit_reached":
      return "This member has all the game accounts it can have.";
    case "claimed":
      return "That game name belongs to another member.";
    case "wrong_password":
      return "That is not the password of that game account.";
    case "banned":
      return "That game account is banned.";
    case "name_taken":
      return "That name is taken. Choose another.";
    case "bad_nick":
      return "An online name is 2 to 9 letters, digits, dashes or underscores.";
    case "not_your_game_account":
      return "That game account is not linked to your member. Check the Account page.";
    case "no_member":
      return "Your member could not be found. Sign in again.";
    default:
      return error.message;
  }
}
