import { configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { AccountClient } from "../../account/api";
import { FakeServer } from "../../account/fake-server";
import { AccountStore } from "../../account/store";
import type { ClanRole } from "../../clan/api";
import type { GameRecord } from "../../storage/manifest";
import { ClanScreen, PublicClanScreen } from "./ClanScreen";

// role queries over a table are slow in jsdom: give the screen time to settle
configure({ asyncUtilTimeout: 5000 });

const game = (id: "ra2" | "ra2md"): GameRecord => ({
  id,
  slot: 1,
  storage: id,
  title: id,
  exeStamp: 0,
  importedAt: 0,
  bytes: 0,
  complete: true,
  files: {},
});

const NOON = Date.UTC(2026, 10, 21, 12);
const DAY = 24 * 60 * 60 * 1000;

interface FakeClan {
  id: number;
  tag: string;
  name: string;
  createdAt: number;
  members: { nick: string; role: ClanRole; joinedAt: number }[];
}
interface FakeInvite {
  clanId: number;
  nick: string;
  invitedBy: string;
  expiresAt: number;
}

/**
 * The clan routes of ra2web (`clanRoutes.ts`) with the rules the page can meet: one clan per game
 * name, roles, the server's error codes. Everything else goes to the account fake.
 */
class ClanFake {
  readonly accounts = new FakeServer();
  clans: FakeClan[] = [];
  invites: FakeInvite[] = [];
  /** Game names that exist, so an invitation can name them. */
  known = new Set<string>(["Dave", "Erin"]);
  /** The game name a request acts as when it names none. */
  who = "Carol";
  /** `"POST /v1/clans/1/kick…"`: every clan request, with its body. */
  requests: string[] = [];
  down = false;
  private nextId = 1;

  add(tag: string, name: string, members: [string, ClanRole][], extra: Partial<FakeClan> = {}) {
    const clan = {
      id: this.nextId++,
      tag,
      name,
      createdAt: NOON - 30 * DAY,
      members: members.map(([nick, role]) => ({ nick, role, joinedAt: NOON - 10 * DAY })),
      ...extra,
    };
    this.clans.push(clan);
    return clan;
  }

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
  private refuse(status: number, errorCode: string) {
    return this.json({ error: errorCode.replace(/_/g, " "), errorCode }, status);
  }

  private clanOf(nick: string) {
    return this.clans.find((clan) =>
      clan.members.some((member) => member.nick.toLowerCase() === nick.toLowerCase()),
    );
  }
  private view(clan: FakeClan) {
    return { ...clan, memberCount: clan.members.length };
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? "GET";
    const path = url.pathname;
    if (!path.startsWith("/clans") && !path.startsWith("/v1/clans")) {
      return this.accounts.fetch(input, init);
    }
    await Promise.resolve();
    if (this.down) throw new TypeError("Failed to fetch");
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (path.startsWith("/clans")) {
      const rest = decodeURIComponent(path.slice("/clans".length).replace(/^\//, ""));
      if (rest) {
        const clan = this.clans.find((entry) => entry.tag.toLowerCase() === rest.toLowerCase());
        return clan ? this.json(this.view(clan)) : this.refuse(404, "clan_not_found");
      }
      const text = (url.searchParams.get("search") ?? "").toLowerCase();
      const limit = Number(url.searchParams.get("limit"));
      const offset = Number(url.searchParams.get("offset"));
      const found = [...this.clans]
        .reverse()
        .filter(
          (clan) => clan.tag.toLowerCase().includes(text) || clan.name.toLowerCase().includes(text),
        );
      this.requests.push(`GET ${path}${url.search}`);
      return this.json({
        clans: found.slice(offset, offset + limit).map(({ members, ...clan }) => ({
          ...clan,
          memberCount: members.length,
        })),
        total: found.length,
      });
    }

    this.requests.push(`${method} ${path}${url.search} ${init?.body ?? ""}`.trim());
    if (!new Headers(init?.headers).get("Authorization")) return this.refuse(401, "unauthorized");
    const me = String(body.account ?? url.searchParams.get("account") ?? this.who);
    const parts = path.slice("/v1/clans".length).split("/").filter(Boolean);
    const mine = this.clanOf(me);
    const role = mine?.members.find((m) => m.nick.toLowerCase() === me.toLowerCase())?.role;

    if (method === "GET" && parts[0] === "mine") {
      if (!mine) return this.json({ gameAccount: me, clan: null });
      const manager = role === "owner" || role === "officer";
      return this.json({
        gameAccount: me,
        clan: {
          ...this.view(mine),
          role,
          ...(manager
            ? {
                invites: this.invites
                  .filter((invite) => invite.clanId === mine.id)
                  .map(({ nick, expiresAt }) => ({ nick, createdAt: NOON, expiresAt })),
              }
            : {}),
        },
      });
    }
    if (method === "GET" && parts[0] === "invites") {
      return this.json({
        gameAccount: me,
        invites: this.invites
          .filter((invite) => invite.nick.toLowerCase() === me.toLowerCase())
          .map((invite) => {
            const clan = this.clans.find((entry) => entry.id === invite.clanId)!;
            return {
              clan: { id: clan.id, tag: clan.tag, name: clan.name },
              invitedBy: invite.invitedBy,
              createdAt: NOON,
              expiresAt: invite.expiresAt,
            };
          }),
      });
    }
    if (method === "POST" && parts.length === 0) {
      if (mine) return this.refuse(409, "already_in_clan");
      const tag = String(body.tag);
      const name = String(body.name);
      if (!/^[A-Za-z0-9_-]{2,6}$/.test(tag)) return this.refuse(400, "bad_tag");
      if (!/^[\x20-\x7e]{3,40}$/.test(name)) return this.refuse(400, "bad_name");
      if (this.clans.some((clan) => clan.tag.toLowerCase() === tag.toLowerCase())) {
        return this.refuse(409, "tag_taken");
      }
      const clan = this.add(tag, name, [[me, "owner"]], { createdAt: NOON });
      return this.json({ gameAccount: me, clan: { ...this.view(clan), role: "owner" } }, 201);
    }
    if (parts[0] === "invites" && parts.length === 3) {
      const clanId = Number(parts[1]);
      const invite = this.invites.find(
        (entry) => entry.clanId === clanId && entry.nick.toLowerCase() === me.toLowerCase(),
      );
      if (!invite) return this.refuse(404, "invite_not_found");
      if (invite.expiresAt <= NOON) return this.refuse(410, "invite_expired");
      this.invites = this.invites.filter((entry) => entry.nick.toLowerCase() !== me.toLowerCase());
      if (parts[2] === "decline") return this.json({ ok: true });
      const clan = this.clans.find((entry) => entry.id === clanId)!;
      clan.members.push({ nick: me, role: "member", joinedAt: NOON });
      return this.json({ clan: { ...this.view(clan), role: "member" } });
    }
    const clan = this.clans.find((entry) => entry.id === Number(parts[0]));
    if (!clan) return this.refuse(404, "clan_not_found");
    if (clan !== mine) return this.refuse(403, "not_a_member");
    const action = parts[1];
    if (action === "invites") {
      if (role === "member") return this.refuse(403, "forbidden");
      const nick = String(body.nick);
      if (!this.known.has(nick)) return this.refuse(404, "no_such_player");
      this.invites.push({ clanId: clan.id, nick, invitedBy: me, expiresAt: NOON + 7 * DAY });
      return this.json({ invite: { nick, createdAt: NOON, expiresAt: NOON + 7 * DAY } }, 201);
    }
    if (action === "leave") {
      if (role === "owner") return this.refuse(409, "last_owner");
      clan.members = clan.members.filter((m) => m.nick.toLowerCase() !== me.toLowerCase());
      return this.json({ ok: true });
    }
    if (action === "disband") {
      if (role !== "owner") return this.refuse(403, "forbidden");
      this.clans = this.clans.filter((entry) => entry !== clan);
      return this.json({ ok: true });
    }
    if (action === "members") {
      const target = clan.members.find((m) => m.nick === decodeURIComponent(parts[2]!));
      if (!target) return this.refuse(404, "member_not_found");
      const verb = parts[3];
      if (verb === "kick") {
        if (role === "member" || (role === "officer" && target.role !== "member")) {
          return this.refuse(403, "forbidden");
        }
        clan.members = clan.members.filter((m) => m !== target);
      } else if (role !== "owner") {
        return this.refuse(403, "forbidden");
      } else if (verb === "promote") target.role = "officer";
      else if (verb === "demote") target.role = "member";
      else if (verb === "transfer") {
        target.role = "owner";
        clan.members.find((m) => m.nick === me)!.role = "officer";
      }
      return this.json({ ok: true, clan: { ...this.view(clan), role: "owner" } });
    }
    return this.refuse(404, "not_found");
  };
}

async function members(fake: ClanFake, nicks: string[] = []) {
  const store = new AccountStore(
    new AccountClient({ baseUrl: "https://wol.test", fetch: fake.fetch, locks: null }),
  );
  if (nicks.length) {
    fake.accounts.maxGameAccounts = nicks.length;
    await store.register("carol", "secret-pass");
    for (const nick of nicks) await store.addGameAccount(nick, "game-pass-1");
    fake.who = nicks[0]!;
  } else {
    await store.restore();
  }
  return store;
}

function Where() {
  return <output aria-label="Path">{useLocation().pathname}</output>;
}

function show(store: AccountStore, fake: ClanFake, path = "/clan") {
  const props = {
    edition: game("ra2md"),
    store,
    fetch: fake.fetch,
    baseUrl: "https://wol.test",
  };
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/clan" element={<ClanScreen {...props} />} />
        <Route path="/clan/:tag" element={<PublicClanScreen {...props} />} />
        <Route path="/account" element={<p>account page</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

/** A clan where Carol (the signed-in player) has `role`, with a member and an officer around her. */
function clanWith(fake: ClanFake, role: ClanRole) {
  const others: [string, ClanRole][] =
    role === "owner"
      ? [
          ["Olga", "officer"],
          ["Mike", "member"],
        ]
      : [
          ["Boss", "owner"],
          ["Olga", "officer"],
          ["Mike", "member"],
        ];
  return fake.add("RED", "Red Guard", [["Carol", role], ...others]);
}

describe("ClanScreen signed out", () => {
  it("explains clans to a guest and links to the account page", async () => {
    const fake = new ClanFake();
    fake.add("ABC", "Alpha Bravo", [["Boss", "owner"]]);
    show(await members(fake), fake);
    const panel = screen.getByRole("region", { name: "Your clan" });
    expect(within(panel).getByText(/Sign in with your member account/)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "SIGN IN" })).toHaveAttribute(
      "href",
      "/account",
    );
    // the public list is open to a guest
    expect(await screen.findByRole("link", { name: "[ABC]" })).toBeInTheDocument();
    expect(fake.requests.some((request) => request.includes("/v1/clans"))).toBe(false);
  });

  it("asks a member with no game name to add one", async () => {
    const fake = new ClanFake();
    const store = new AccountStore(
      new AccountClient({ baseUrl: "https://wol.test", fetch: fake.fetch, locks: null }),
    );
    await store.register("carol", "secret-pass");
    show(store, fake);
    expect(await screen.findByText(/Add a game name to your account first/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ADD A GAME NAME" })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("says when the online service cannot be reached", async () => {
    const fake = new ClanFake();
    fake.accounts.down = true;
    const store = new AccountStore(
      new AccountClient({ baseUrl: "https://wol.test", fetch: fake.fetch, locks: null }),
    );
    await store.restore();
    show(store, fake);
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot be reached");
  });
});

describe("ClanScreen without a clan", () => {
  it("checks the tag and the name as they are typed and keeps CREATE off until both fit", async () => {
    const fake = new ClanFake();
    show(await members(fake, ["Carol"]), fake);
    const user = userEvent.setup();
    const create = await screen.findByRole("button", { name: "CREATE CLAN" });
    const tag = screen.getByLabelText("TAG");
    const name = screen.getByLabelText("NAME");
    expect(create).toBeDisabled();

    await user.type(tag, "a");
    expect(screen.getByText("A tag is at least 2 characters.")).toBeInTheDocument();
    expect(tag).toHaveAttribute("aria-invalid", "true");
    await user.type(tag, "$");
    expect(
      screen.getByText("A tag uses letters, digits, dashes and underscores only."),
    ).toBeInTheDocument();
    await user.clear(tag);
    await user.type(tag, "abcdefg");
    expect(screen.getByText("A tag is at most 6 characters.")).toBeInTheDocument();
    await user.clear(tag);
    await user.type(tag, "Ab_-9");
    expect(tag).not.toHaveAttribute("aria-invalid");

    await user.type(name, "Ré");
    expect(screen.getByText(/printable ASCII characters only/)).toBeInTheDocument();
    await user.clear(name);
    await user.type(name, "a  b");
    expect(screen.getByText("A name cannot have two spaces in a row.")).toBeInTheDocument();
    await user.clear(name);
    await user.type(name, "ab");
    expect(screen.getByText("A name is at least 3 characters.")).toBeInTheDocument();
    await user.type(name, "c ");
    expect(screen.getByText("A name cannot start or end with a space.")).toBeInTheDocument();
    expect(create).toBeDisabled();
    await user.clear(name);
    await user.type(name, "x".repeat(41));
    expect(screen.getByText("A name is at most 40 characters.")).toBeInTheDocument();
    await user.clear(name);
    await user.type(name, "Alpha Wolves");
    expect(create).toBeEnabled();
  });

  it("founds a clan and shows it", async () => {
    const fake = new ClanFake();
    show(await members(fake, ["Carol"]), fake);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("TAG"), "WOLF");
    await user.type(screen.getByLabelText("NAME"), "Alpha Wolves");
    await user.click(screen.getByRole("button", { name: "CREATE CLAN" }));
    const card = await screen.findByRole("region", { name: "Clan" });
    expect(within(card).getByRole("heading", { name: "[WOLF]" })).toBeInTheDocument();
    expect(within(card).getByText("Alpha Wolves")).toBeInTheDocument();
    expect(within(card).getByText("OWNER")).toBeInTheDocument();
    expect(fake.requests).toContain('POST /v1/clans {"tag":"WOLF","name":"Alpha Wolves"}');
    expect(screen.queryByLabelText("TAG")).toBeNull();
  });

  it("shows the server's refusal on submit", async () => {
    const fake = new ClanFake();
    fake.add("WOLF", "Other Wolves", [["Boss", "owner"]]);
    show(await members(fake, ["Carol"]), fake);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("TAG"), "wolf");
    await user.type(screen.getByLabelText("NAME"), "Alpha Wolves");
    await user.click(screen.getByRole("button", { name: "CREATE CLAN" }));
    const form = screen.getByRole("region", { name: "Found a clan" });
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "That tag is taken by another clan.",
    );
    // the form stays, and typing clears the message
    await user.type(screen.getByLabelText("TAG"), "s");
    expect(within(form).queryByRole("alert")).toBeNull();
  });

  it("lists the invitations and joins on Accept", async () => {
    const fake = new ClanFake();
    const red = fake.add("RED", "Red Guard", [["Boss", "owner"]]);
    const blue = fake.add("BLU", "Blue Crew", [["Zed", "owner"]]);
    fake.invites.push(
      { clanId: red.id, nick: "Carol", invitedBy: "Boss", expiresAt: NOON + 3 * DAY },
      { clanId: blue.id, nick: "Carol", invitedBy: "Zed", expiresAt: NOON + 5 * DAY },
    );
    show(await members(fake, ["Carol"]), fake);
    const list = await screen.findByRole("region", { name: "Invitations" });
    expect(await within(list).findByText(/Red Guard/)).toBeInTheDocument();
    expect(within(list).getByText(/Invited by Boss/)).toBeInTheDocument();
    expect(within(list).getByText(/Invited by Zed/)).toBeInTheDocument();
    await userEvent
      .setup()
      .click(within(list).getByRole("button", { name: "Accept the invitation to RED" }));
    const card = await screen.findByRole("region", { name: "Clan" });
    expect(within(card).getByRole("heading", { name: "[RED]" })).toBeInTheDocument();
    expect(within(card).getByText("MEMBER")).toBeInTheDocument();
    // the other invitation went with it
    expect(fake.invites).toHaveLength(0);
  });

  it("declines an invitation and says when none are left", async () => {
    const fake = new ClanFake();
    const red = fake.add("RED", "Red Guard", [["Boss", "owner"]]);
    fake.invites.push({ clanId: red.id, nick: "Carol", invitedBy: "Boss", expiresAt: NOON + DAY });
    show(await members(fake, ["Carol"]), fake);
    const list = await screen.findByRole("region", { name: "Invitations" });
    await userEvent
      .setup()
      .click(await within(list).findByRole("button", { name: "Decline the invitation to RED" }));
    expect(await within(list).findByText(/No invitations/)).toBeInTheDocument();
    expect(screen.getByLabelText("TAG")).toBeInTheDocument();
  });

  it("shows an expired invitation's refusal", async () => {
    const fake = new ClanFake();
    const red = fake.add("RED", "Red Guard", [["Boss", "owner"]]);
    fake.invites.push({ clanId: red.id, nick: "Carol", invitedBy: "Boss", expiresAt: NOON - 1 });
    show(await members(fake, ["Carol"]), fake);
    const list = await screen.findByRole("region", { name: "Invitations" });
    await userEvent
      .setup()
      .click(await within(list).findByRole("button", { name: "Accept the invitation to RED" }));
    expect(await within(list).findByRole("alert")).toHaveTextContent(
      "That invitation has expired.",
    );
  });

  it("searches the public clans and opens one", async () => {
    const fake = new ClanFake();
    fake.add("RED", "Red Guard", [["Boss", "owner"]]);
    fake.add("BLU", "Blue Crew", [
      ["Zed", "owner"],
      ["Amy", "member"],
    ]);
    show(await members(fake, ["Carol"]), fake);
    const user = userEvent.setup();
    const finder = await screen.findByRole("region", { name: "Find a clan" });
    // newest first
    const rows = await within(finder).findAllByRole("row");
    expect(rows[1]).toHaveTextContent("[BLU]Blue Crew2");
    expect(rows[2]).toHaveTextContent("[RED]Red Guard1");

    await user.type(within(finder).getByRole("searchbox"), "guard");
    await waitFor(() => expect(within(finder).queryByRole("link", { name: "[BLU]" })).toBeNull());
    expect(fake.requests).toContain("GET /clans?limit=20&offset=0&search=guard");
    await user.clear(within(finder).getByRole("searchbox"));
    await user.type(within(finder).getByRole("searchbox"), "nothing here");
    expect(await within(finder).findByText("No clan matches “nothing here”.")).toBeInTheDocument();

    await user.clear(within(finder).getByRole("searchbox"));
    await user.click(await within(finder).findByRole("link", { name: "[RED]" }));
    expect(screen.getByLabelText("Path")).toHaveTextContent("/clan/RED");
    expect(await screen.findByRole("heading", { name: "[RED]" })).toBeInTheDocument();
  }, 20_000);

  it("pages through the results", async () => {
    const fake = new ClanFake();
    for (let i = 1; i <= 25; i++) fake.add(`C${i}`, `Clan number ${i}`, [["Boss", "owner"]]);
    show(await members(fake), fake);
    const user = userEvent.setup();
    const finder = await screen.findByRole("region", { name: "Find a clan" });
    expect(await within(finder).findByText("1–20 of 25")).toBeInTheDocument();
    expect(within(finder).getByRole("button", { name: "PREVIOUS" })).toBeDisabled();
    await user.click(within(finder).getByRole("button", { name: "NEXT" }));
    expect(await within(finder).findByText("21–25 of 25")).toBeInTheDocument();
    expect(within(finder).getByRole("button", { name: "NEXT" })).toBeDisabled();
    expect(fake.requests).toContain("GET /clans?limit=20&offset=20");
  });

  it("says when there are no clans at all", async () => {
    const fake = new ClanFake();
    show(await members(fake), fake);
    expect(await screen.findByText("No clans yet. Found the first one.")).toBeInTheDocument();
  });

  it("shows an error with TRY AGAIN when the clans cannot be reached", async () => {
    const fake = new ClanFake();
    fake.add("RED", "Red Guard", [["Boss", "owner"]]);
    show(await members(fake, ["Carol"]), fake);
    await screen.findByLabelText("TAG");
    fake.down = true;
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox"), "r");
    expect(await screen.findByText(/The clans cannot be reached/)).toBeInTheDocument();
    fake.down = false;
    await user.click(screen.getByRole("button", { name: "TRY AGAIN" }));
    expect(await screen.findByRole("link", { name: "[RED]" })).toBeInTheDocument();
  });

  it("shows loading, then the server's refusal, when the clan cannot be read", async () => {
    const fake = new ClanFake();
    const store = await members(fake, ["Carol"]);
    fake.down = true;
    show(store, fake);
    expect(screen.getByText("Loading your clan…")).toBeInTheDocument();
    const panel = screen.getByRole("region", { name: "Your clan" });
    expect(await within(panel).findByRole("alert")).toHaveTextContent("cannot be reached");
    fake.down = false;
    await userEvent.setup().click(within(panel).getByRole("button", { name: "TRY AGAIN" }));
    expect(await screen.findByLabelText("TAG")).toBeInTheDocument();
  });
});

describe("ClanScreen in a clan", () => {
  it("shows the clan, my role, the member count, the date and the members by role", async () => {
    const fake = new ClanFake();
    clanWith(fake, "owner");
    show(await members(fake, ["Carol"]), fake);
    const card = await screen.findByRole("region", { name: "Clan" });
    expect(within(card).getByRole("heading", { name: "[RED]" })).toBeInTheDocument();
    expect(within(card).getByText("Red Guard")).toBeInTheDocument();
    expect(within(card).getByText("OWNER")).toBeInTheDocument();
    expect(within(card).getByText("3 / 50")).toBeInTheDocument();
    expect(within(card).getByText("22 Oct 2026")).toBeInTheDocument();
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    // the owner first, then the officer, then the member
    expect(rows[1]).toHaveTextContent("Carol (you)OWNER");
    expect(rows[2]).toHaveTextContent("OlgaOFFICER");
    expect(rows[3]).toHaveTextContent("MikeMEMBER");
    expect(rows[1]).toHaveAttribute("data-me", "true");
  });

  it("gives the owner every action on the others and none on themselves", async () => {
    const fake = new ClanFake();
    clanWith(fake, "owner");
    show(await members(fake, ["Carol"]), fake);
    await screen.findByRole("table");
    const buttons = (nick: string) =>
      within(screen.getByRole("row", { name: new RegExp(nick) }))
        .queryAllByRole("button")
        .map((button) => button.textContent);
    expect(buttons("Carol")).toEqual([]);
    expect(buttons("Olga")).toEqual(["DEMOTE", "KICK", "TRANSFER"]);
    expect(buttons("Mike")).toEqual(["PROMOTE", "KICK", "TRANSFER"]);
  });

  it("promotes and demotes at once", async () => {
    const fake = new ClanFake();
    clanWith(fake, "owner");
    show(await members(fake, ["Carol"]), fake);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Promote Mike" }));
    expect(await screen.findByRole("button", { name: "Demote Mike" })).toBeInTheDocument();
    expect(fake.requests).toContain("POST /v1/clans/1/members/Mike/promote {}");
    await user.click(screen.getByRole("button", { name: "Demote Olga" }));
    expect(await screen.findByRole("button", { name: "Promote Olga" })).toBeInTheDocument();
  });

  it("asks before a kick and does nothing on Cancel", async () => {
    const fake = new ClanFake();
    clanWith(fake, "owner");
    show(await members(fake, ["Carol"]), fake);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Kick Mike" }));
    const ask = screen.getByRole("group", { name: "Confirm kick" });
    expect(within(ask).getByText("Kick Mike?")).toBeInTheDocument();
    await user.click(within(ask).getByRole("button", { name: "CANCEL" }));
    expect(screen.queryByRole("group", { name: "Confirm kick" })).toBeNull();
    expect(fake.requests.some((request) => request.includes("kick"))).toBe(false);

    await user.click(screen.getByRole("button", { name: "Kick Mike" }));
    await user.click(screen.getByRole("button", { name: "YES, KICK" }));
    await waitFor(() => expect(screen.queryByText("Mike")).toBeNull());
    expect(fake.requests).toContain("POST /v1/clans/1/members/Mike/kick {}");
    expect(screen.getByText("2 / 50")).toBeInTheDocument();
  });

  it("asks before handing the clan over, then is an officer", async () => {
    const fake = new ClanFake();
    clanWith(fake, "owner");
    show(await members(fake, ["Carol"]), fake);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Transfer Olga" }));
    expect(screen.getByRole("group", { name: "Confirm transfer" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "YES, TRANSFER" }));
    const card = screen.getByRole("region", { name: "Clan" });
    await waitFor(() => expect(within(card).getByText("OFFICER")).toBeInTheDocument());
    // an officer may only kick members now
    expect(screen.queryByRole("button", { name: "Disband" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Promote|Demote|Transfer/ })).toBeNull();
  });

  it("gives an officer only the kick on members, and the invite field", async () => {
    const fake = new ClanFake();
    clanWith(fake, "officer");
    show(await members(fake, ["Carol"]), fake);
    await screen.findByRole("table");
    const buttons = (nick: string) =>
      within(screen.getByRole("row", { name: new RegExp(nick) }))
        .queryAllByRole("button")
        .map((button) => button.textContent);
    expect(buttons("Boss")).toEqual([]);
    expect(buttons("Olga")).toEqual([]);
    expect(buttons("Mike")).toEqual(["KICK"]);
    expect(screen.getByLabelText("Game name to invite")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "DISBAND" })).toBeNull();
    expect(screen.getByRole("button", { name: "LEAVE" })).toBeEnabled();
  });

  it("gives a plain member a read-only table, no invite field, and Leave", async () => {
    const fake = new ClanFake();
    clanWith(fake, "member");
    show(await members(fake, ["Carol"]), fake);
    await screen.findByRole("table");
    expect(screen.queryByRole("columnheader", { name: "ACTIONS" })).toBeNull();
    expect(within(screen.getByRole("table")).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByLabelText("Game name to invite")).toBeNull();
    expect(screen.getByRole("button", { name: "LEAVE" })).toBeEnabled();
  });

  it("keeps Leave off for the owner and says why", async () => {
    const fake = new ClanFake();
    clanWith(fake, "owner");
    show(await members(fake, ["Carol"]), fake);
    const leave = await screen.findByRole("button", { name: "LEAVE" });
    expect(leave).toBeDisabled();
    expect(leave).toHaveAccessibleDescription(/You are the owner, so you cannot leave/);
  });

  it("leaves after a confirmation", async () => {
    const fake = new ClanFake();
    clanWith(fake, "member");
    show(await members(fake, ["Carol"]), fake);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "LEAVE" }));
    expect(screen.getByText(/Leave \[RED\]\?/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "CANCEL" }));
    expect(screen.getByRole("button", { name: "LEAVE" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "LEAVE" }));
    await user.click(screen.getByRole("button", { name: "YES, LEAVE" }));
    expect(await screen.findByLabelText("TAG")).toBeInTheDocument();
    expect(fake.requests).toContain("POST /v1/clans/1/leave {}");
  });

  it("disbands after a confirmation", async () => {
    const fake = new ClanFake();
    clanWith(fake, "owner");
    show(await members(fake, ["Carol"]), fake);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "DISBAND" }));
    expect(screen.getByText(/Every member is removed/)).toBeInTheDocument();
    expect(fake.requests.some((request) => request.includes("disband"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "YES, DISBAND" }));
    expect(await screen.findByLabelText("TAG")).toBeInTheDocument();
    expect(fake.clans).toHaveLength(0);
  });

  it("invites a player by name, lists the waiting invitation, and shows a refusal", async () => {
    const fake = new ClanFake();
    clanWith(fake, "owner");
    show(await members(fake, ["Carol"]), fake);
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Game name to invite");
    expect(screen.getByRole("button", { name: "INVITE" })).toBeDisabled();
    await user.type(field, "Dave");
    await user.click(screen.getByRole("button", { name: "INVITE" }));
    expect(await screen.findByText(/Invited Dave/)).toBeInTheDocument();
    expect(fake.requests).toContain('POST /v1/clans/1/invites {"nick":"Dave"}');
    const panel = screen.getByRole("region", { name: "Invite a player" });
    expect(await within(panel).findByText("WAITING FOR AN ANSWER")).toBeInTheDocument();
    expect(within(panel).getByText("Dave")).toBeInTheDocument();
    expect(field).toHaveValue("");

    await user.type(field, "Nobody");
    await user.click(screen.getByRole("button", { name: "INVITE" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("No player has that name.");
  });

  it("shows the server's refusal of a change", async () => {
    const fake = new ClanFake();
    clanWith(fake, "owner");
    show(await members(fake, ["Carol"]), fake);
    const kick = await screen.findByRole("button", { name: "Kick Mike" });
    // Mike left a moment ago, in another tab
    fake.clans[0]!.members = fake.clans[0]!.members.filter((m) => m.nick !== "Mike");
    await userEvent.setup().click(kick);
    await userEvent.setup().click(screen.getByRole("button", { name: "YES, KICK" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That player is not in the clan.");
    // and the table shows what is true now
    await waitFor(() => expect(screen.queryByText("Mike")).toBeNull());
  });
});

describe("ClanScreen with several game names", () => {
  it("names the game name in every request and switches between them", async () => {
    const fake = new ClanFake();
    fake.add("RED", "Red Guard", [["Carol2", "owner"]]);
    const store = await members(fake, ["Carol", "Carol2"]);
    show(store, fake);
    const user = userEvent.setup();
    // the first name has no clan
    expect(await screen.findByLabelText("TAG")).toBeInTheDocument();
    expect(fake.requests).toContain("GET /v1/clans/mine?account=Carol");
    await user.selectOptions(screen.getByRole("combobox", { name: "PLAYING AS" }), "Carol2");
    expect(await screen.findByRole("heading", { name: "[RED]" })).toBeInTheDocument();
    expect(fake.requests).toContain("GET /v1/clans/mine?account=Carol2");
    await user.type(screen.getByLabelText("Game name to invite"), "Dave");
    await user.click(screen.getByRole("button", { name: "INVITE" }));
    await screen.findByText(/Invited Dave/);
    expect(fake.requests).toContain('POST /v1/clans/1/invites {"nick":"Dave","account":"Carol2"}');
  });

  it("does not name the game name when there is one", async () => {
    const fake = new ClanFake();
    show(await members(fake, ["Carol"]), fake);
    await screen.findByLabelText("TAG");
    expect(fake.requests).toContain("GET /v1/clans/mine");
    expect(screen.queryByRole("combobox", { name: "PLAYING AS" })).toBeNull();
  });
});

describe("PublicClanScreen", () => {
  it("shows a clan and its members, read only, to anyone", async () => {
    const fake = new ClanFake();
    clanWith(fake, "owner");
    show(await members(fake), fake, "/clan/red");
    expect(await screen.findByRole("heading", { name: "[RED]" })).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Clan" });
    expect(within(card).getByText("Red Guard")).toBeInTheDocument();
    expect(within(card).getByText("3 / 50")).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByLabelText("Game name to invite")).toBeNull();
    expect(within(card).getByRole("link", { name: "ALL CLANS" })).toHaveAttribute("href", "/clan");
  });

  it("says when there is no such clan", async () => {
    const fake = new ClanFake();
    show(await members(fake), fake, "/clan/GONE");
    expect(await screen.findByText(/No clan has the tag \[GONE\]/)).toBeInTheDocument();
  });

  it("shows an error with TRY AGAIN", async () => {
    const fake = new ClanFake();
    clanWith(fake, "owner");
    const store = await members(fake);
    fake.down = true;
    show(store, fake, "/clan/RED");
    expect(screen.getByText("Loading the clan…")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("The clan cannot be reached");
    fake.down = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "TRY AGAIN" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});
