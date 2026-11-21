import { FakeServer } from "../account/fake-server";
import { FRIENDS_MAX, type Friend } from "./api";

/**
 * The friends routes of ra2web (LB-15) for tests: one list per game name, the refusals the page
 * can meet (`{ error }` with a status, no error code). Every other route goes to the account fake.
 */
export class FriendsFake {
  readonly accounts = new FakeServer();
  /** The lists, by game name (lower case). */
  readonly lists = new Map<string, Friend[]>();
  /** Game names that exist: only these can be added. */
  known = new Set<string>(["Dave", "Erin", "Frank"]);
  /** The game name a request acts as when it names none. */
  who = "Carol";
  /** `"PUT /v1/friends/Dave"`, `"GET /v1/friends?account=Carol"`: every friends request. */
  requests: string[] = [];
  down = false;

  list(who: string): Friend[] {
    const key = who.toLowerCase();
    if (!this.lists.has(key)) this.lists.set(key, []);
    return this.lists.get(key)!;
  }

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? "GET";
    if (!url.pathname.startsWith("/v1/friends")) return this.accounts.fetch(input, init);
    await Promise.resolve();
    if (this.down) throw new TypeError("Failed to fetch");
    this.requests.push(`${method} ${url.pathname}${url.search}`);
    if (!new Headers(init?.headers).get("Authorization")) {
      return this.json({ error: "Sign in first.", errorCode: "unauthorized" }, 401);
    }
    const me = url.searchParams.get("account") ?? this.who;
    const list = this.list(me);
    const raw = url.pathname.slice("/v1/friends".length).replace(/^\//, "");
    const name = decodeURIComponent(raw);
    const index = list.findIndex((friend) => friend.name.toLowerCase() === name.toLowerCase());

    if (method === "GET" && !name) {
      return this.json({
        friends: [...list].sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
    if (method === "PUT") {
      if (name.toLowerCase() === me.toLowerCase()) {
        return this.json({ error: "You cannot add yourself." }, 400);
      }
      const known = [...this.known].find((entry) => entry.toLowerCase() === name.toLowerCase());
      if (!known) return this.json({ error: "No player has that name." }, 404);
      if (index >= 0) return this.json({ error: `${known} is already a friend.` }, 409);
      if (list.length >= FRIENDS_MAX) return this.json({ error: "The friends list is full." }, 409);
      list.push({ name: known, status: "offline" });
      return this.json({ ok: true });
    }
    if (method === "DELETE") {
      if (index >= 0) list.splice(index, 1);
      return this.json({ ok: true });
    }
    return this.json({ error: "Not found." }, 404);
  };
}
