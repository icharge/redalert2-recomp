import { describe, expect, it, vi } from "vitest";
import {
  LadderLookup,
  LadderSession,
  ladderAnswer,
  parseLadderRequest,
  recordFromProfile,
  recordFromRung,
} from "./wol-ladder";

const placed = (name: string, rank: number, extra: object = {}) => ({
  name,
  rank,
  rankType: 3,
  points: 1459,
  wins: 24,
  losses: 2,
  placementMatchesLeft: 0,
  badgePoints: 201,
  ...extra,
});

type Body = { players: string[]; start: number };
function fetcher(handlers: Record<string, (body: Body) => unknown>, status = 200) {
  return vi.fn(async (url: URL, init?: RequestInit) => {
    const action = url.pathname.split("/").at(-1)!;
    const body = JSON.parse(String(init?.body));
    const result = handlers[action]?.(body);
    return {
      status: result === undefined ? 404 : status,
      ok: result !== undefined && status < 400,
      json: async () => result,
    } as Response;
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("ladder requests", () => {
  it("reads the shim's request lines", () => {
    expect(parseLadderRequest("@ladder list 4 16640 rkone,yuribot")).toEqual({
      kind: "list",
      id: 4,
      sku: 16640,
      names: ["rkone", "yuribot"],
      number: 0,
      leading: 0,
    });
    expect(parseLadderRequest("@ladder search 7 18688 20 5 rkone")).toMatchObject({
      kind: "search",
      names: ["rkone"],
      number: 20,
      leading: 5,
    });
    expect(parseLadderRequest("@ladder self 2 16640 rkone")?.kind).toBe("self");
    expect(parseLadderRequest("@ladder nope 1 1 x")).toBeNull();
    expect(parseLadderRequest("join #x")).toBeNull();
  });

  it("makes a record only of a placed player", () => {
    expect(recordFromProfile({ name: "new", placementMatchesLeft: 4 })).toBeNull();
    expect(recordFromProfile(placed("rkone", 1))).toEqual({
      name: "rkone",
      rank: 1,
      points: 1459,
      wins: 24,
      losses: 2,
      disconnects: 0,
      badgePoints: 201,
    });
    // a standings row has no badge: the rank type picks it
    expect(
      recordFromRung({ name: "x", rank: 9, rankType: 5, points: 1, wins: 1, losses: 1 }),
    ).toMatchObject({
      badgePoints: 601,
    });
  });

  it("writes the answer line the shim reads", () => {
    const line = ladderAnswer("list", 4, 0, [recordFromProfile(placed("rkone", 1))!]);
    expect(line).toBe("@wolapi ladder list 4 0 1 0 rkone|1|1459|24|2|0|201");
    expect(ladderAnswer("score", 5, 0x80004005, [])).toBe("@wolapi ladder score 5 2147500037 0 0");
  });
});

describe("LadderLookup", () => {
  const request = (names: string[], kind: "list" | "score" | "self" = "list") =>
    parseLadderRequest(`@ladder ${kind} 1 16640 ${names.join(",")}`)!;

  it("asks listsearch once for a batch and again for names it lacks", async () => {
    const fetch = fetcher({
      listsearch: (body) =>
        body.players.map((name: string) =>
          name === "rkone" ? placed("rkone", 1) : { name, placementMatchesLeft: 3 },
        ),
    });
    const lookup = new LadderLookup("http://x/", fetch, 1000);
    const first = await lookup.answer(request(["rkone", "newbie"]));
    expect(first).toBe("@wolapi ladder list 1 0 1 0 rkone|1|1459|24|2|0|201");
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = (fetch.mock.calls[0]![0] as URL).toString();
    expect(url).toBe("http://x/ladder/16640/1v1/current/listsearch");
    expect(JSON.parse(String((fetch.mock.calls[0]![1] as RequestInit).body))).toEqual({
      players: ["rkone", "newbie"],
      locale: "en",
    });
    // the high-score request for the same names costs nothing
    await lookup.answer(request(["rkone", "newbie"], "score"));
    expect(fetch).toHaveBeenCalledTimes(1);
    await lookup.answer(request(["rkone", "other"]));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetch.mock.calls[1]![1] as RequestInit).body)).players).toEqual([
      "other",
    ]);
  });

  it("forgets its records after a while, and a self request reads afresh", async () => {
    let now = 0;
    const fetch = fetcher({
      listsearch: (body) => body.players.map((name: string) => placed(name, 1)),
    });
    const lookup = new LadderLookup("http://x", fetch, 1000, () => now);
    await lookup.answer(request(["a"]));
    now = 10_000;
    await lookup.answer(request(["a"]));
    expect(fetch).toHaveBeenCalledTimes(1);
    await lookup.answer(request(["a"], "self"));
    expect(fetch).toHaveBeenCalledTimes(2);
    now = 40_000;
    await lookup.answer(request(["a"]));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("answers an unknown season as an empty ladder and a failure as E_FAIL", async () => {
    const none = new LadderLookup("http://x", fetcher({}), 1000);
    expect(await none.answer(request(["a"]))).toBe("@wolapi ladder list 1 0 0 0");
    const broken = new LadderLookup("http://x", fetcher({ listsearch: () => [] }, 500), 1000);
    expect(await broken.answer(request(["a"]))).toBe("@wolapi ladder list 1 2147500037 0 0");
  });

  it("searches around a name with rungsearch", async () => {
    const fetch = fetcher({
      listsearch: () => [placed("rktwo", 7)],
      rungsearch: (body) => ({
        totalCount: 40,
        records: [
          { name: "a", rank: body.start, points: 5, wins: 1, losses: 1, rankType: 1 },
          { name: "rktwo", rank: 7, points: 6, wins: 2, losses: 1, rankType: 1 },
        ],
      }),
    });
    const lookup = new LadderLookup("http://x", fetch, 1000);
    const answer = await lookup.answer(parseLadderRequest("@ladder search 3 16640 10 2 rktwo")!);
    expect(JSON.parse(String((fetch.mock.calls[1]![1] as RequestInit).body))).toEqual({
      ladderId: "1v1",
      start: 5,
      count: 10,
    });
    expect(
      answer.startsWith("@wolapi ladder search 3 0 40 7 a|5|5|1|1|0|0 rktwo|7|6|2|1|0|0"),
    ).toBe(true);
  });
});

describe("LadderSession", () => {
  it("delivers the high scores before the ladder records of the same names", async () => {
    const fetch = fetcher({
      listsearch: (body) => body.players.map((name: string) => placed(name, 1)),
    });
    const lines: string[] = [];
    const session = new LadderSession(new LadderLookup("http://x", fetch, 1000), (line) =>
      lines.push(line),
    );
    session.request(parseLadderRequest("@ladder list 1 16640 a,b")!);
    session.request(parseLadderRequest("@ladder score 2 16640 a,b")!);
    await vi.waitFor(() => expect(lines).toHaveLength(2));
    expect(lines[0]).toContain("ladder score 2");
    expect(lines[1]).toContain("ladder list 1");
    // a list nobody pairs still goes out
    session.request(parseLadderRequest("@ladder list 3 16640 c")!);
    await vi.waitFor(() => expect(lines).toHaveLength(3));
    expect(lines[2]).toContain("ladder list 3");
  });
});
