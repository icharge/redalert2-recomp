#!/usr/bin/env node
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { brotliCompress, constants, gzip } from "node:zlib";
import { promisify } from "node:util";

const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

function usage() {
  console.error("usage: node compress-wasm.mjs <input.wasm> <output.br> <output.gz>");
  process.exitCode = 2;
}

async function existingFile(pathname) {
  try {
    return await readFile(pathname);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writePair(outputs) {
  const previous = await Promise.all(outputs.map(([destination]) => existingFile(destination)));
  let written = 0;
  try {
    for (const [destination, data] of outputs) {
      await writeFile(destination, data);
      written++;
    }
  } catch (error) {
    await Promise.all(
      outputs.slice(0, written + 1).map(async ([destination], index) => {
        if (previous[index] === null) await rm(destination, { force: true });
        else await writeFile(destination, previous[index]);
      }),
    );
    throw error;
  }
}

async function main(args) {
  if (args.length !== 3) return usage();
  const [inputPath, brotliPath, gzipPath] = args.map((item) => path.resolve(item));
  if (new Set([inputPath, brotliPath, gzipPath]).size !== 3) {
    throw new Error("input and output paths must be distinct");
  }

  const input = await readFile(inputPath);
  if (input.length < 8 || !input.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))) {
    throw new Error(`${inputPath} is not a WebAssembly binary`);
  }

  const [brotliData, gzipData] = await Promise.all([
    brotliCompressAsync(input, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 9 },
    }),
    gzipAsync(input, { level: 9, mtime: 0 }),
  ]);

  await writePair([
    [brotliPath, brotliData],
    [gzipPath, gzipData],
  ]);

  console.log(
    `Wasm sidecars: ${brotliPath} (${brotliData.length} bytes), ${gzipPath} (${gzipData.length} bytes)`,
  );
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
