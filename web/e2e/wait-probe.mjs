// How late a worker's timed wait wakes on this machine (docs/web/testing.md, "Performance"): the
// numbers that decide the wait margin M the frame loop uses in Task 8 of the frame performance plan.
//
//   cd web; node e2e/wait-probe.mjs [--url http://127.0.0.1:5173/e2e/wait-probe.html] [--headed]
//
// Opens wait-probe.html in Chrome (lib.mjs's launcher), waits for its five rows, prints the table and
// M = the smallest of 1, 2, 4, 8, 16 ms whose p99 lateness is at most 1 ms, plus 1 (16 if none is),
// and writes work/perf/wait-probe.json. Run it with the machine otherwise idle: a busy CPU moves the wakes.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";

const base = options(process.argv.slice(2));
const url = process.argv.includes("--url") ? base.url : "http://127.0.0.1:5173/e2e/wait-probe.html";
const t = await startPage({ ...base, url, noDev: true });

try {
  await t.page.waitForFunction(() => window.waitProbeDone === true, null, { timeout: 120_000 });
  const rows = await t.page.evaluate(() => window.waitProbe);
  const isolated = await t.page.evaluate(() => crossOriginIsolated);
  if (!isolated)
    throw new Error("the page is not cross-origin isolated: serve it from the Vite dev server");

  const fmt = (v) => v.toFixed(2).padStart(7);
  console.log("target    p50 late    p95 late    p99 late    max late   (ms)");
  for (const r of rows)
    console.log(
      `${String(r.target).padStart(4)} ms ${fmt(r.p50)}    ${fmt(r.p95)}    ${fmt(r.p99)}    ${fmt(r.max)}`,
    );

  const fit = rows.find((r) => r.p99 <= 1);
  const M = fit ? fit.target + 1 : 16;
  console.log(
    `\nM = ${M} ms (${fit ? `the ${fit.target} ms wait's p99 is ${fit.p99.toFixed(2)} ms` : "no target has a p99 of 1 ms or less; today's 16"})`,
  );

  const out = path.resolve("../work/perf/wait-probe.json");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify({ at: new Date().toISOString(), url, rows, M }, null, 1) + "\n",
  );
  console.log(`wrote ${out}`);
} finally {
  await t.browser.close();
}
