import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from "node:zlib";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Writable } from "node:stream";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPrecompressedWasmMiddleware, precompressedWasm } from "../vite.precompressed-wasm";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function runMiddleware(
  publicDir: string,
  base: string,
  url: string,
  headers: Record<string, string> = {},
  method = "GET",
): Promise<{
  status: number;
  headers: Record<string, string | number | string[] | undefined>;
  body: Buffer;
}> {
  const middleware = createPrecompressedWasmMiddleware(publicDir, base);
  const chunks: Buffer[] = [];
  const savedHeaders = new Map<string, string | number | string[]>();
  let headersSent = false;
  let statusCode = 200;
  const response = new Writable({
    write(chunk, _encoding, callback) {
      headersSent = true;
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  Object.defineProperties(response, {
    statusCode: {
      get: () => statusCode,
      set: (value: number) => {
        statusCode = value;
      },
    },
    headersSent: { get: () => headersSent },
  });
  Object.assign(response, {
    setHeader(name: string, value: string | number | string[]) {
      savedHeaders.set(name.toLowerCase(), value);
      return response;
    },
    getHeader(name: string) {
      return savedHeaders.get(name.toLowerCase());
    },
    removeHeader(name: string) {
      savedHeaders.delete(name.toLowerCase());
    },
  });
  const req = { method, url, headers } as unknown as IncomingMessage;
  return new Promise((resolve, reject) => {
    response.on("finish", () =>
      resolve({
        status: statusCode,
        headers: Object.fromEntries(savedHeaders),
        body: Buffer.concat(chunks),
      }),
    );
    response.on("error", reject);
    middleware(req, response as unknown as ServerResponse, (error) => {
      if (error) reject(error);
      else {
        statusCode = 404;
        response.end("not found");
      }
    });
  });
}

describe("precompressed Wasm HTTP responses", () => {
  it("registers middleware for both Vite dev and preview servers", () => {
    const plugin = precompressedWasm();
    expect(typeof plugin.configureServer).toBe("function");
    expect(typeof plugin.configurePreviewServer).toBe("function");
  });

  it("serves Brotli first, gzip fallback, and identity with the same Wasm URL", async () => {
    const publicDir = mkdtempSync(path.join(tmpdir(), "ra2-precompressed-wasm-"));
    temporaryDirectories.push(publicDir);
    mkdirSync(path.join(publicDir, "game"), { recursive: true });
    const original = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 2, 3, 4, 5]);
    writeFileSync(path.join(publicDir, "game", "ra2md.wasm"), original);
    writeFileSync(path.join(publicDir, "game", "ra2md.wasm.br"), brotliCompressSync(original));
    writeFileSync(path.join(publicDir, "game", "ra2md.wasm.gz"), gzipSync(original));
    const brotli = await runMiddleware(publicDir, "/emu/", "/emu/game/ra2md.wasm?build=1", {
      "accept-encoding": "br, gzip",
    });
    expect(brotli.status).toBe(200);
    expect(brotli.headers["content-type"]).toBe("application/wasm");
    expect(brotli.headers["content-encoding"]).toBe("br");
    expect(brotli.headers.vary).toMatch(/Accept-Encoding/i);
    expect(brotliDecompressSync(brotli.body)).toEqual(original);

    const ra2 = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 9, 8, 7, 6]);
    writeFileSync(path.join(publicDir, "game", "ra2.wasm"), ra2);
    writeFileSync(path.join(publicDir, "game", "ra2.wasm.br"), brotliCompressSync(ra2));
    writeFileSync(path.join(publicDir, "game", "ra2.wasm.gz"), gzipSync(ra2));
    const ra2Response = await runMiddleware(publicDir, "/emu/", "/emu/game/ra2.wasm", {
      "accept-encoding": "br, gzip",
    });
    expect(ra2Response.headers["content-encoding"]).toBe("br");
    expect(brotliDecompressSync(ra2Response.body)).toEqual(ra2);

    const head = await runMiddleware(
      publicDir,
      "/emu/",
      "/emu/game/ra2md.wasm",
      { "accept-encoding": "br" },
      "HEAD",
    );
    expect(head.status).toBe(200);
    expect(head.headers["content-encoding"]).toBe("br");
    expect(head.body).toHaveLength(0);

    const gzipOnly = await runMiddleware(publicDir, "/emu/", "/emu/game/ra2md.wasm", {
      "accept-encoding": "br;q=0, gzip",
    });
    expect(gzipOnly.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(gzipOnly.body)).toEqual(original);

    const identity = await runMiddleware(publicDir, "/emu/", "/emu/game/ra2md.wasm");
    expect(identity.headers["content-encoding"]).toBeUndefined();
    expect(identity.headers["content-type"]).toBe("application/wasm");
    expect(identity.headers.vary).toMatch(/Accept-Encoding/i);
    expect(identity.body).toEqual(original);

    const unacceptable = await runMiddleware(publicDir, "/emu/", "/emu/game/ra2md.wasm", {
      "accept-encoding": "br;q=0, gzip;q=0, identity;q=0",
    });
    expect(unacceptable.status).toBe(406);
  });

  it("falls back to identity when the compressed files have not been built", async () => {
    const publicDir = mkdtempSync(path.join(tmpdir(), "ra2-precompressed-wasm-missing-"));
    temporaryDirectories.push(publicDir);
    mkdirSync(path.join(publicDir, "game"), { recursive: true });
    const original = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
    writeFileSync(path.join(publicDir, "game", "ra2.wasm"), original);
    const response = await runMiddleware(publicDir, "/", "/game/ra2.wasm", {
      "accept-encoding": "br, gzip",
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.body).toEqual(original);
  });

  it("does not intercept other paths or paths outside the configured base", async () => {
    const publicDir = mkdtempSync(path.join(tmpdir(), "ra2-precompressed-wasm-scope-"));
    temporaryDirectories.push(publicDir);
    expect(
      (await runMiddleware(publicDir, "/emu/", "/game/ra2.wasm", { "accept-encoding": "br" }))
        .status,
    ).toBe(404);
    expect(
      (await runMiddleware(publicDir, "/", "/game/ra2/ra2.wasm", { "accept-encoding": "br" }))
        .status,
    ).toBe(404);
    expect(
      (await runMiddleware(publicDir, "/emu/", "/emu/game/other.wasm", { "accept-encoding": "br" }))
        .status,
    ).toBe(404);
  });
});
