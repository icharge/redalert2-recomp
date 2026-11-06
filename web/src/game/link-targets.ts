// The WOL-era links the game asks the system browser to open. The game's own
// routines (run_lift.py web_url_patches) are intercepted and the page shows
// this dialog instead: an iframe for a page we know can be framed, otherwise
// a confirmation with the URL the game asked for. docs/web/protocol.md.

export type LinkTopic =
  | "privacy"
  | "account"
  | "consent"
  | "support"
  | "tournament"
  | "news"
  | "community"
  | "status"
  | "external"
  | "blocked";

export interface LinkTarget {
  topic: LinkTopic;
  /** the URL the game asked for, never rewritten; "" for a page key */
  url: string;
  /** the WOL page key when the game named a page instead of a URL */
  page?: string;
  /** the URL is this build's registry value, not an original Westwood URL */
  seeded?: boolean;
  /** the support kind, locale, or other detail parsed from the URL */
  detail?: string;
  /** whether the original URL may be offered as an outbound link */
  external: boolean;
  /** whether a page we control can be shown in the sandboxed iframe */
  embed: boolean;
}

/** The RA2Web site the dead Westwood links are mapped to (VITE_RA2WEB_SITE_URL). */
export function ra2webSite(): string {
  return (import.meta.env.VITE_RA2WEB_SITE_URL ?? "").replace(/\/+$/, "");
}

const RA2WEB_PATHS: Partial<Record<LinkTopic, string>> = {
  privacy: "/privacy",
  account: "/account",
  consent: "/consent",
  support: "/support",
  tournament: "/tournament",
  news: "/news",
  community: "/community",
  status: "/status",
};

/** Paths the seeded YR registry values use (the embedded browser's fallback). */
const SENTINEL_TOPICS: Record<string, LinkTopic> = {
  community: "community",
  ladder: "tournament",
  account: "account",
  clans: "community",
  status: "status",
  privacy: "privacy",
  news: "news",
  consent: "consent",
};

/** The page keys YR's DoWebPageDialog passes (run_lift.py intercepts 0x773E90). */
const PAGE_TOPICS: Record<string, LinkTopic> = {
  Community: "community",
  Ladder: "tournament",
  Manage: "account",
  Battleclans: "community",
  NetStatus: "status",
  News: "news",
};

/** The configured RA2Web page for a topic, or null when there is none. */
export function sitePageUrl(
  target: Pick<LinkTarget, "topic" | "detail">,
  site = ra2webSite(),
): string | null {
  const path = RA2WEB_PATHS[target.topic];
  if (!site || !path) return null;
  try {
    if (!isHttp(new URL(site).protocol)) return null;
  } catch {
    return null;
  }
  if (target.topic !== "support" || !target.detail) return site + path;
  return `${site}${path}/${encodeURIComponent(target.detail)}`;
}

