import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AccountClient } from "../../account/api";
import { FakeServer } from "../../account/fake-server";
import { AccountStore } from "../../account/store";
import type { LadderRecord, Leaderboard, PlayerProfile, Season } from "../../ladder/api";
import type { GameRecord } from "../../storage/manifest";
import { LadderScreen } from "./LadderScreen";

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

const record = (rank: number, name: string, rating: number, extra = {}): LadderRecord => ({
  name,
  rank,
  rating,
  points: rating,
  badge: 2,
  wins: 10,
  losses: 5,
  draws: 0,
  ...extra,
});

const board = (records: LadderRecord[], extra: Partial<Leaderboard> = {}): Leaderboard => ({
  seasonId: 7,
  season: "Season 7",
  archived: false,
  records,
  totalCount: records.length,
  ...extra,
});

const season = (id: number, slug: string, extra: Partial<Season> = {}): Season => ({
  id,
  sku: 18688,
  name: `Season ${id}`,
  slug,
  status: slug === "current" ? "running" : "archived",
  startTime: id * 1000,
  endTime: id * 1000 + 999,
  ...extra,
});

const profile = (extra: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: "Carol",
  seasonId: 7,
  season: "Season 7",
  ranked: true,
  rank: 2,
  ratedPlayers: 3,
  rating: 1412,
  badge: 2,
  wins: 64,
  losses: 41,
  draws: 0,
  placementMatchesLeft: 0,
  games: [],
  ...extra,
});

interface Config {
  boards?: Record<string, Leaderboard | "down" | "missing">;
  seasons?: Season[];
  profile?: PlayerProfile | "missing";
}

