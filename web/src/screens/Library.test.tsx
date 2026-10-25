import { Theme } from "@radix-ui/themes";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameRecord } from "../storage/manifest";
import type { BuildInfo } from "../storage/install";
import { Library } from "./Library";

const game = (over: Partial<GameRecord> = {}): GameRecord => ({
  id: "ra2md",
  slot: 1,
  storage: "ra2md",
  title: "Yuri's Revenge",
  exeStamp: 1,
  importedAt: Date.UTC(2026, 9, 18),
  bytes: 1_073_741_824,
  complete: true,
  files: { "a.mix": { size: 1, lastModified: 1, done: true, needs: ["ra2md"], home: "ra2md" } },
  ...over,
});

function show(games: GameRecord[], over: Partial<Parameters<typeof Library>[0]> = {}) {
  const props = {
    games,
    onPlay: vi.fn(),
    onImport: vi.fn(),
    onRemove: vi.fn(async () => {}),
    onDownloadSaves: vi.fn(async () => "The saved games are downloading."),
    onImportSaves: vi.fn(async () => "2 saved games brought in."),
    estimate: async () => ({ quota: 10_000_000_000, usage: 2_000_000_000 }),
    ...over,
  };
  render(
    <Theme>
      <Library {...props} />
    </Theme>,
  );
  return { props, user: userEvent.setup() };
}

