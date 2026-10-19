// Stage 8: the game's Bink movies play in the page. The main menu opens a looping movie for its sidebar (the
// gauge under "Main Menu") from inside ra2md.mix right after its dialog; with the decoder built in
// (FFMPEG_WEB_DIR, tools/build-ffmpeg-web.sh) that region of the picture keeps changing.
//
//   node e2e/movies.mjs [--url http://127.0.0.1:5173/]
import { options, startPage } from "./lib.mjs";

const base = options(process.argv.slice(2));
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const t = await startPage(base);
await t.waitFor("the main menu", (s) => s?.phase === "running");
await t.page.waitForTimeout(3000);

// the picture's pixels in a region, as a checksum, now
const region = (x, y, w, h) =>
  t.page.evaluate(
    ([x0, y0, w0, h0]) => {
      const c = document.querySelector("canvas");
      const d = c.getContext("2d").getImageData(x0, y0, w0, h0).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4)
        sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0;
      return sum;
    },
    [x, y, w, h],
  );
// the gauge's window in the sidebar, in the game's 800x600
const seen = new Set();
for (let i = 0; i < 24; i++) {
  seen.add(await region(662, 44, 104, 60));
  await t.page.waitForTimeout(250);
}
const bink = t.all.filter((l) => l.includes("[bink]"));
console.log(bink.slice(0, 6).join("\n"));
check(
  bink.length > 0 && !bink.some((l) => l.includes("no movie decoder")),
  "the host has a movie decoder",
);
check(seen.size >= 6, `the sidebar animates: ${seen.size} different pictures of its gauge in 6 s`);
await t.shot("movies-menu");
await t.browser.close();
if (failures.length) {
  console.error(`${failures.length} failed`);
  process.exit(1);
}
console.log("all passed");
