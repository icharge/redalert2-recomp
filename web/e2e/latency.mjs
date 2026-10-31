// Summarise the command delay of a WOL match from its two game.log files.
//
//   node e2e/latency.mjs ../work/wol-latency-slow
//
// Prints { host, guest } with the values the game logged: whether ping times
// were available, the Precalc MaxAhead, the MaxAhead series, response times and
// the frame samples, plus the [net] command-delay profile and its late-packet
// bumps. Read the logs as latin1: the game writes non-UTF-8 bytes into them.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NET_PROFILE =
  /\[net\] WOL command delay: max ping (-?\d+) ms, MaxAhead (\d+) -> (\d+) frames \((\d+) ms at (\d+) fps\), sending every (\d+) frames/;
const NET_BUMP = /\[net\] .* at frame \d+: MaxAhead (\d+) -> (\d+) frames \((\d+) ms\)/;

export function summarizeGameLog(text) {
  let sawPingTimes = false;
  let maxPingMs = null;
  let precalcMaxAhead = null;
  let frameSendRate = null;
  const maxAhead = [];
  const responseTimes = [];
  let worstFrameMs = 0;
  let slowFrames = 0;
  let tuned = null;
  let bumps = 0;
  let lastBumpFrames = null;

  for (const line of text.split(/\r?\n/)) {
    const maxPing = /Max ping is (\d+) ms/.exec(line);
    if (maxPing) {
      sawPingTimes = true;
      maxPingMs = Number(maxPing[1]);
    }
    const precalc = /PrecalcMaxAhead is (\d+)/.exec(line);
    if (precalc) precalcMaxAhead = Number(precalc[1]);
    const rate = /FrameSendRate is (\d+)/.exec(line);
    if (rate) frameSendRate = Number(rate[1]);
    const ahead = /^(?:\[game\] )?MaxAhead is (\d+)/.exec(line);
    if (ahead) maxAhead.push(Number(ahead[1]));
    const response = /Response time = (\d+)/.exec(line);
    if (response) responseTimes.push(Number(response[1]));
    const profile = NET_PROFILE.exec(line);
    if (profile) {
      tuned = {
        pingMs: Number(profile[1]),
        from: Number(profile[2]),
        maxAhead: Number(profile[3]),
        delayMs: Number(profile[4]),
        fps: Number(profile[5]),
        sendRate: Number(profile[6]),
      };
    }
    const bump = NET_BUMP.exec(line);
    if (bump) {
      bumps++;
      lastBumpFrames = Number(bump[3]);
    }
    if (line.startsWith("@ra2 ")) {
      try {
        const event = JSON.parse(line.slice(5));
        if (event.e === "fps") {
          const worst = Number(event.worst) || 0;
          if (worst > worstFrameMs) worstFrameMs = worst;
          if (worst > 100) slowFrames++;
        }
      } catch {
        // A torn or non-JSON line is not a sample.
      }
    }
  }
  if (tuned) tuned.bumps = bumps;
  if (tuned) tuned.lastBumpDelayMs = lastBumpFrames;
  return {
    pingTimesAvailable: sawPingTimes,
    maxPingMs,
    precalcMaxAhead,
    frameSendRate,
    maxAhead,
    responseTimes,
    worstFrameMs,
    slowFrames,
    tuned,
  };
}

export function summarizeShots(dir) {
  const read = (client) => summarizeGameLog(readFileSync(join(dir, client, "game.log"), "latin1"));
  return { host: read("host"), guest: read("guest") };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node e2e/latency.mjs <shots-dir>");
    process.exit(2);
  }
  console.log(JSON.stringify(summarizeShots(dir), null, 2));
}
