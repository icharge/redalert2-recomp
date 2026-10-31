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
  /** the URL the game asked for, never rewritten */
  url: string;
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

/** Paths the seeded YR registry values (and the WOL browser page keys) use. */
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
): LinkTarget {
  const target: LinkTarget = { topic, url, external, embed: false };
  if (detail) target.detail = detail;
  target.embed = external === false && sitePageUrl(target, site) !== null;
  return target;
}

/** Map the URL the game asked for to a topic and the dialog's behaviour. */
export function linkTarget(url: string, site = ra2webSite()): LinkTarget {
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

  // The sentinel host YR's registry is seeded with: map by path.
  if (host === "ra2web.invalid" || host === "ra2web.local" || host.endsWith(".invalid")) {
    const first = path.split("/").filter(Boolean)[0] ?? "";
    if (first === "support") {
      return make("support", url, supportKind(path) ?? "support", false, site);
    }
    const known = SENTINEL_TOPICS[first];
    // A sentinel we do not map is not a real page: never offer it outbound.
    if (!known) return { topic: "external", url, external: false, embed: false };
    return make(known, url, undefined, false, site);
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

/** The dialog's words, per topic. The original URL is shown separately. */
export function linkCopy(target: LinkTarget): LinkCopy {
  switch (target.topic) {
    case "privacy":
      return {
        title: "Privacy policy",
        body: "The original Westwood privacy page is offline. This build does not send your details to it.",
      };
    case "account":
      return {
        title: "Manage account",
        body: "Westwood's account pages are offline, and this build does not use a Westwood account or serial.",
      };
    case "consent":
      return {
        title: "Consent form",
        body: "Westwood's consent form is offline, and this build does not collect that consent.",
      };
    case "support":
      return {
        title: "Support",
        body: target.detail
          ? `The game asked for help with “${target.detail}”. Westwood's support pages are offline.`
          : "Westwood's support pages are offline.",
      };
    case "tournament":
      return {
        title: "Tournament",
        body: "Westwood's tournament pages are offline. Play a custom match from the online menu instead.",
      };
    case "news":
      return {
        title: "News",
        body: "Westwood's news page is offline.",
      };
    case "community":
      return {
        title: "Community",
        body: "Westwood's community page is offline.",
      };
    case "status":
      return {
        title: "Network status",
        body: "Westwood's network status page is offline. The online menu shows the server this build talks to.",
      };
    case "external":
      return {
        title: "Open external link",
        body: "The game asked to open an external link.",
      };
    case "blocked":
      return {
        title: "Link blocked",
        body: "The game asked for a link this page cannot open.",
      };
  }
}
