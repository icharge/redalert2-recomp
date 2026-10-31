import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeGameLog } from "./latency.mjs";

test("summarizes a match without ping times", () => {
  const log = [
    "[game] Ping times not available - Using defaults",
    "[game] PrecalcMaxAhead is 40",
    "[game] FrameSendRate is 10",
    "[game] Response time = 3",
    "[game] MaxAhead is 40",
    "[game] MaxAhead is 30",
    '@ra2 {"e":"fps","fps":43,"ms":23,"worst":311,"late":10,"pub":4,"pubms":0.16}',
    '@ra2 {"e":"fps","fps":54,"ms":18,"worst":28,"late":6,"pub":62,"pubms":0.17}',
  ].join("\n");
  assert.deepEqual(summarizeGameLog(log), {
    pingTimesAvailable: false,
    maxPingMs: null,
    precalcMaxAhead: 40,
    frameSendRate: 10,
    maxAhead: [40, 30],
    responseTimes: [3],
    worstFrameMs: 311,
    slowFrames: 1,
    tuned: null,
  });
});

test("reads the max ping when the game has ping times", () => {
  const summary = summarizeGameLog("[game] Max ping is 84 ms\n[game] PrecalcMaxAhead is 20");
  assert.equal(summary.pingTimesAvailable, true);
  assert.equal(summary.maxPingMs, 84);
  assert.equal(summary.precalcMaxAhead, 20);
});

test("reads the tuned profile and its bumps", () => {
  const log = [
    "[net] WOL command delay: max ping 60 ms, MaxAhead 40 -> 5 frames (83 ms at 60 fps), sending every 2 frames",
    "[game] MaxAhead is 5",
    "[game] MaxAhead is 5",
    "[net] late packet at frame 600: MaxAhead 5 -> 6 frames (100 ms)",
    "[game] MaxAhead is 6",
  ].join("\n");
  const summary = summarizeGameLog(log);
  assert.deepEqual(summary.tuned, {
    pingMs: 60,
    from: 40,
    maxAhead: 5,
    delayMs: 83,
    fps: 60,
    sendRate: 2,
    bumps: 1,
    lastBumpDelayMs: 100,
  });
  assert.deepEqual(summary.maxAhead, [5, 5, 6]);
});
