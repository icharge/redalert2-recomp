import { Dialog, Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkTarget } from "../game/link-targets";
import { LinkDialogContent } from "./LinkDialogContent";

const SITE = "https://ra2web.example";

function show(target: LinkTarget, onClose = vi.fn()) {
  render(
    <Theme>
      <Dialog.Root open>
        <Dialog.Content>
          <LinkDialogContent target={target} onClose={onClose} />
        </Dialog.Content>
      </Dialog.Root>
    </Theme>,
  );
  return onClose;
}

const community: LinkTarget = {
  topic: "community",
  url: "https://ra2web.invalid/community",
  external: false,
  embed: true,
};

const external: LinkTarget = {
  topic: "external",
  url: "https://example.com/hello",
  external: true,
  embed: false,
};

beforeEach(() => vi.stubEnv("VITE_RA2WEB_SITE_URL", SITE));
afterEach(() => vi.unstubAllEnvs());

describe("LinkDialogContent", () => {
  it("frames an embeddable target and keeps the original URL visible", () => {
    show(community);

    const frame = screen.getByTitle("Community");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", `${SITE}/community`);
    expect(frame).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox",
    );
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(screen.getByText("https://ra2web.invalid/community")).toBeInTheDocument();
  });

  it("offers the embedded page in a new tab, never via window.open", async () => {
    const open = vi.spyOn(window, "open");
    show(community);

    const link = screen.getByRole("link", { name: "Open in browser" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", `${SITE}/community`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    await userEvent.click(link);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("shows the WOL Help URL as the support dialog", () => {
    // src/web/wolapi.c's GetHelpURL hands the game this seeded URL.
    show({
      topic: "support",
      url: "https://ra2web.invalid/support/help.html",
      detail: "help",
      external: false,
      embed: true,
    });

    expect(screen.getByRole("heading", { name: "Support" })).toBeInTheDocument();
    expect(screen.getByText(/Westwood's support pages are offline/)).toBeInTheDocument();
    expect(screen.getByText("https://ra2web.invalid/support/help.html")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open in browser" });
    expect(link).toHaveAttribute("href", `${SITE}/support/help`);
  });

  it("labels the registry sentinel as this build's target, not the game's URL", () => {
    show({
      topic: "community",
      url: "https://ra2web.invalid/community",
      seeded: true,
      external: false,
      embed: true,
    });

    expect(screen.getByText("This build's registry target:")).toBeInTheDocument();
    expect(screen.queryByText("The game asked for:")).toBeNull();
    expect(screen.getByText("https://ra2web.invalid/community")).toBeInTheDocument();
  });

  it("names a WOL page key without showing the registry sentinel", () => {
    show({ topic: "news", url: "", page: "News", external: false, embed: true });

    expect(screen.getByRole("heading", { name: "News" })).toBeInTheDocument();
    expect(screen.getByText("News page")).toBeInTheDocument();
    expect(screen.queryByText(/ra2web\.invalid/)).toBeNull();
    expect(screen.getByRole("link", { name: "Open in browser" })).toHaveAttribute(
      "href",
      `${SITE}/news`,
    );
  });

  it("asks before opening a live URL the page does not know", () => {
    show(external);

    expect(screen.queryByTitle("Open external link")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByText("The game asked to open an external link.")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/hello")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open in browser" });
    expect(link).toHaveAttribute("href", "https://example.com/hello");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("never makes an outbound link for a dead Westwood host", () => {
    show({
      topic: "privacy",
      url: "http://privacypolicy.westwood.com",
      external: false,
      embed: false,
    });

    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByText("http://privacypolicy.westwood.com")).toBeInTheDocument();
  });

  it("blocks a non-http(s) URL outright", () => {
    show({ topic: "blocked", url: "javascript:alert(1)", external: false, embed: false });

    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("a")).toBeNull();
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
  });

  it("shows the URL as text, not markup", () => {
    show({
      topic: "external",
      url: "https://example.com/%3Cb%3Ehi%3C/b%3E",
      external: true,
      embed: false,
    });

    expect(document.querySelector("b")).toBeNull();
    expect(screen.getByText("https://example.com/%3Cb%3Ehi%3C/b%3E")).toBeInTheDocument();
  });

  it("closes through the callback", async () => {
    const onClose = show(external);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not frame a target whose page is not configured", () => {
    vi.stubEnv("VITE_RA2WEB_SITE_URL", "");
    show(community);

    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("https://ra2web.invalid/community")).toBeInTheDocument();
  });

  it("does not frame a configured site that is not http(s)", () => {
    vi.stubEnv("VITE_RA2WEB_SITE_URL", "javascript:alert(1)");
    show(community);

    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