/** A fake ladder server; `requests` records every path and query it was asked for. */
function ladderServer(config: Config) {
  const requests: string[] = [];
  const fetch = (async (input: URL | string) => {
    const url = new URL(String(input));
    requests.push(url.pathname + url.search);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.pathname === "/seasons") return json({ seasons: config.seasons ?? [] });
    if (url.pathname.startsWith("/leaderboard/")) {
      const [, , sku, , slug] = url.pathname.split("/");
      const answer = config.boards?.[`${sku}/${slug}`];
      if (answer === "down") return json({}, 500);
      if (!answer || answer === "missing") return json({ errorCode: "not_found" }, 404);
      const start = Number(url.searchParams.get("start"));
      const count = Number(url.searchParams.get("count"));
      return json({
        ...answer,
        records: answer.records.filter((r) => r.rank >= start && r.rank < start + count),
      });
    }
    if (url.pathname.startsWith("/players/")) {
      return config.profile && config.profile !== "missing"
        ? json(config.profile)
        : json({ errorCode: "not_found" }, 404);
    }
    return json({}, 404);
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

async function members(nick?: string) {
  const server = new FakeServer();
  const store = new AccountStore(
    new AccountClient({ baseUrl: "https://wol.test", fetch: server.fetch, locks: null }),
  );
  if (nick) {
    await store.register("carol", "secret-pass");
    await store.addGameAccount(nick, "game-pass-1");
  } else {
    await store.restore();
  }
  return store;
}

function show(
  store: AccountStore,
  fetch: typeof globalThis.fetch,
  edition: GameRecord | null = game("ra2md"),
) {
  render(
    <MemoryRouter>
      <LadderScreen edition={edition} store={store} fetch={fetch} baseUrl="https://ladder.test" />
    </MemoryRouter>,
  );
}

describe("LadderScreen", () => {
  it("lists the standings with the podium, rank titles and win rates", async () => {
    const { fetch, requests } = ladderServer({
      boards: {
        "18688/current": board([
          record(1, "Ada", 2184, { wins: 212, losses: 61, badge: 9 }),
          record(2, "Bob", 2121),
          record(3, "Cy", 2067, { wins: 0, losses: 0 }),
          record(4, "Dee", 1998),
        ]),
      },
    });
    show(await members(), fetch);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(5);
    const first = within(rows[1]!).getAllByRole("cell");
    expect(first[0]).toHaveTextContent("1");
    expect(first[0]).toHaveAttribute("data-podium", "1");
    expect(first[1]).toHaveTextContent("Ada, Commander-in-Chief");
    expect(first[2]).toHaveTextContent("2,184");
    expect(first[3]).toHaveTextContent("212 – 61");
    expect(first[4]).toHaveTextContent("78%");
    expect(within(rows[3]!).getAllByRole("cell")[4]).toHaveTextContent("—");
    expect(within(rows[4]!).getAllByRole("cell")[0]).not.toHaveAttribute("data-podium");
    // Yuri's Revenge is the rail's edition here: its SKU, the current season, the top hundred
    expect(requests).toContain("/leaderboard/18688/1v1/current?start=1&count=100");
    expect(screen.getByRole("radio", { name: "YURI’S REVENGE" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("asks a guest to sign in to see their rank", async () => {
    const { fetch, requests } = ladderServer({
      boards: { "18688/current": board([record(1, "Ada", 1500)]) },
    });
    show(await members(), fetch);
    await screen.findByRole("table");
    const panel = screen.getByRole("region", { name: "Your profile" });
    expect(within(panel).getByText("Sign in to see your rank.")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "SIGN IN" })).toHaveAttribute(
      "href",
      "/account",
    );
    expect(requests.some((path) => path.startsWith("/players/"))).toBe(false);
  });

  it("shows the signed-in player's standing, row and last ten matches", async () => {
    const games = [
      ...Array.from({ length: 7 }, (_, i) => ({
        gameId: `w${i}`,
        ended: i,
        won: true,
        resultType: 0,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        gameId: `l${i}`,
        ended: i,
        won: false,
        resultType: 1,
      })),
      { gameId: "old", ended: 0, won: true, resultType: 0 },
    ];
    const { fetch, requests } = ladderServer({
      boards: {
        "18688/current": board([
          record(1, "Ada", 2184),
          record(2, "Carol", 1412),
          record(3, "Cy", 1300),
        ]),
      },
      profile: profile({ games }),
    });
    show(await members("Carol"), fetch);
    const panel = screen.getByRole("region", { name: "Your profile" });
    expect(await within(panel).findByText("1,412")).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Carol" })).toBeInTheDocument();
    expect(within(panel).getByText("SERGEANT")).toBeInTheDocument();
    expect(within(panel).getByText("#2")).toBeInTheDocument();
    expect(within(panel).getByText("64 – 41")).toBeInTheDocument();
    expect(within(panel).getByText("61%")).toBeInTheDocument();
    expect(within(panel).getByRole("img", { name: "7 wins, 3 losses" })).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "EDIT PROFILE" })).toHaveAttribute(
      "href",
      "/account",
    );
    const mine = (await screen.findByRole("table")).querySelector("tr[data-me]");
    expect(mine).toHaveTextContent("Carol");
    expect(mine).toHaveAttribute("aria-current", "true");
    expect(requests).toContain("/players/Carol?sku=18688&ladderType=1v1");
  });

  it("signs out from the panel", async () => {
    const { fetch } = ladderServer({
      boards: { "18688/current": board([record(1, "Ada", 1500)]) },
      profile: profile(),
    });
    const store = await members("Carol");
    show(store, fetch);
    await userEvent.setup().click(await screen.findByRole("button", { name: "SIGN OUT" }));
    expect(await screen.findByText("Sign in to see your rank.")).toBeInTheDocument();
    expect(store.getState().status).toBe("guest");
  });

  it("says how many placement matches a player with no rank has left", async () => {
    const { fetch } = ladderServer({
      boards: { "18688/current": board([record(1, "Ada", 1500)]) },
      profile: profile({
        ranked: false,
        rank: null,
        badge: null,
        rating: 1000,
        wins: 0,
        losses: 0,
        placementMatchesLeft: 1,
      }),
    });
    show(await members("Carol"), fetch);
    expect(await screen.findByText("Play 1 more ranked match to get a rank.")).toBeInTheDocument();
    const panel = screen.getByRole("region", { name: "Your profile" });
    expect(within(panel).getByText("UNRANKED")).toBeInTheDocument();
    expect(within(panel).getByText("RANK").nextSibling).toHaveTextContent("—");
    expect(within(panel).getByText("No ranked matches yet.")).toBeInTheDocument();
  });

  it("copes with no season running for the player", async () => {
    const { fetch } = ladderServer({ profile: "missing" });
    show(await members("Carol"), fetch);
    expect(await screen.findByText("No ranked season is running yet.")).toBeInTheDocument();
  });

  it("fetches the rows around a player below the first hundred", async () => {
    const top = Array.from({ length: 100 }, (_, i) => record(i + 1, `P${i + 1}`, 2000 - i));
    const below = [
      record(127, "P127", 1415),
      record(128, "Carol", 1412),
      record(129, "P129", 1409),
    ];
    const { fetch, requests } = ladderServer({
      boards: { "18688/current": board([...top, ...below], { totalCount: 200 }) },
      profile: profile({ rank: 128, ratedPlayers: 200 }),
    });
    show(await members("Carol"), fetch);
    await waitFor(() => expect(document.querySelector("tr[data-me]")).toHaveTextContent("Carol"));
    expect(requests).toContain("/leaderboard/18688/1v1/current?start=127&count=3");
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(1 + 100 + 3);
    expect(document.querySelector("tr[aria-hidden]")).not.toBeNull();
    expect(screen.getByText("Showing the top 100 of 200 ranked players.")).toBeInTheDocument();
  });

  it("says when nobody is ranked this season", async () => {
    const { fetch } = ladderServer({ boards: { "18688/current": board([]) } });
    show(await members(), fetch);
    expect(await screen.findByText(/No ranked players this season yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says when no season exists at all", async () => {
    const { fetch } = ladderServer({});
    show(await members(), fetch);
    expect(await screen.findByText(/No ranked players this season yet/)).toBeInTheDocument();
  });

  it("shows loading, then an error with TRY AGAIN when the server is down", async () => {
    let up = false;
    const answers = ladderServer({ boards: { "18688/current": board([record(1, "Ada", 1500)]) } });
    const fetch = ((input: URL | string) =>
      up ? answers.fetch(input) : Promise.reject(new TypeError("down"))) as typeof globalThis.fetch;
    show(await members(), fetch);
    expect(screen.getByText("Loading the ladder…")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("The ladder cannot be reached");
    up = true;
    await userEvent.setup().click(screen.getByRole("button", { name: "TRY AGAIN" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("treats a server error as unreachable", async () => {
    const { fetch } = ladderServer({ boards: { "18688/current": "down" } });
    show(await members(), fetch);
    expect(await screen.findByRole("alert")).toHaveTextContent("The ladder cannot be reached");
  });

  it("switches the game and the season", async () => {
    const { fetch, requests } = ladderServer({
      seasons: [
        season(7, "current"),
        season(6, "prev"),
        season(5, "5"),
        season(8, "8", { status: "scheduled" }),
      ],
      boards: {
        "18688/current": board([record(1, "YuriFan", 1500)]),
        "18688/prev": board([record(1, "Old", 1400)], { season: "Season 6" }),
        "16640/current": board([record(1, "Allied1", 1600)]),
      },
    });
    show(await members(), fetch);
    const user = userEvent.setup();
    expect(await screen.findByText("YuriFan")).toBeInTheDocument();
    const picker = screen.getByRole("combobox", { name: "Season" });
    // newest first, the scheduled season is not offered
    expect(
      within(picker)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Season 7 (current)", "Season 6", "Season 5"]);
    await user.selectOptions(picker, "prev");
    expect(await screen.findByText("Old")).toBeInTheDocument();
    expect(requests).toContain("/leaderboard/18688/1v1/prev?start=1&count=100");

    await user.click(screen.getByRole("radio", { name: "RED ALERT 2" }));
    expect(await screen.findByText("Allied1")).toBeInTheDocument();
    expect(requests).toContain("/leaderboard/16640/1v1/current?start=1&count=100");
    expect(requests).toContain("/seasons?sku=16640");
    expect(screen.getByRole("combobox", { name: "Season" })).toHaveValue("current");
  });

  it("opens on the edition chosen in the rail and follows a change", async () => {
    const { fetch } = ladderServer({
      boards: {
        "16640/current": board([record(1, "Allied1", 1600)]),
        "18688/current": board([record(1, "YuriFan", 1500)]),
      },
    });
    const store = await members();
    const ui = (edition: GameRecord) => (
      <MemoryRouter>
        <LadderScreen edition={edition} store={store} fetch={fetch} baseUrl="https://ladder.test" />
      </MemoryRouter>
    );
    const { rerender } = render(ui(game("ra2")));
    expect(await screen.findByText("Allied1")).toBeInTheDocument();
    rerender(ui(game("ra2md")));
    expect(await screen.findByText("YuriFan")).toBeInTheDocument();
  });
});