function isHttp(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

/** Parse `support/<kind>_<locale>.html` into its kind, for the support copy. */
function supportKind(path: string): string | undefined {
  const match = /\/support\/([^/]+?)\.html$/i.exec(path);
  if (!match?.[1]) return undefined;
  return match[1].replace(/_[a-z]{2}$/i, "");
}

function make(
  topic: LinkTopic,
  url: string,
  detail: string | undefined,
  external: boolean,
  site: string,
  page?: string,
): LinkTarget {
  const target: LinkTarget = { topic, url, external, embed: false };
  if (page) target.page = page;
  if (detail) target.detail = detail;
  target.embed = external === false && sitePageUrl(target, site) !== null;
  return target;
}

/**
 * Map what the game asked for to a topic and the dialog's behaviour. A WOL page
 * key (YR's embedded browser) has no URL: `page` names it, and the dialog says
 * so instead of pretending the registry sentinel is the original.
 */
export function linkTarget(url: string, site = ra2webSite(), page?: string): LinkTarget {
  if (page !== undefined) {
    const topic = PAGE_TOPICS[page];
    // An unknown page still came from the game; show the key, never a URL.
    return topic
      ? make(topic, "", undefined, false, site, page)
      : { topic: "external", url: "", page, external: false, embed: false };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { topic: "blocked", url, external: false, embed: false };
  }
  if (!isHttp(parsed.protocol)) {
    return { topic: "blocked", url, external: false, embed: false };
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  // The sentinel host this build seeds into YR's registry: map by path. The
  // game did read this URL from its registry, but it is our value, so the
  // dialog labels it as the build's target rather than an original URL.
  if (host === "ra2web.invalid" || host === "ra2web.local" || host.endsWith(".invalid")) {
    const first = path.split("/").filter(Boolean)[0] ?? "";
    if (first === "support") {
      const target = make("support", url, supportKind(path) ?? "support", false, site);
      target.seeded = true;
      return target;
    }
    const known = SENTINEL_TOPICS[first];
    // A sentinel we do not map is not a real page: never offer it outbound.
    if (!known) return { topic: "external", url, seeded: true, external: false, embed: false };
    const target = make(known, url, undefined, false, site);
    target.seeded = true;
    return target;
  }

  if (host === "privacypolicy.westwood.com") return make("privacy", url, undefined, false, site);
  if (host === "games2.westwood.com") return make("account", url, undefined, false, site);
  if (host === "networkstatus.westwood.com") return make("status", url, undefined, false, site);
  if (host === "apiregister.westwood.com") {
    if (path.startsWith("/support/")) {
      return make("support", url, supportKind(path) ?? "support", false, site);
    }
    if (path.startsWith("/consent_form/")) return make("consent", url, undefined, false, site);
    return { topic: "external", url, external: false, embed: false };
  }
  // The retail YR registry's battle-clan pages name their topic in `request`.
  if (host === "battleclans.westwood.com") {
    const request = parsed.searchParams.get("request") ?? "";
    if (request === "do_ladder") return make("tournament", url, undefined, false, site);
    if (request === "do_news") return make("news", url, undefined, false, site);
    if (request === "do_clan") return make("community", url, undefined, false, site);
    if (request === "do_netstatus") return make("status", url, undefined, false, site);
    return { topic: "external", url, external: false, embed: false };
  }
  if (host === "westwood.ea.com" && path.includes("/redalert2/"))
    return make("community", url, undefined, false, site);

  if (host === "www.westwood.com" || host.endsWith(".westwood.com")) {
    if (path.includes("/tournaments/")) return make("tournament", url, undefined, false, site);
    if (path.includes("/news")) return make("news", url, undefined, false, site);
    return { topic: "external", url, external: false, embed: false };
  }

  // A live URL we do not know: ask before opening it in a new tab.
  return { topic: "external", url, external: true, embed: false };
}

export interface LinkCopy {
  title: string;
  body: string;
}

/** The one confirmation every WOL-era link gets: the game asked to open a URL. */
export const EXTERNAL_LINK_PROMPT = "The game needs access to an external link.";

/**
 * The dialog's words. Every link is a permission prompt — the player decides
 * whether to Open it, and Cancel only dismisses the dialog. The original URL
 * is shown separately, so the body does not have to repeat it.
 */
export function linkCopy(target: LinkTarget): LinkCopy {
  if (target.topic === "blocked")
    return { title: "Link blocked", body: "The game asked for a link this page cannot open." };
  const titles: Record<Exclude<LinkTopic, "blocked">, string> = {
    privacy: "Privacy policy",
    account: "Manage account",
    consent: "Consent form",
    support: "Support",
    tournament: "Tournament",
    news: "News",
    community: "Community",
    status: "Network status",
    external: target.page ? "Open external page" : "Open external link",
  };
  return { title: titles[target.topic], body: EXTERNAL_LINK_PROMPT };
}

/**
 * The href "Open" uses: our own page when one is framed, else the game's own
 * URL unchanged. Our sentinel hosts (`ra2web.invalid`, `ra2web.local`, any
 * `.invalid`) are build values, never real links, so they are not offered.
 */
export function outboundUrl(target: LinkTarget, site = ra2webSite()): string | null {
  if (target.embed) {
    const page = sitePageUrl(target, site);
    if (page) return page;
  }
  if (!target.url || target.seeded) return null;
  let parsed: URL;
  try {
    parsed = new URL(target.url);
  } catch {
    return null;
  }
  if (!isHttp(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase();
  if (host === "ra2web.local" || host.endsWith(".invalid")) return null;
  return target.url;
}
