import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gameUrl,
  isMenuShellPicture,
  busySkirmishLayoutFor,
  prepareEarlySkirmish,
  enterSinglePlayerAtSize,
  waitForEarlyBattle,
  RESOLUTIONS,
  resolveSoakSize,
  setResolution,
  SOAK_HD,
} from "./perf-nav.mjs";
import * as perfNav from "./perf-nav.mjs";

test("uses the requested game edition while preserving presenter query options", () => {
  const base = { url: "http://127.0.0.1:5173/?presenter=2d", edition: "ra2" };
  const url = new URL(gameUrl(base, "1920x1080"));

  assert.equal(url.pathname, "/game/1");
  assert.equal(url.searchParams.get("edition"), "ra2");
  assert.equal(url.searchParams.get("video"), "1920x1080");
  assert.equal(url.searchParams.get("presenter"), "2d");
});

test("uses RA2's eight-player map and player-row layout", () => {
  const layout = busySkirmishLayoutFor("ra2");

  assert.deepEqual(layout.mapListDown, [599, 500]);
  assert.deepEqual(layout.mapSelection, [410, 196]);
  assert.deepEqual(
    layout.playerArrows,
    [115, 141, 167, 193, 219, 245, 271].map((y) => [274, y]),
  );
  assert.equal(layout.aiDifficultyX, 160);
  assert.equal(layout.teamArrowX, null);
  assert.deepEqual(layout.shortGameToggle, [140, 305]);
  assert.deepEqual(layout.gameSpeedLeft, [406, 305]);
  assert.deepEqual(layout.gameSpeedFive, [462, 305]);
});

test("keeps Yuri's Revenge on its existing busy-skirmish layout", () => {
  const layout = busySkirmishLayoutFor("ra2md");

  assert.deepEqual(layout.mapListDown, [524, 462]);
  assert.deepEqual(layout.mapSelection, [411, 459]);
  assert.deepEqual(
    layout.playerArrows,
    [95, 121, 147, 173, 199, 226, 252].map((y) => [199, y]),
  );
  assert.equal(layout.aiDifficultyX, null);
  assert.equal(layout.teamArrowX, 574);
  assert.deepEqual(layout.shortGameToggle, [80, 296]);
  assert.deepEqual(layout.gameSpeedLeft, [406, 296]);
  assert.deepEqual(layout.gameSpeedFive, [462, 296]);
});

test("prepares RA2 early cases on a two-player map with one Brutal AI", async () => {
  const calls = [];
  const t = {
    edition: "ra2",
    clickGame: async (...point) => calls.push(point),
    page: { waitForTimeout: async () => {} },
  };

  await prepareEarlySkirmish(t);

  assert.deepEqual(calls[0], [719, 304]); // Customize Battle
  assert.equal(calls.filter(([x, y]) => x === 599 && y === 258).length, 30);
  assert.deepEqual(calls[31], [410, 196]); // Little Big Lake (2)
  assert.deepEqual(calls[32], [719, 220]); // Use Map
  assert.deepEqual(calls[33], [274, 115]); // player 2
  assert.deepEqual(calls[34], [160, 207]); // Brutal Enemy
  assert.deepEqual(calls.slice(-2), [
    [406, 305],
    [462, 305],
  ]); // speed 5
});

test("sets the game's resolution to 4K", async () => {
  const calls = [];
  const state = [
    { settings: { width: 1920, height: 1080 } },
    { settings: { width: 3840, height: 2160 } },
  ];
  const t = {
    state: async () => state.shift(),
    page: {
      evaluate: async (_fn, args) => calls.push(args),
      waitForTimeout: async () => {},
    },
  };

  await setResolution(t, { w: 3840, h: 2160 });

  assert.deepEqual(calls, [[3840, 2160]]);
  assert.equal(state.length, 0, "waits until the settings event reflects the requested resolution");
});

test("enters Single Player before setting RA2's next battle resolution", async () => {
  const calls = [];
  const settings = { width: 800, height: 600 };
  const t = {
    clickGame: async (...point) => calls.push(["click", ...point]),
    state: async () => ({ phase: "running", settings }),
    page: {
      evaluate: async (_fn, [w, h]) => {
        calls.push(["resolution", w, h]);
        settings.width = w;
        settings.height = h;
      },
      waitForTimeout: async () => {},
    },
  };

  await enterSinglePlayerAtSize(t, { w: 2560, h: 1440 });

  assert.deepEqual(calls, [
    ["click", 719, 221],
    ["resolution", 2560, 1440],
  ]);
});

test("waits for requested-size frames without requiring FPS telemetry", async () => {
  assert.equal(typeof perfNav.waitForBattle, "function");
  const state = { phase: "running", size: { w: 1280, h: 720 }, fps: null };
  const frameSequences = [10, 10, 12, 14, 16];
  const t = {
    state: async () => state,
    page: {
      evaluate: async () => frameSequences.shift(),
      waitForTimeout: async () => {},
    },
    fail: async (message) => {
      throw new Error(message);
    },
  };

  assert.deepEqual(await perfNav.waitForBattle(t, { w: 1280, h: 720 }, 1), state);
  assert.equal(frameSequences.length, 0);
});

test("early battles use advancing frames rather than FPS telemetry as the ready signal", async () => {
  const state = { phase: "running", size: { w: 1280, h: 720 }, fps: 0 };
  const sequences = [1, 2, 3, 4];
  const t = {
    state: async () => state,
    page: {
      evaluate: async () => sequences.shift(),
      waitForTimeout: async () => {},
    },
    fail: async (message) => {
      throw new Error(message);
    },
  };

  assert.deepEqual(await waitForEarlyBattle(t, { w: 1280, h: 720 }), state);
  assert.equal(sequences.length, 0);
});

test("keeps existing resolutions and continues rejecting unlisted modes", async () => {
  assert(RESOLUTIONS.some(([w, h]) => w === 2560 && h === 1440));
  const t = { page: { evaluate: async () => assert.fail("unsupported resolution reached game") } };

  await assert.rejects(() => setResolution(t, { w: 3840, h: 1600 }), /does not accept this size/);
});

test("defaults the soak to 1440p and keys an explicit 4K soak by its requested size", () => {
  assert.equal(SOAK_HD, false);
  assert.deepEqual(resolveSoakSize(), {
    video: "2560x1440",
    caseKey: "soak/2560x1440/hd-off/busy",
  });
  assert.deepEqual(resolveSoakSize("3840x2160"), {
    video: "3840x2160",
    caseKey: "soak/3840x2160/hd-off/busy",
  });
  assert.throws(() => resolveSoakSize("3200x1800"), /--soak-size 3200x1800/);
});

test("recognizes the 800x600 menu shell when a larger-resolution soak reaches the menu", () => {
  assert.equal(isMenuShellPicture({ w: 2560, h: 1440 }, "800x600"), true);
  assert.equal(isMenuShellPicture({ w: 3840, h: 2160 }, "800x600"), true);
  assert.equal(isMenuShellPicture({ w: 800, h: 600 }, "800x600"), false);
  assert.equal(isMenuShellPicture({ w: 2560, h: 1440 }, "1024x768"), false);
  assert.equal(isMenuShellPicture({ w: 2560, h: 1440 }, null), false);
});
