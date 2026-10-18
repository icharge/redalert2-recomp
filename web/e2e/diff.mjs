import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PNG } = require("playwright-core/lib/utilsBundle");
const [a, b] = process.argv.slice(2).map((f) => PNG.sync.read(fs.readFileSync(f)));
let n = 0,
  minx = 1e9,
  miny = 1e9,
  maxx = 0,
  maxy = 0;
const [rx0, ry0, rx1, ry1] = (process.env.RECT ?? "0,0,99999,99999").split(",").map(Number);
for (let y = ry0; y < Math.min(a.height, ry1); y++)
  for (let x = rx0; x < Math.min(a.width, rx1); x++) {
    const i = (y * a.width + x) * 4;
    if (
      Math.abs(a.data[i] - b.data[i]) +
        Math.abs(a.data[i + 1] - b.data[i + 1]) +
        Math.abs(a.data[i + 2] - b.data[i + 2]) >
      24
    ) {
      n++;
      minx = Math.min(minx, x);
      miny = Math.min(miny, y);
      maxx = Math.max(maxx, x);
      maxy = Math.max(maxy, y);
    }
  }
console.log(n, "pixels differ", n ? `in ${minx},${miny} - ${maxx},${maxy}` : "");
