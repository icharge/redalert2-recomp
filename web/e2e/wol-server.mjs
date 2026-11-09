// Start the local RA2Web WOL server (../ra2web/server) for the page and the WOL e2e checks.
// Run from web/: pnpm wol-server
//
// It listens on the server's default port, 9090, which is also the page's default
// (VITE_WOL_HTTP_URL unset) and wol.mjs's. The server reads its own .env, which holds
// the live deployment's public wss:// address, /wol socket path and CORS for the live
// page; real environment variables win over it, so those three are set here. The rest
// of .env (account limits, storage, MOTD) still applies.
// Other server settings pass through from the shell, e.g. NATIVE_RELAY_TEST_DELAY_MS=40;
// RA2WEB_SERVER_DIR points at another checkout.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = process.env.RA2WEB_SERVER_DIR ?? path.resolve(here, "../../../ra2web/server");
const port = process.env.SERVER_PORT ?? "9090";

console.log(`RA2Web from ${serverDir} on http://127.0.0.1:${port} (Ctrl+C stops it)`);
const server = spawn("bun", ["--no-env-file", "run", "src/index.ts"], {
  cwd: serverDir,
  stdio: "inherit",
  env: {
    ...process.env,
    SERVER_PORT: port,
    EXTERNAL_URL: process.env.EXTERNAL_URL ?? `ws://127.0.0.1:${port}`,
    WOL_URL_PATH: process.env.WOL_URL_PATH ?? "",
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS ?? "*",
  },
});
server.on("error", (error) => {
  console.error(`Could not start bun in ${serverDir}: ${error.message}`);
  process.exit(1);
});
server.on("exit", (code) => process.exit(code ?? 1));
