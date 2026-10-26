// Summaries and comparisons for perf.mjs's runs (docs/superpowers/specs/2026-10-26-web-frame-performance-design.md,
// section 1). Pure functions: no I/O, no browser.
//
//   import { summarize, compare } from "./perf-report.mjs";
//
// A case is keyed "WxH/hd-on|hd-off/early|busy", "menu/idle", or "soak/WxH/hd-on/busy".

/** The samples are one a second; the first minute is the warm-up for the memory measures. */
const WARM_SAMPLES = 60;

/** Numbers only: null, undefined and NaN are left out. */
const numbers = (values) => values.filter((v) => typeof v === "number" && Number.isFinite(v));

/**
 * The median, taking the lower of the two middle values for an even count (so the median of
 * 1..100 is 50). null when there is nothing to take it from.
 */
function median(values) {
  const sorted = numbers(values).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
}

/** Nearest-rank percentile: the value at or below which p percent of the samples lie. */
function percentile(values, p) {
  const sorted = numbers(values).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

const max = (values) => {
  const n = numbers(values);
  return n.length ? Math.max(...n) : null;
};

const sum = (values) => {
  const n = numbers(values);
  return n.length ? n.reduce((a, b) => a + b, 0) : null;
};

/**
 * One case's measures, from its per-second samples.
 *
 * @param {Array<{fps:number, worstMs:number|null, late:number|null, publishMs:number|null,
 *   drawMs:number|null, cpuPct:number|null, wasmBytes:number, jsHeapBytes:number|null,
 *   textureBytes:number|null, published?:number|null}>} samples
 */
export function summarize(samples) {
  const f = (key) => samples.map((s) => s[key]);
  const wasm = numbers(f("wasmBytes"));
  // growth is measured from the first minute's end; memory in wasm never shrinks, so the peak is what counts
  let wasmGrowthAfter60s = null;
  let jsHeapGrowthBytes = null;
  if (samples.length > WARM_SAMPLES) {
    const base = samples[WARM_SAMPLES - 1];
    const later = samples.slice(WARM_SAMPLES);
    const peak = max(later.map((s) => s.wasmBytes));
    if (base && typeof base.wasmBytes === "number" && peak !== null)
      wasmGrowthAfter60s = Math.max(0, peak - base.wasmBytes);
    const heapLater = numbers(later.map((s) => s.jsHeapBytes));
    const heapBase = base?.jsHeapBytes;
    if (heapLater.length && typeof heapBase === "number")
      jsHeapGrowthBytes = heapLater[heapLater.length - 1] - heapBase;
  }
  // seconds in which the game ran but the page was handed no picture (pacing.published, pictures a second): a
  // frozen picture. null when the samples do not say.
  const published = samples.filter((s) => typeof s.published === "number");
  const noPictureSeconds = published.length
    ? published.filter((s) => s.published === 0 && s.fps > 0).length
    : null;
  return {
    fpsMedian: median(f("fps")),
    fps1Low: percentile(f("fps"), 1),
    worstGapMs: max(f("worstMs")),
    late: sum(f("late")),
    publishMsMedian: median(f("publishMs")),
    drawMsMedian: median(f("drawMs")),
    cpuPctMedian: median(f("cpuPct")),
    wasmPeakBytes: wasm.length ? Math.max(...wasm) : null,
    wasmGrowthAfter60s,
    jsHeapGrowthBytes,
    noPictureSeconds,
  };
}

/** The measures, in the order they are printed. */
export const MEASURES = [
  "fpsMedian",
  "fps1Low",
  "worstGapMs",
  "late",
  "publishMsMedian",
  "drawMsMedian",
  "cpuPctMedian",
  "wasmPeakBytes",
  "wasmGrowthAfter60s",
  "jsHeapGrowthBytes",
];

/** The sizes the pass bar covers (720p to 1440p); 4K is recorded with no target. */
const TARGET_SIZES = new Set(["1280x720", "1920x1080", "2560x1440"]);

/**
 * The pass bar for one measure of one case, or null when the bar does not cover it (or there is no
 * baseline to hold it against). `now` and `base` are the case's value in this run and the baseline's;
 * `nowCase` and `baseCase` are the whole case summaries, for the rules that compare two measures.
 *
 * drawMsMedian is the page's upload and draw per animation frame (Presenter.draw); publishMsMedian is
 * the game thread's publish. The Main-thread bar applies to the first.
 */
function bar(key, measure, now, base, nowCase, baseCase) {
  const isMenu = key === "menu/idle";
  const isSoak = key.startsWith("soak/");
  const [size, hd, moment] = (isSoak ? key.slice("soak/".length) : key).split("/");
  // 4K is recorded, with no target and no verdict
  if (size === "3840x2160") return null;
  const target = TARGET_SIZES.has(size) && !isSoak;
  const busyHd = target && hd === "hd-on" && moment === "busy";
  switch (measure) {
    case "fpsMedian":
      return busyHd ? now >= 60 : null;
    case "fps1Low":
      return busyHd ? now >= 55 : null;
    case "worstGapMs":
      return target ? now <= 33 : null;
    case "drawMsMedian":
      return target ? now <= 4 : null;
    case "cpuPctMedian": {
      if (base === null) return null;
      // idle in the menu: at least 40% below the baseline
      if (isMenu) return now <= base * 0.6 + 1e-9;
      // in a match: no higher than the baseline, and the frame rate not down by more than 1 fps
      if (isSoak) return null;
      const fpsNow = nowCase?.fpsMedian ?? null;
      const fpsBase = baseCase?.fpsMedian ?? null;
      return now <= base && fpsNow !== null && fpsBase !== null && fpsNow >= fpsBase - 1;
    }
    case "wasmGrowthAfter60s":
      return isSoak ? now <= 0 : null;
    default:
      return null;
  }
}

/**
 * Rows comparing each case of `run` with the same case of `baseline`, one row per measure.
 * `change` is (now - baseline) / baseline, null when either side is missing or the baseline is 0.
 * `pass` is the pass bar's verdict, null where the bar does not cover the measure.
 *
 * @returns {Array<{case:string, measure:string, baseline:number|null, now:number|null,
 *   change:number|null, pass:boolean|null}>}
 */
export function compare(run, baseline) {
  const rows = [];
  for (const key of Object.keys(run.cases)) {
    const now = run.cases[key];
    const base = baseline.cases[key];
    for (const measure of MEASURES) {
      const nowValue = now?.[measure] ?? null;
      const baseValue = base?.[measure] ?? null;
      const change =
        nowValue !== null && baseValue !== null && baseValue !== 0
          ? (nowValue - baseValue) / baseValue
          : null;
      const verdict = nowValue !== null ? bar(key, measure, nowValue, baseValue, now, base) : null;
      rows.push({
        case: key,
        measure,
        baseline: baseValue,
        now: nowValue,
        change,
        pass: verdict,
      });
    }
  }
  return rows;
}

/**
 * The cases and failures a run.json holds: the cases already in the file, then this process's finished cases
 * (each case's last run, the first run's summary kept as firstRun when there were two), then the failures.
 * A failure of this process always stays listed, even when the case has data: a case with fewer runs than
 * planned (a failed repeat) is marked `complete: false` with `runsDone: "1 of 2"`. An older failure is dropped
 * once the case has been measured in full; a failed case loses the numbers of an older run.
 *
 * @param {{baseCases: object, baseFailures: object,
 *   finished: Record<string, {runs: object[][], planned?: number, gameSpeed: unknown, size: unknown}>,
 *   failures: Record<string, string>}} input
 */
/**
 * The Thai font fix of a launched game, for a run record: the game's [thaifont] log line when it printed one. With no
 * line, "off" only when the run was launched with the fix off (declared "off"); otherwise "unknown", because the
 * run did not say what it was launched with.
 */
export function thaiFixState(lines, declared = null) {
  const line = lines.find((l) => l.includes("[thaifont] using selected font"));
  if (line) return line.trim();
  return declared === "off" ? "off: no [thaifont] line (launched with --thai-fix off)" : "unknown";
}

export function mergeCases({ baseCases, baseFailures, finished, failures }) {
  const cases = { ...baseCases };
  const listed = { ...baseFailures, ...failures };
  for (const [key, result] of Object.entries(finished)) {
    const planned = result.planned ?? 1;
    const last = result.runs.at(-1);
    const summary = summarize(last);
    cases[key] = {
      ...summary,
      // seconds of a running game that was handed no picture: the page shows a frozen picture (the wasm memory at
      // its 768 MiB cap in 2560x1440 HD on); the case's fps and CPU are the game's, not what the player sees
      ...(summary.noPictureSeconds > 0
        ? { pictureFrozen: `${summary.noPictureSeconds} of ${last.length} seconds` }
        : {}),
      gameSpeed: result.gameSpeed,
      size: result.size,
      // the Thai font fix as the game started (its [thaifont] log line), when the run recorded it
      ...(result.thaiFix !== undefined ? { thaiFix: result.thaiFix } : {}),
      ...(result.runs.length > 1 ? { firstRun: summarize(result.runs[0]) } : {}),
      ...(result.runs.length < planned
        ? { complete: false, runsDone: `${result.runs.length} of ${planned}` }
        : {}),
    };
    if (result.runs.length >= planned && !(key in failures)) delete listed[key];
  }
  for (const key of Object.keys(failures)) if (!(key in finished)) delete cases[key];
  return { cases, failures: listed };
}
