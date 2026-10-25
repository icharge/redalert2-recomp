import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { chooseWasmEncoding } from "./src/wasm-encoding";

type Next = (error?: unknown) => void;
type Middleware = (request: IncomingMessage, response: ServerResponse, next: Next) => void;

function basePrefix(base: string): string {
  if (!base || base === "./" || base === "../") return "/";
  const absolute = base.startsWith("/") ? base : `/${base}`;
  return absolute.endsWith("/") ? absolute : `${absolute}/`;
}

function addVary(response: ServerResponse, name: string): void {
  const current = response.getHeader("Vary");
  if (current === "*") return;
  const values = (Array.isArray(current) ? current.join(",") : String(current ?? ""))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.some((value) => value.toLowerCase() === name.toLowerCase())) values.push(name);
  response.setHeader("Vary", values.join(", "));
}

export function createPrecompressedWasmMiddleware(publicDir: string, base: string): Middleware {
  const prefix = basePrefix(base);
  return (request, response, next) => {
    if (request.method !== "GET" && request.method !== "HEAD") return next();

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://vite.local").pathname);
    } catch {
      return next();
    }
    if (!pathname.startsWith(prefix)) return next();

    const relative = pathname.slice(prefix.length);
    const moduleFiles =
      relative === "game/ra2md.wasm"
        ? { wasm: "game/ra2md.wasm", stem: "game/ra2md.wasm" }
        : relative === "game/ra2.wasm"
          ? { wasm: "game/ra2.wasm", stem: "game/ra2.wasm" }
          : null;
    if (!moduleFiles) return next();

    const wasmPath = path.resolve(publicDir, moduleFiles.wasm);
    const brotliPath = path.resolve(publicDir, `${moduleFiles.stem}.br`);
    const gzipPath = path.resolve(publicDir, `${moduleFiles.stem}.gz`);
    const exists = {
      br: existsSync(brotliPath),
      gzip: existsSync(gzipPath),
      identity: existsSync(wasmPath),
    };
    if (!exists.identity) return next();

    const accepted = request.headers["accept-encoding"];
    const encoding = chooseWasmEncoding(
      Array.isArray(accepted) ? accepted.join(",") : (accepted ?? null),
      exists,
    );
    if (!encoding) {
      response.statusCode = 406;
      response.setHeader("Vary", "Accept-Encoding");
      response.setHeader("Content-Length", 0);
      response.end();
      return;
    }

    const selectedPath = encoding === "br" ? brotliPath : encoding === "gzip" ? gzipPath : wasmPath;
    addVary(response, "Accept-Encoding");
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/wasm");
    response.setHeader("Content-Length", statSync(selectedPath).size);
    response.setHeader("Cache-Control", "no-cache");
    if (encoding === "identity") response.removeHeader("Content-Encoding");
    else response.setHeader("Content-Encoding", encoding);

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    const stream = createReadStream(selectedPath);
    stream.on("error", (error) => {
      if (response.headersSent) response.destroy(error);
      else next(error);
    });
    stream.pipe(response);
  };
}

function install(server: ViteDevServer | PreviewServer): void {
  const publicDir = server.config.publicDir;
  if (!publicDir || publicDir === "false") return;
  server.middlewares.use(createPrecompressedWasmMiddleware(publicDir, server.config.base));
}

export function precompressedWasm(): Plugin {
  return {
    name: "ra2-precompressed-wasm",
    configureServer: install,
    configurePreviewServer: install,
  };
}
