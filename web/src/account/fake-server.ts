import type { GameAccount, Member } from "./api";

/**
 * A stand-in for the ra2web member routes, as a `fetch`: for the tests of the account client and
 * screens. It keeps the pieces that matter to the page: the cookie jar (shared by every "tab"), the
 * cookie's SameSite=Lax rule (set `pageOrigin`), rotation with reuse detection (a refresh that arrives with an old cookie signs everyone out),
 * access tokens that expire, the game account limit and claims.
 */
export class FakeServer {
  readonly calls: {
    method: string;
    path: string;
    fullPath: string;
    bearer: string | null;
    credentials: string;
  }[] = [];
  /** The `ra2refresh` cookie of the browser; `null` is no cookie. */
  cookie: string | null = null;
  /**
   * The page's origin. Set, the cookie is SameSite=Lax as on the real server: a request from a page
   * on another site (scheme and host; `localhost` and `127.0.0.1` differ, ports do not count)
   * neither sends it nor keeps the one its answer sets. `null` skips the rule.
   */
  pageOrigin: string | null = null;
  /** When set, every request fails as if the network were down. */
  down = false;
  maxGameAccounts = 1;
  /** `false` answers the guest route with `guests_disabled`. */
  guestsEnabled = true;
  /** Nicks a guest cannot take, besides every game account (any case): the server's reserved ones. */
  readonly reserved = new Set<string>(["matchbot"]);
  /** Routes (`"POST /v1/auth/launch-ticket"`) that answer with this refusal, whatever the request. */
  readonly refusals = new Map<string, { status: number; errorCode: string }>();
  /** The tickets minted so far, by ticket: who for and for which edition. */
  readonly tickets = new Map<string, { user: string; edition: string; guest: boolean }>();
  /** Existing game accounts (WOL accounts) and their passwords (`null`: launcher sign-in only), for claims. */
  readonly wolAccounts = new Map<string, string | null>([["Taken", "wolpassword"]]);
  readonly owned = new Map<string, string>();

  private members = new Map<string, { member: Member; password: string; games: GameAccount[] }>();
  private access = new Map<string, string>();
  private refreshTokens = new Map<string, string>();
  private rotated = new Set<string>();
  private serial = 0;
  private nextId = 1;
  /** Whether the request being answered is same-site: only then does its answer set the cookie. */
  private sameSite = true;

  /** Make every access token invalid, as a server restart or 15 minutes would. */
  expireAccessTokens(): void {
    this.access.clear();
  }

  private token(kind: string): string {
    this.serial += 1;
    return `${kind}${String(this.serial).padStart(8, "0")}`.padEnd(43, "x");
  }

  private session(login: string) {
    const entry = this.members.get(login.toLowerCase())!;
    const accessToken = this.token("a");
    this.access.set(accessToken, login.toLowerCase());
    const refresh = this.token("r");
    this.refreshTokens.set(refresh, login.toLowerCase());
    if (this.sameSite) this.cookie = refresh;
    return {
      member: entry.member,
      gameAccounts: entry.games,
      maxGameAccounts: this.maxGameAccounts,
      accessToken,
      expiresIn: 900,
    };
  }

  private ticket(user: string, edition: string, guest: boolean) {
    const ticket = this.token(guest ? "g" : "t");
    this.tickets.set(ticket, { user, edition, guest });
    return { ticket, edition, user, ...(guest ? { guest: true } : {}), expiresIn: 60 };
  }

