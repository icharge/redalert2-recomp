import { describe, expect, it, vi } from "vitest";
import { RA2_WEB_PROTOCOL } from "./protocol";
import { GameStore, LOG_LINES } from "./store";

const boot = (protocol = RA2_WEB_PROTOCOL) =>
  `@ra2 {"e":"boot","protocol":${protocol},"title":"Yuri's Revenge","exe":"gamemd.exe","stamp":1}`;

describe("GameStore", () => {
  it("starts idle", () => {
    expect(new GameStore().getSnapshot().phase).toBe("idle");
  });

  it("goes loading, booting, running as the game says so", () => {
    const store = new GameStore();
    store.begin();
    expect(store.getSnapshot()).toMatchObject({ phase: "loading", loading: "the game" });
    store.loading("ra2.mix (2 of 40)");
    expect(store.getSnapshot().loading).toBe("ra2.mix (2 of 40)");
    store.line(boot());
    expect(store.getSnapshot()).toMatchObject({
      phase: "booting",
      title: "Yuri's Revenge",
      loading: null,
    });
    store.line('@ra2 {"e":"mode","w":800,"h":600}');
    expect(store.getSnapshot().size).toEqual({ w: 800, h: 600 });
    store.line('@ra2 {"e":"menu"}');
    expect(store.getSnapshot().phase).toBe("running");
    store.line('@ra2 {"e":"fps","fps":29,"ms":34}');
    expect(store.getSnapshot()).toMatchObject({ fps: 29, ms: 34 });
  });

  it("keeps the copy's progress until the game boots", () => {
    const store = new GameStore();
    store.begin();
    store.copying({ doneBytes: 5, totalBytes: 10, doneFiles: 1, totalFiles: 2, file: "a.mix" });
    expect(store.getSnapshot()).toMatchObject({
      phase: "loading",
      loading: "a.mix (1 of 2)",
      copy: { doneBytes: 5, totalBytes: 10 },
    });
    store.line(boot());
    expect(store.getSnapshot().copy).toBeNull();
  });

  it("clears completed file-copy progress when game startup begins", () => {
    const store = new GameStore();
    store.begin();
    store.copying({
      doneBytes: 99,
      totalBytes: 100,
      doneFiles: 25,
      totalFiles: 26,
      file: "wolinfo.ini",
    });

    store.loading("the game");

    expect(store.getSnapshot()).toMatchObject({
      phase: "loading",
      loading: "the game",
      copy: null,
    });
  });

  it("exits with the code", () => {
    const store = new GameStore();
    store.begin();
    store.line(boot());
    store.line('@ra2 {"e":"exit","code":3}');
    expect(store.getSnapshot()).toMatchObject({ phase: "exited", exitCode: 3 });
  });

  it("keeps the game open while a page confirmation is pending and clears only the matching reply", () => {
    const store = new GameStore();
    store.begin();
    store.line(boot());
    store.line('@ra2 {"e":"menu"}');
    store.line('@ra2 {"e":"exitConfirm","request":123}');
    expect(store.getSnapshot()).toMatchObject({
      phase: "running",
      exitConfirmation: { request: 123 },
    });
    store.resolveExitConfirmation(456);
    expect(store.getSnapshot().exitConfirmation).toEqual({ request: 123 });
    store.resolveExitConfirmation(123);
    expect(store.getSnapshot().exitConfirmation).toBeNull();
  });

  it("can crash from any phase, and an exit afterwards does not hide it", () => {
    for (const setup of [
      (s: GameStore) => s.begin(),
      (s: GameStore) => {
        s.begin();
        s.line(boot());
      },
      (s: GameStore) => {
        s.begin();
        s.line(boot());
        s.line('@ra2 {"e":"menu"}');
      },
    ]) {
      const store = new GameStore();
      setup(store);
      store.crashed("wasm trap");
      expect(store.getSnapshot()).toMatchObject({ phase: "crashed", error: "wasm trap" });
      store.line('@ra2 {"e":"exit","code":3}');
      expect(store.getSnapshot().phase).toBe("crashed");
    }
  });

  it("dismisses a pending confirmation if the game exits or crashes", () => {
    for (const finish of [
      (s: GameStore) => s.line('@ra2 {"e":"exit","code":0}'),
      (s: GameStore) => s.crashed("wasm trap"),
    ]) {
      const store = new GameStore();
      store.begin();
      store.line(boot());
      store.line('@ra2 {"e":"menu"}');
      store.line('@ra2 {"e":"exitConfirm","request":123}');
      finish(store);
      expect(store.getSnapshot().exitConfirmation).toBeNull();
    }
  });

  it("shows an error event without ending the game", () => {
    const store = new GameStore();
    store.begin();
    store.line('@ra2 {"e":"error","message":"no gamemd.exe in /game"}');
    expect(store.getSnapshot()).toMatchObject({
      phase: "loading",
      error: "no gamemd.exe in /game",
    });
  });

  it("refuses a game that speaks another protocol", () => {
    const store = new GameStore();
    store.begin();
    store.line(boot(RA2_WEB_PROTOCOL + 1));
    const state = store.getSnapshot();
    expect(state.phase).toBe("crashed");
    expect(state.error).toMatch(/stale copy/);
  });

  it("clears the last run on begin", () => {
    const store = new GameStore();
    store.begin();
    store.line("a line");
    store.crashed("oops");
    store.begin();
    expect(store.getSnapshot()).toMatchObject({ phase: "loading", error: null });
    expect(store.getLog()).toEqual([]);
  });

  it("keeps the last lines of the log, and tells listeners only about events", () => {
    const store = new GameStore();
    const listener = vi.fn();
    store.subscribe(listener);
    for (let i = 0; i < LOG_LINES + 10; i++) store.line(`line ${i}`);
    expect(store.getLog()).toHaveLength(LOG_LINES);
    expect(store.getLog()[0]).toBe("line 10");
    expect(listener).not.toHaveBeenCalled();
    store.line('@ra2 {"e":"menu"}');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops telling a listener that unsubscribed", () => {
    const store = new GameStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.crashed("x");
    expect(listener).not.toHaveBeenCalled();
  });
});
