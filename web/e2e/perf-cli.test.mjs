import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("accepts --soak-size 3840x2160 before checking for the busy save", () => {
  const result = spawnSync(
    process.execPath,
    [
      "e2e/perf.mjs",
      "--soak-minutes",
      "1",
      "--soak-size",
      "3840x2160",
      "--save",
      "work/perf/no-such-4k-save.sav",
    ],
    { cwd: web, encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /no save at/);
  assert.doesNotMatch(result.stderr, /unknown argument --soak-size/);
});

test("make-busy-save accepts the edition flag and validates its value before launching", () => {
  const result = spawnSync(process.execPath, ["e2e/make-busy-save.mjs", "--edition", "bad"], {
    cwd: web,
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--edition bad: use ra2 or ra2md/);
  assert.doesNotMatch(result.stderr, /unknown argument --edition/);
});

test("perf accepts the edition flag and validates its value before requiring a save", () => {
  const result = spawnSync(
    process.execPath,
    ["e2e/perf.mjs", "--edition", "bad", "--moments", "busy"],
    {
      cwd: web,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--edition bad: use ra2 or ra2md/);
  assert.doesNotMatch(result.stderr, /unknown argument --edition|no save at/);
});
