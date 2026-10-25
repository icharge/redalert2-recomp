// Tests for perf-report.mjs (the pure summary and comparison of perf.mjs runs).
//
//   cd web && node --test e2e/perf-report.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, summarize } from "./perf-report.mjs";

/** A sample with every field null except the ones given. */
const sample = (fields) => ({
  fps: 60,
  worstMs: null,
  late: null,
  publishMs: null,
  drawMs: null,
  cpuPct: null,
  wasmBytes: 100,
  jsHeapBytes: null,
  textureBytes: null,
  ...fields,
});

const row = (rows, measure) => rows.find((r) => r.measure === measure);

test("fps1Low is the 1st percentile", () => {
  const samples = Array.from({ length: 100 }, (_, i) => sample({ fps: i + 1 }));
  const s = summarize(samples);
  assert.equal(s.fps1Low, 1);
  assert.equal(s.fpsMedian, 50);
});

test("worst gap is the max of worstMs", () => {
  const samples = [10, 40, 12].map((worstMs) => sample({ worstMs }));
  assert.equal(summarize(samples).worstGapMs, 40);
});

test("wasm growth counts only after the first 60 samples", () => {
  const samples = [];
  for (let i = 0; i < 60; i++) samples.push(sample({ wasmBytes: 100 }));
  samples.push(sample({ wasmBytes: 100 }), sample({ wasmBytes: 100 }), sample({ wasmBytes: 120 }));
  const s = summarize(samples);
  assert.equal(s.wasmGrowthAfter60s, 20);
  assert.equal(s.wasmPeakBytes, 120);
});

test("wasm growth is null for a run shorter than 61 samples", () => {
  const samples = Array.from({ length: 30 }, () => sample({ wasmBytes: 100 }));
  assert.equal(summarize(samples).wasmGrowthAfter60s, null);
});

test("null-valued samples are ignored in medians", () => {
  const samples = [null, 2, null, 4, 6].map((publishMs) => sample({ publishMs }));
  assert.equal(summarize(samples).publishMsMedian, 4);
  const none = [sample({ cpuPct: null })];
  assert.equal(summarize(none).cpuPctMedian, null);
});

test("compare marks the fps bar", () => {
  const busy = { fpsMedian: 59, fps1Low: 56 };
  const run = {
    date: "2026-10-26",
    build: "test",
    cases: { "1920x1080/hd-on/busy": { ...empty(), ...busy } },
  };
  const base = { date: "x", build: "base", cases: { "1920x1080/hd-on/busy": empty() } };
  assert.equal(row(compare(run, base), "fpsMedian").pass, false);

  run.cases["1920x1080/hd-on/busy"] = { ...empty(), fpsMedian: 60, fps1Low: 55 };
  const rows = compare(run, base);
  assert.equal(row(rows, "fpsMedian").pass, true);
  assert.equal(row(rows, "fps1Low").pass, true);
});

test("compare marks idle CPU at -40%", () => {
  const base = {
    date: "x",
    build: "base",
    cases: { "menu/idle": { ...empty(), cpuPctMedian: 100 } },
  };
  const run = { date: "y", build: "now", cases: { "menu/idle": { ...empty(), cpuPctMedian: 61 } } };
  assert.equal(row(compare(run, base), "cpuPctMedian").pass, false);
  run.cases["menu/idle"].cpuPctMedian = 60;
  assert.equal(row(compare(run, base), "cpuPctMedian").pass, true);
});

test("compare gives change as a fraction and null pass for measures without a bar", () => {
  const base = {
    date: "x",
    build: "base",
    cases: { "1280x720/hd-off/early": { ...empty(), wasmPeakBytes: 200 } },
  };
  const run = {
    date: "y",
    build: "now",
    cases: { "1280x720/hd-off/early": { ...empty(), wasmPeakBytes: 150 } },
  };
  const r = row(compare(run, base), "wasmPeakBytes");
  assert.equal(r.change, -0.25);
  assert.equal(r.pass, null);
});

test("compare reports a missing baseline case as null rows", () => {
  const run = {
    date: "y",
    build: "now",
    cases: { "3840x2160/hd-on/busy": { ...empty(), fpsMedian: 30 } },
  };
  const base = { date: "x", build: "base", cases: {} };
  const r = row(compare(run, base), "fpsMedian");
  assert.equal(r.baseline, null);
  assert.equal(r.change, null);
  assert.equal(r.pass, null);
});

/** A CaseSummary with every measure null. */
function empty() {
  return {
    fpsMedian: null,
    fps1Low: null,
    worstGapMs: null,
    late: null,
    publishMsMedian: null,
    drawMsMedian: null,
    cpuPctMedian: null,
    wasmPeakBytes: null,
    wasmGrowthAfter60s: null,
    jsHeapGrowthBytes: null,
  };
}

test("a 4K case has no pass verdict on any measure", () => {
  const base = {
    date: "x",
    build: "base",
    cases: { "3840x2160/hd-on/busy": { ...empty(), fpsMedian: 60, cpuPctMedian: 300 } },
  };
  const run = {
    date: "y",
    build: "now",
    cases: {
      "3840x2160/hd-on/busy": {
        ...empty(),
        fpsMedian: 90,
        fps1Low: 80,
        worstGapMs: 10,
        drawMsMedian: 1,
        cpuPctMedian: 100,
      },
    },
  };
  for (const r of compare(run, base)) assert.equal(r.pass, null, r.measure);
});

test("in a match, lower CPU with fps down by more than 1 fails the CPU bar", () => {
  const base = {
    date: "x",
    build: "base",
    cases: { "1920x1080/hd-off/early": { ...empty(), fpsMedian: 60, cpuPctMedian: 250 } },
  };
  const run = {
    date: "y",
    build: "now",
    cases: { "1920x1080/hd-off/early": { ...empty(), fpsMedian: 58, cpuPctMedian: 200 } },
  };
  assert.equal(row(compare(run, base), "cpuPctMedian").pass, false);
});

test("in a match, lower CPU at the same fps passes the CPU bar", () => {
  const base = {
    date: "x",
    build: "base",
    cases: { "1920x1080/hd-off/early": { ...empty(), fpsMedian: 60, cpuPctMedian: 250 } },
  };
  const run = {
    date: "y",
    build: "now",
    cases: { "1920x1080/hd-off/early": { ...empty(), fpsMedian: 60, cpuPctMedian: 200 } },
  };
  assert.equal(row(compare(run, base), "cpuPctMedian").pass, true);
});

test("in a match, a fps drop of exactly 1 still passes; more CPU fails", () => {
  const base = {
    date: "x",
    build: "base",
    cases: { "1920x1080/hd-off/early": { ...empty(), fpsMedian: 60, cpuPctMedian: 250 } },
  };
  const ok = {
    date: "y",
    build: "now",
    cases: { "1920x1080/hd-off/early": { ...empty(), fpsMedian: 59, cpuPctMedian: 240 } },
  };
  assert.equal(row(compare(ok, base), "cpuPctMedian").pass, true);
  const more = {
    date: "y",
    build: "now",
    cases: { "1920x1080/hd-off/early": { ...empty(), fpsMedian: 60, cpuPctMedian: 260 } },
  };
  assert.equal(row(compare(more, base), "cpuPctMedian").pass, false);
});
