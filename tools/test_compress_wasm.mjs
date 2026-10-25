import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

const repo = path.resolve(import.meta.dirname, "..");
const compressor = path.join(repo, "tools", "compress-wasm.mjs");

test("compresses Wasm into the requested Brotli and gzip sidecars losslessly", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "ra2-wasm-compress-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, "ra2.wasm");
  const brotli = path.join(dir, "ra2.wasm.br");
  const gzip = path.join(dir, "ra2.wasm.gz");
  const original = Buffer.concat([Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), Buffer.alloc(4096, 0x5a)]);
  writeFileSync(input, original);

  const result = spawnSync(process.execPath, [compressor, input, brotli, gzip], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(brotliDecompressSync(readFileSync(brotli)), original);
  assert.deepEqual(gunzipSync(readFileSync(gzip)), original);
});

test("does not leave sidecars behind when compression input is missing", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "ra2-wasm-compress-missing-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const brotli = path.join(dir, "ra2.wasm.br");
  const gzip = path.join(dir, "ra2.wasm.gz");

  const result = spawnSync(process.execPath, [compressor, path.join(dir, "missing.wasm"), brotli, gzip], {
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.throws(() => readFileSync(brotli), { code: "ENOENT" });
  assert.throws(() => readFileSync(gzip), { code: "ENOENT" });
});
