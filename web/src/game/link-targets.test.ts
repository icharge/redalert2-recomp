import { describe, expect, it } from "vitest";
import { linkCopy, linkTarget, sitePageUrl } from "./link-targets";

const SITE = "https://ra2web.example";

describe("linkTarget", () => {
  it("maps the dead Westwood pages to their topics and keeps the URL", () => {
    const privacy = linkTarget("http://privacypolicy.westwood.com", SITE);
    expect(privacy).toEqual({
      topic: "privacy",
      url: "http://privacypolicy.westwood.com",
      external: false,
      embed: true,
    });
    expect(sitePageUrl(privacy, SITE)).toBe(`${SITE}/privacy`);

    expect(linkTarget("http://games2.westwood.com/cgi-bin/cgiclient?register", SITE).topic).toBe(
      "account",
    );
    expect(linkTarget("http://www.westwood.com/tournaments/redalert2/", SITE).topic).toBe(
      "tournament",
    );
    expect(linkTarget("http://networkstatus.westwood.com", SITE).topic).toBe("status");
  });

  it("parses a support kind and a consent page", () => {
    const support = linkTarget("http://apiregister.westwood.com/support/serial_dup_en.html", SITE);
    expect(support.topic).toBe("support");
    expect(support.detail).toBe("serial_dup");
    expect(support.external).toBe(false);
    expect(support.embed).toBe(true);
    expect(sitePageUrl(support, SITE)).toBe(`${SITE}/support/serial_dup`);

    expect(
      linkTarget("http://apiregister.westwood.com/consent_form/index_en.html", SITE).topic,
    ).toBe("consent");
  });

  it("maps the YR registry sentinel by path", () => {
    const community = linkTarget("https://ra2web.invalid/community", SITE);
    expect(community).toMatchObject({
      topic: "community",
      url: "https://ra2web.invalid/community",
      seeded: true,
      external: false,
      embed: true,
    });

    // A sentinel the page does not map is not a real page; never offer it.
    const unknown = linkTarget("https://ra2web.invalid/mystery", SITE);
    expect(unknown).toMatchObject({
      topic: "external",
      seeded: true,
      external: false,
      embed: false,
    });

    expect(linkTarget("https://ra2web.invalid/ladder", SITE)).toMatchObject({
      topic: "tournament",
      embed: true,
    });
    expect(linkTarget("https://ra2web.invalid/clans", SITE).topic).toBe("community");
    expect(linkTarget("https://ra2web.invalid/status", SITE).topic).toBe("status");
  });

  it("maps a WOL page key without inventing an original URL", () => {
    // YR's DoWebPageDialog passes "News", not a URL. src/web/presenter.c
    // reports the key and leaves url empty; the registry sentinel is only the
    // embedded browser's fallback.
    const news = linkTarget("", SITE, "News");
    expect(news).toMatchObject({
      topic: "news",
      url: "",
      page: "News",
      external: false,
      embed: true,
    });
    expect(sitePageUrl(news, SITE)).toBe(`${SITE}/news`);

    const unknown = linkTarget("", SITE, "Mystery");
    expect(unknown).toMatchObject({
      topic: "external",
      url: "",
      page: "Mystery",
      external: false,
      embed: false,
    });
    expect(linkCopy(unknown).title).toBe("Open external page");
  });

  it("maps the WOL Help URL to the support page", () => {
    // src/web/wolapi.c's GetHelpURL hands the game this seeded URL.
    const help = linkTarget("https://ra2web.invalid/support/help.html", SITE);
    expect(help).toMatchObject({ topic: "support", detail: "help", external: false, embed: true });
    expect(sitePageUrl(help, SITE)).toBe(`${SITE}/support/help`);
  });

  it("asks before opening an unknown live URL", () => {
    expect(linkTarget("https://example.com/hello", SITE)).toEqual({
      topic: "external",
      url: "https://example.com/hello",
      external: true,
      embed: false,
    });
  });

  it("blocks every scheme but http(s)", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///etc/passwd",
      "mailto:a@b",
      "",
      "not a url",
    ]) {
      expect(linkTarget(url, SITE)).toMatchObject({
        topic: "blocked",
        external: false,
        embed: false,
      });
    }
  });

  it("never embeds without a configured site", () => {
    for (const url of [
      "http://privacypolicy.westwood.com",
      "http://networkstatus.westwood.com",
      "https://ra2web.invalid/community",
    ]) {
      const target = linkTarget(url, "");
      expect(target.embed).toBe(false);
      expect(sitePageUrl(target, "")).toBeNull();
    }
  });

  it("does not offer a dead Westwood host as an outbound link", () => {
    expect(linkTarget("http://privacypolicy.westwood.com", SITE).external).toBe(false);
    expect(linkTarget("http://networkstatus.westwood.com", SITE).external).toBe(false);
  });

  it("refuses a configured site that is not http(s)", () => {
    const target = linkTarget("http://privacypolicy.westwood.com", "javascript:alert(1)");
    expect(target.embed).toBe(false);
    expect(sitePageUrl(target, "javascript:alert(1)")).toBeNull();
  });
});

describe("linkCopy", () => {
  it("has words for every topic", () => {
    for (const url of [
      "http://privacypolicy.westwood.com",
      "http://games2.westwood.com/cgi-bin/cgiclient?register",
      "http://apiregister.westwood.com/consent_form/index_en.html",
      "http://apiregister.westwood.com/support/serial_dup_en.html",
      "http://www.westwood.com/tournaments/redalert2/",
      "https://ra2web.invalid/community",
      "https://ra2web.invalid/news",
      "http://networkstatus.westwood.com",
      "https://example.com/hello",
      "javascript:alert(1)",
    ]) {
      const copy = linkCopy(linkTarget(url, SITE));
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it("names the support kind the game asked about", () => {
    const copy = linkCopy(
      linkTarget("http://apiregister.westwood.com/support/serial_dup_en.html", SITE),
    );
    expect(copy.body).toContain("serial_dup");
  });
});