  private respond(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  private refuse(status: number, errorCode: string): Response {
    return this.respond(status, { error: errorCode.replace(/_/g, " "), errorCode });
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const bearer = headers.get("Authorization")?.replace(/^Bearer /, "") ?? null;
    const route = url.pathname.slice(url.pathname.indexOf("/v1/"));
    this.calls.push({
      method,
      path: route,
      fullPath: url.pathname,
      bearer,
      credentials: String(init?.credentials),
    });
    // the request is read now (this is the cookie it carries), answered a moment later
    const sameSite = this.pageOrigin === null || site(this.pageOrigin) === site(url.origin);
    const sentCookie = sameSite ? this.cookie : null;
    await Promise.resolve();
    await Promise.resolve();
    this.sameSite = sameSite;
    if (this.down) throw new TypeError("Failed to fetch");
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
    const who = bearer ? this.access.get(bearer) : undefined;

    const forced = this.refusals.get(`${method} ${route}`);
    if (forced) return this.refuse(forced.status, forced.errorCode);

    const passwordRoute = /^POST \/v1\/members\/game-accounts\/([^/]+)\/password$/.exec(
      `${method} ${route}`,
    );
    if (passwordRoute) {
      if (!who) return this.refuse(401, "unauthorized");
      const entry = this.members.get(who)!;
      const nick = decodeURIComponent(passwordRoute[1] ?? "");
      if (this.owned.get(nick) !== who) return this.refuse(403, "not_your_game_account");
      if ((body.password ?? "").length < 8) return this.refuse(400, "bad_password");
      this.wolAccounts.set(nick, body.password!);
      entry.games = entry.games.map((g) => (g.username === nick ? { ...g, hasPassword: true } : g));
      return this.respond(200, {
        gameAccount: entry.games.find((g) => g.username === nick),
        gameAccounts: entry.games,
        maxGameAccounts: this.maxGameAccounts,
      });
    }

    switch (`${method} ${route}`) {
      case "POST /v1/members/register": {
        const key = (body.login ?? "").toLowerCase();
        if (!/^[a-z0-9._-]{3,32}$/.test(key)) return this.refuse(400, "bad_login");
        if ((body.password ?? "").length < 8) return this.refuse(400, "bad_password");
        if (this.members.has(key)) return this.refuse(409, "login_taken");
        this.members.set(key, {
          member: {
            id: this.nextId++,
            login: body.login!,
            email: body.email ?? null,
            status: "active",
            createdAt: 1,
            lastLoginAt: null,
          },
          password: body.password!,
          games: [],
        });
        return this.respond(201, this.session(key));
      }
      case "POST /v1/members/login": {
        const entry = this.members.get((body.login ?? "").toLowerCase());
        if (!entry || entry.password !== body.password) return this.refuse(401, "bad_credentials");
        return this.respond(200, this.session(body.login!));
      }
      case "POST /v1/auth/refresh": {
        if (!sentCookie) return this.refuse(401, "invalid_refresh");
        if (this.rotated.has(sentCookie)) {
          // a cookie that was already rotated: reuse, so every session of the member ends
          this.refreshTokens.clear();
          this.access.clear();
          this.cookie = null;
          return this.refuse(401, "refresh_reused");
        }
        const login = this.refreshTokens.get(sentCookie);
        if (!login) return this.refuse(401, "invalid_refresh");
        this.refreshTokens.delete(sentCookie);
        this.rotated.add(sentCookie);
        return this.respond(200, this.session(login));
      }
      case "POST /v1/auth/logout": {
        if (sentCookie) this.refreshTokens.delete(sentCookie);
        if (sameSite) this.cookie = null;
        return this.respond(200, { ok: true });
      }
      case "POST /v1/members/logout-everywhere": {
        if (!who) return this.refuse(401, "unauthorized");
        this.refreshTokens.clear();
        this.access.clear();
        this.cookie = null;
        return this.respond(200, { ok: true });
      }
      case "GET /v1/members/me": {
        if (!who) return this.refuse(401, "unauthorized");
        const entry = this.members.get(who)!;
        return this.respond(200, {
          member: entry.member,
          gameAccounts: entry.games,
          maxGameAccounts: this.maxGameAccounts,
        });
      }
      case "POST /v1/members/game-accounts": {
        if (!who) return this.refuse(401, "unauthorized");
        const entry = this.members.get(who)!;
        const nick = body.username ?? "";
        if (nick.length < 1 || nick.length > 9) return this.refuse(400, "bad_username");
        if (entry.games.length >= this.maxGameAccounts) return this.refuse(409, "limit_reached");
        const existing = this.wolAccounts.get(nick);
        if (existing !== undefined) {
          const owner = this.owned.get(nick);
          if (owner && owner !== who) return this.refuse(409, "claimed");
          if (existing === null || existing !== body.password) {
            return this.refuse(403, "wrong_password");
          }
        } else {
          if (body.password !== undefined && body.password.length < 8) {
            return this.refuse(400, "bad_password");
          }
          this.wolAccounts.set(nick, body.password ?? null);
        }
        this.owned.set(nick, who);
        const game = {
          username: nick,
          linkedAt: 2,
          hasPassword: this.wolAccounts.get(nick) !== null,
        };
        entry.games = [...entry.games, game];
        return this.respond(existing === undefined ? 201 : 200, {
          gameAccount: game,
          created: existing === undefined,
          gameAccounts: entry.games,
          maxGameAccounts: this.maxGameAccounts,
        });
      }
      case "POST /v1/auth/launch-ticket": {
        if (!who) return this.refuse(401, "unauthorized");
        if (body.edition !== "ra2" && body.edition !== "yr") return this.refuse(400, "bad_edition");
        const entry = this.members.get(who)!;
        const game = entry.games.find(
          (g) => g.username.toLowerCase() === (body.gameAccount ?? "").toLowerCase(),
        );
        if (!game) return this.refuse(403, "not_your_game_account");
        return this.respond(200, this.ticket(game.username, body.edition, false));
      }
      case "POST /v1/auth/guest": {
        if (!this.guestsEnabled) return this.refuse(403, "guests_disabled");
        if (body.edition !== "ra2" && body.edition !== "yr") return this.refuse(400, "bad_edition");
        const nick = body.nick ?? "";
        if (!/^[A-Za-z0-9_-]{2,9}$/.test(nick)) return this.refuse(400, "bad_nick");
        const key = nick.toLowerCase();
        const taken =
          this.reserved.has(key) ||
          [...this.wolAccounts.keys()].some((n) => n.toLowerCase() === key);
        if (taken) return this.refuse(409, "name_taken");
        return this.respond(200, this.ticket(nick, body.edition, true));
      }
      default:
        return this.refuse(404, "not_found");
    }
  };

  /** Paths called, in order, e.g. `["POST /v1/auth/refresh"]`. */
  log(): string[] {
    return this.calls.map((call) => `${call.method} ${call.path}`);
  }
}

/**
 * A URL's site as SameSite sees it: the scheme and the registrable domain. An IP address or a
 * single-label host (`localhost`) is its own site; a name keeps its last two labels, which is
 * enough for these tests (no public-suffix list).
 */
export function site(origin: string): string {
  const { protocol, hostname } = new URL(origin);
  const ip = /^[\d.]+$/.test(hostname) || hostname.startsWith("[");
  const labels = hostname.split(".");
  return `${protocol}//${ip || labels.length < 2 ? hostname : labels.slice(-2).join(".")}`;
}

/** A cross-tab lock like `navigator.locks.request` for one name: runs go one after another. */
export function fakeLocks(): <T>(name: string, run: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (_name, run) => {
    const result = tail.then(run);
    tail = result.catch(() => {});
    return result;
  };
}
