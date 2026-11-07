import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BuildInfo } from "../../../storage/install";
import type { GameRecord } from "../../../storage/manifest";
import { AboutTab, type AboutDeps } from "./AboutTab";
import type { Release } from "./changelog";
import type { AllGamesSettings } from "./useAllGamesSettings";

const yr: GameRecord = {
  id: "ra2md",
  slot: 1,
  storage: "slot-1-ra2md",
  title: "Yuri's Revenge",
  exeStamp: 0,
  importedAt: 0,
  bytes: 0,
  complete: true,
  files: {},
};

const build: BuildInfo = {
  games: {
    ra2md: {
      title: "Yuri's Revenge",
      exe: "gamemd.exe",
      ini: "RA2MD.INI",
      stamp: 0,
      build: "722705c66c8d2a2b",
    },
  },
};

const entries = Array.from({ length: 7 }, (_, i) => ({
  title: `Thing ${i + 1}`,
  text: `Text ${i + 1}.`,
}));
const release: Release = {
  version: "0.1.0",
  date: "2026-11-07",
  groups: [
    { kind: "Added", entries: entries.slice(0, 6) },
    { kind: "Fixed", entries: [{ text: "Escape opens the pause menu." }] },
  ],
};

function setup(deps: Partial<AboutDeps> = {}) {
  const all: AboutDeps = {
    version: "0.1.0",
    release,
    loadBuild: vi.fn(async () => build),
    copy: vi.fn(async () => {}),
    checkUpdate: vi.fn(async () => "current" as const),
    ...deps,
  };
  render(<AboutTab editions={[yr]} edition={yr} settings={{} as AllGamesSettings} deps={all} />);
  return all;
}

describe("AboutTab", () => {
  it("shows the launcher's version and the shown game's build", async () => {
    setup();
    const version = screen.getByRole("region", { name: "Version" });
    expect(within(version).getByText("0.1.0")).toBeInTheDocument();
    expect(await within(version).findByText("722705c66c8d2a2b")).toBeInTheDocument();
  });

  it("works with no game installed, showing the build's own id", async () => {
    const deps: AboutDeps = {
      version: "0.1.0",
      release,
      loadBuild: vi.fn(async () => build),
      copy: vi.fn(async () => {}),
      checkUpdate: vi.fn(async () => "current" as const),
    };
    render(<AboutTab deps={deps} />);
    const version = screen.getByRole("region", { name: "Version" });
    expect(await within(version).findByText("722705c66c8d2a2b")).toBeInTheDocument();
    expect(within(version).queryByText("Game")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "COPY BUILD INFO" }));
    expect(deps.copy).toHaveBeenCalledWith(
      expect.stringMatching(/^YuriNet 0\.1\.0, build 722705c66c8d2a2b, no game installed, /),
    );
  });

  it("lists the newest changes, five at first and every one on request", async () => {
    setup();
    const news = screen.getByRole("region", { name: /What's new in 0\.1\.0/ });
    expect(within(news).getByText("7 November 2026")).toBeInTheDocument();
    expect(within(news).getAllByRole("listitem")).toHaveLength(5);
    await userEvent.click(within(news).getByRole("button", { name: "Show all 7 changes" }));
    const items = within(news).getAllByRole("listitem");
    expect(items).toHaveLength(7);
    expect(items[6]).toHaveTextContent("FIXEscape opens the pause menu.");
    expect(within(news).getByRole("button", { name: "Show fewer" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("says so when the changelog has nothing", () => {
    setup({ release: null });
    expect(screen.getByText("No changes are listed yet.")).toBeInTheDocument();
  });

  it("links the credits to their GitHub repositories, in a new tab", () => {
    setup();
    const web = screen.getByRole("link", { name: /THAI RA2/ });
    expect(web).toHaveAttribute("href", "https://github.com/icharge/redalert2-recomp");
    expect(web).toHaveAttribute("target", "_blank");
    expect(web).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: /sp00nz · redalert2-recomp/ })).toHaveAttribute(
      "href",
      "https://github.com/sp00nznet/redalert2-recomp",
    );
    expect(screen.getByRole("link", { name: /pcrecomp/ })).toHaveAttribute(
      "href",
      "https://github.com/sp00nznet/pcrecomp",
    );
  });

  it("says the game belongs to Electronic Arts and opens the licence list", async () => {
    setup();
    expect(screen.getByText(/© Electronic Arts Inc\./)).toBeInTheDocument();
    expect(screen.queryByText("Emscripten runtime")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "OPEN-SOURCE LICENCES" }));
    expect(screen.getByText("Emscripten runtime")).toBeInTheDocument();
  });

  it("copies the version, build and game for a bug report", async () => {
    const deps = setup();
    await screen.findByText("722705c66c8d2a2b");
    await userEvent.click(screen.getByRole("button", { name: "COPY BUILD INFO" }));
    expect(deps.copy).toHaveBeenCalledWith(
      expect.stringMatching(/^YuriNet 0\.1\.0, build 722705c66c8d2a2b, Yuri's Revenge, /),
    );
    expect(screen.getByRole("button", { name: "COPIED" })).toBeInTheDocument();
  });

  it("says when copying failed", async () => {
    setup({ copy: vi.fn(async () => Promise.reject(new Error("denied"))) });
    await userEvent.click(screen.getByRole("button", { name: "COPY BUILD INFO" }));
    expect(await screen.findByRole("button", { name: "COULDN'T COPY" })).toBeInTheDocument();
  });

  it.each([
    ["current", "Up to date."],
    ["found", "A new version is downloading. You'll be asked to reload."],
    ["none", "This page can't check for updates."],
  ] as const)("reports an update check that finds %s", async (result, message) => {
    setup({ checkUpdate: vi.fn(async () => result) });
    await userEvent.click(screen.getByRole("button", { name: "CHECK FOR UPDATES" }));
    expect(await screen.findByRole("status")).toHaveTextContent(message);
  });
});
