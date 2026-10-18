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

  it("ignores a malformed event instead of throwing", () => {
    expect(parseEventLine("@ra2 {not json")).toBeNull();
    expect(parseEventLine("@ra2 42")).toBeNull();
    expect(parseEventLine('@ra2 {"e":"mode","w":"800"}')).toBeNull();
    expect(parseEventLine('@ra2 {"e":"nonsense"}')).toBeNull();
    expect(parseEventLine('@ra2 {"e":"boot","protocol":1}')).toBeNull();
  });
});
