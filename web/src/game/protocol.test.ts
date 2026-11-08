import { describe, expect, it } from "vitest";
import { parseEventLine } from "./protocol";

describe("parseEventLine", () => {
  it("reads every event the game prints", () => {
    expect(
      parseEventLine('@ra2 {"e":"boot","protocol":1,"title":"Yuri","exe":"gamemd.exe","stamp":7}'),
    ).toEqual({
      e: "boot",
      protocol: 1,
      title: "Yuri",
      exe: "gamemd.exe",
      stamp: 7,
    });
    expect(parseEventLine('@ra2 {"e":"menu"}')).toEqual({ e: "menu" });
    expect(parseEventLine('@ra2 {"e":"mode","w":800,"h":600}')).toEqual({
      e: "mode",
      w: 800,
      h: 600,
    });
    expect(parseEventLine('@ra2 {"e":"fps","fps":30,"ms":33}')).toEqual({
      e: "fps",
      fps: 30,
      ms: 33,
      pacing: null,
    });
    expect(
      parseEventLine('@ra2 {"e":"fps","fps":60,"ms":16,"worst":24,"late":2,"pub":58,"pubms":3.25}'),
    ).toEqual({
      e: "fps",
      fps: 60,
      ms: 16,
      pacing: { worstMs: 24, late: 2, published: 58, publishMs: 3.25 },
    });
    expect(parseEventLine('@ra2 {"e":"exit","code":0}')).toEqual({ e: "exit", code: 0 });
    expect(parseEventLine('@ra2 {"e":"exitConfirm","request":123}')).toEqual({
      e: "exitConfirm",
      request: 123,
    });
    expect(parseEventLine('@ra2 {"e":"settingsSaved","path":"/opfs/game/RA2MD.INI"}')).toEqual({
      e: "settingsSaved",
      path: "/opfs/game/RA2MD.INI",
    });
    expect(
      parseEventLine('@ra2 {"e":"open","url":"http://privacypolicy.westwood.com","ask":0,"seq":2}'),
    ).toEqual({
      e: "open",
      url: "http://privacypolicy.westwood.com",
      ask: 0,
      seq: 2,
    });
    expect(parseEventLine('@ra2 {"e":"open","url":"","page":"News","ask":0,"seq":3}')).toEqual({
      e: "open",
      url: "",
      page: "News",
      ask: 0,
      seq: 3,
    });
    expect(parseEventLine('@ra2 {"e":"error","message":"no gamemd.exe in /game"}')).toEqual({
      e: "error",
      message: "no gamemd.exe in /game",
    });
  });

  it("ignores every other line", () => {
    expect(parseEventLine("[dialog] open 0xE2")).toBeNull();
    expect(parseEventLine("")).toBeNull();
    expect(parseEventLine("@ra2")).toBeNull();
  });

  it("parses the map search's status: the list's place and whether nothing matched", () => {
    expect(
      parseEventLine(
        '@ra2 {"e":"mapSearch","open":true,"noMatches":true,"x":332,"y":209,"w":177,"h":241}',
      ),
    ).toEqual({ e: "mapSearch", open: true, noMatches: true, x: 332, y: 209, w: 177, h: 241 });
    expect(parseEventLine('@ra2 {"e":"mapSearch","open":true,"noMatches":false}')).toBeNull();
    expect(
      parseEventLine('@ra2 {"e":"mapSearch","open":1,"noMatches":false,"x":0,"y":0,"w":0,"h":0}'),
    ).toBeNull();
  });

  it("parses the Find Maps button's press", () => {
    expect(parseEventLine('@ra2 {"e":"mapFinder"}')).toEqual({ e: "mapFinder" });
  });

  it("ignores a malformed event instead of throwing", () => {
    expect(parseEventLine("@ra2 {not json")).toBeNull();
    expect(parseEventLine("@ra2 42")).toBeNull();
    expect(parseEventLine('@ra2 {"e":"mode","w":"800"}')).toBeNull();
    expect(parseEventLine('@ra2 {"e":"nonsense"}')).toBeNull();
    expect(parseEventLine('@ra2 {"e":"exitConfirm","request":0}')).toBeNull();
    for (const request of [-1, 1.5, 0x100000000, "123", null])
      expect(parseEventLine(`@ra2 ${JSON.stringify({ e: "exitConfirm", request })}`)).toBeNull();
    expect(parseEventLine('@ra2 {"e":"exitConfirm","hwnd":123}')).toBeNull();
    expect(parseEventLine('@ra2 {"e":"boot","protocol":1}')).toBeNull();
    expect(parseEventLine('@ra2 {"e":"settingsSaved"}')).toBeNull();
    expect(parseEventLine('@ra2 {"e":"open"}')).toBeNull();
    expect(parseEventLine('@ra2 {"e":"open","url":1,"ask":0,"seq":2}')).toBeNull();
    expect(parseEventLine('@ra2 {"e":"open","url":"","page":1,"ask":0,"seq":2}')).toBeNull();
  });
});
