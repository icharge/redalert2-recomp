/// <reference lib="webworker" />
// The page's service worker (docs/web/deploy.md): it keeps the page and the game's files so the page loads
// offline, gives a host that cannot send them the headers threads need, and tells the page when a new build
// is there. It never touches OPFS: the game's own files are already on the player's disk.
import { PrecacheController } from "workbox-precaching";
import {
  buildIdOf,
  gameCacheName,
  isGameBuildFile,
  staleGameCaches,
  withIsolation,
} from "./swlogic";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

const BASE = new URL(self.registration.scope).pathname;
const BUILD_JSON = `${BASE}game/build.json`;
const META = `ra2-meta-${encodeURIComponent(BASE)}`;
const precache = new PrecacheController();
precache.addToCacheList(self.__WB_MANIFEST);

self.addEventListener("install", (event) => {
  // the page offers "update available" and then sends SKIP_WAITING; the first install takes over at once
  event.waitUntil(
    precache.install(event).then(async () => {
      if (!self.registration.active) await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await precache.activate(event);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") void self.skipWaiting();
});

/** The current build's id: from the network if it answers, else what it said last time. */
async function currentBuild(): Promise<string | null> {
  const meta = await caches.open(META);
  try {
    const response = await fetch(BUILD_JSON, { cache: "no-store" });
    if (response.ok) {
      await meta.put(BUILD_JSON, response.clone());
      return buildIdOf(await response.json());
    }
  } catch {
    // offline
  }
  const last = await meta.match(BUILD_JSON);
  return last ? buildIdOf(await last.json()) : null;
}

async function gameFile(request: Request): Promise<Response> {
  const id = await currentBuild();
  if (!id) return fetch(request); // a build with no id: the network, always
  const cache = await caches.open(gameCacheName(id, BASE));
  const hit = await cache.match(request.url); // by address, so a HEAD finds the file a GET kept
  if (hit) return request.method === "HEAD" ? new Response(null, hit) : hit;
  if (request.method === "HEAD") return fetch(request); // a HEAD is not worth a download
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request.url, response.clone());
    // another build's files are no use now
    for (const name of staleGameCaches(await caches.keys(), id, BASE)) await caches.delete(name);
  }
  return response;
}

async function respond(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (isGameBuildFile(url.pathname, BASE)) return withIsolation(await gameFile(request));
  if (url.pathname === BUILD_JSON) {
    // the id is what tells a new build from the old one: from the network when it can, never from the cache alone
    try {
      const response = await fetch(request, { cache: "no-store" });
      if (response.ok) await (await caches.open(META)).put(BUILD_JSON, response.clone());
      return withIsolation(response);
    } catch {
      const last = await (await caches.open(META)).match(BUILD_JSON);
      if (last) return withIsolation(last);
      throw new Error("offline and no build.json kept");
    }
  }
  // a page address is the app: index.html; matchPrecache takes the address, not its cache key
  const hit = await precache.matchPrecache(
    request.mode === "navigate" ? `${BASE}index.html` : request.url,
  );
  return withIsolation(hit ?? (await fetch(request)));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (!url.pathname.startsWith(BASE)) return;
  const isHead = request.method === "HEAD" && isGameBuildFile(url.pathname, BASE);
  if (request.method !== "GET" && !isHead) return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(respond(request));
});