describe("Library", () => {
  it("reports missing content independently of the bundled runtime", () => {
    const build: BuildInfo = {
      games: {
        ra2md: {
          title: "Yuri's Revenge",
          exe: "gamemd.exe",
          ini: "RA2MD.INI",
          stamp: 1,
          build: "same",
          runtime: { edition: "ra2md", build: "same", exeSha256: "a", blowfishSha256: "b" },
        },
      },
    };
    show([game()], { build });
    expect(
      screen.getByText(/Missing required content: ra2\.mix, ra2md\.mix, maps01\.mix, multi\.mix/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
  });

  it("lists the game with its size and plays it", async () => {
    const { props, user } = show([game()]);
    expect(screen.getByText("Yuri's Revenge")).toBeInTheDocument();
    expect(screen.getByText(/1\.00 GB/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(props.onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: "ra2md" }));
  });

  it("groups editions in one installation and keeps a second copy in its own slot", () => {
    show(
      [
        game(),
        game({ id: "ra2", title: "Red Alert 2", storage: "ra2" }),
        game({ slot: 2, storage: "slot-2-ra2md" }),
      ],
      {
        installations: [
          { slot: 1, name: "Original", importedAt: 1 },
          { slot: 2, name: "Modded", importedAt: 2 },
        ],
      },
    );
    expect(document.querySelectorAll("[data-slot-id]")).toHaveLength(2);
    // one game's details at a time: a picker for the editions, and none where there is one edition
    expect(
      document.querySelector('[data-slot-id="1"]')?.querySelectorAll("[data-game-id]"),
    ).toHaveLength(1);
    expect(
      document.querySelector('[data-slot-id="1"]')?.querySelectorAll('[role="radio"]'),
    ).toHaveLength(2);
    expect(
      document.querySelector('[data-slot-id="2"]')?.querySelectorAll("[data-game-id]"),
    ).toHaveLength(1);
    expect(
      document.querySelector('[data-slot-id="2"]')?.querySelectorAll('[role="radio"]'),
    ).toHaveLength(0);
  });

  describe("with both editions in one installation", () => {
    const both = () => [game(), game({ id: "ra2", title: "Red Alert 2", storage: "slot-1-ra2" })];
    afterEach(() => localStorage.clear());

    it("lets the player choose which edition to start, and plays that one", async () => {
      const { props, user } = show(both());
      expect(screen.getByRole("radio", { name: "Yuri's Revenge" })).toBeChecked();
      await user.click(screen.getByRole("radio", { name: "Red Alert 2" }));
      expect(document.querySelector("[data-game-id]")?.getAttribute("data-game-id")).toBe("ra2");
      await user.click(screen.getByRole("button", { name: "Play" }));
      expect(props.onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: "ra2" }));
    });

    it("keeps the saves, settings and mods of the edition that is chosen", async () => {
      const { props, user } = show(both(), { modManager: (g) => <span>mods of {g.id}</span> });
      expect(screen.getByText("mods of ra2md")).toBeInTheDocument();
      await user.click(screen.getByRole("radio", { name: "Red Alert 2" }));
      expect(screen.getByText("mods of ra2")).toBeInTheDocument();
      await user.click(screen.getByText("Download saves"));
      expect(props.onDownloadSaves).toHaveBeenCalledWith(expect.objectContaining({ id: "ra2" }));
    });

    it("remembers the choice the next time", async () => {
      const first = show(both());
      await first.user.click(screen.getByRole("radio", { name: "Red Alert 2" }));
      cleanup();
      show(both());
      expect(screen.getByRole("radio", { name: "Red Alert 2" })).toBeChecked();
    });

    it("browses the files of the whole installation, not one edition", async () => {
      const browseSource = vi.fn(() => ({
        label: "Both — files",
        rootLabel: "Both (files)",
        list: async () => [],
        readText: async () => "",
      }));
      const { user } = show(both(), {
        browseSource,
        installations: [{ slot: 1, name: "Both", importedAt: 1 }],
      });
      await user.click(screen.getByRole("button", { name: "Browse files for Both" }));
      expect(browseSource).toHaveBeenCalledWith(expect.objectContaining({ slot: 1 }), [
        expect.objectContaining({ id: "ra2md" }),
        expect.objectContaining({ id: "ra2" }),
      ]);
      expect(await screen.findByRole("dialog")).toHaveTextContent("Both — files");
    });
  });

  it("offers resume when an edition has not been registered yet", () => {
    show([game({ id: "ra2", title: "Red Alert 2" })], {
      installations: [{ slot: 1, name: "Both games", importedAt: 1, editions: ["ra2", "ra2md"] }],
    });
    expect(screen.getByRole("button", { name: "Resume import" })).toBeInTheDocument();
  });

  it("shows how much of the browser's storage is used", async () => {
    show([game()]);
    expect(await screen.findByText(/the browser allows this site/)).toBeInTheDocument();
  });

  it("will not play a game whose import did not finish, and says so", () => {
    show([game({ complete: false })]);
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByText(/did not finish/)).toBeInTheDocument();
  });

  it("opens a read-only browser for the selected game's imported files", async () => {
    const { user } = show([game()]);
    await user.click(screen.getByRole("button", { name: "Browse files for Yuri's Revenge" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Yuri's Revenge — imported files");
    expect(screen.getByText(/cannot be changed or downloaded/)).toBeInTheDocument();
  });

  it("asks before removing, and removes when told to", async () => {
    const { props, user } = show([game()]);
    await user.click(screen.getByRole("button", { name: "Remove Yuri's Revenge" }));
    expect(await screen.findByText("Remove Yuri's Revenge?")).toBeInTheDocument();
    expect(props.onRemove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(props.onRemove).toHaveBeenCalledTimes(1));
  });

  it("keeps the game when the player says keep it", async () => {
    const { props, user } = show([game()]);
    await user.click(screen.getByRole("button", { name: "Remove Yuri's Revenge" }));
    await user.click(await screen.findByRole("button", { name: "Keep it" }));
    expect(props.onRemove).not.toHaveBeenCalled();
  });

  it("downloads the saves, and brings some in from a zip, saying what happened", async () => {
    const { props, user } = show([game()]);
    await user.click(screen.getByText("Download saves"));
    expect(await screen.findByText("The saved games are downloading.")).toBeInTheDocument();
    expect(props.onDownloadSaves).toHaveBeenCalledWith(expect.objectContaining({ id: "ra2md" }));
    const zip = new File(["x"], "saves.zip", { type: "application/zip" });
    await user.upload(screen.getByLabelText("Saves for Yuri's Revenge"), zip);
    expect(await screen.findByText("2 saved games brought in.")).toBeInTheDocument();
    expect(props.onImportSaves).toHaveBeenCalledWith(expect.objectContaining({ id: "ra2md" }), zip);
  });

  it("says why a removal failed", async () => {
    const { user } = show([game()], {
      onRemove: async () => {
        throw new Error("storage said no");
      },
    });
    await user.click(screen.getByRole("button", { name: "Remove Yuri's Revenge" }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    expect(await screen.findByText("storage said no")).toBeInTheDocument();
  });
});
