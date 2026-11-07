import { Theme } from "@radix-ui/themes";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActiveInstall } from "../../storage/active-install";
import type { BuildInfo } from "../../storage/install";
import type { GameRecord } from "../../storage/manifest";
import { GameScreen } from "./GameScreen";

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
const ra2 = (over: Partial<GameRecord> = {}) =>
  game({ id: "ra2", title: "Red Alert 2", storage: "slot-1-ra2", ...over });
const install = (
  editions: GameRecord[],
  over: Partial<ActiveInstall["installation"]> = {},
): ActiveInstall => ({
  installation: { slot: editions[0]?.slot ?? 1, name: "Original", importedAt: 1, ...over },
  editions,
});

function show(over: Partial<Parameters<typeof GameScreen>[0]> = {}) {
  const yr = game();
  const props = {
    install: install([yr]),
    edition: yr,
    others: [],
    onResume: vi.fn(),
    onImport: vi.fn(),
    onRemove: vi.fn(async () => {}),
    onDownloadSaves: vi.fn(async () => "The saved games are downloading."),
    onImportSaves: vi.fn(async () => "2 saved games brought in."),
    estimate: async () => ({ quota: 60e9, usage: 4.3e9 }),
    ...over,
  };
  render(
    <Theme>
      <GameScreen {...props} />
    </Theme>,
  );
  return { props, user: userEvent.setup() };
}

const fullBuild: BuildInfo = {
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

describe("GameScreen", () => {
  it("lists each edition with its readiness and the install's size", () => {
    show({ install: install([ra2(), game()]) });
    const installed = screen.getByRole("region", { name: "INSTALLED" });
    expect(within(installed).getByText("Red Alert 2")).toBeInTheDocument();
    expect(within(installed).getByText("Yuri’s Revenge")).toBeInTheDocument();
    expect(installed).toHaveTextContent("2.00 GB · 2 files");
    expect(within(installed).getAllByText("Ready")).toHaveLength(2);
  });

  it("reports missing content for the build", () => {
    show({ build: fullBuild });
    expect(
      screen.getByText(/^Missing ra2\.mix, ra2md\.mix, maps01\.mix, multi\.mix/),
    ).toBeInTheDocument();
  });

  it("movies missing shows ADD MOVIES", async () => {
    const files = Object.fromEntries(
      ["ra2.mix", "ra2md.mix", "maps01.mix", "multi.mix"].map((name) => [
        name,
        { size: 100, lastModified: 1, done: true, needs: ["ra2md" as const], home: "ra2md" },
      ]),
    );
    const { props, user } = show({
      build: fullBuild,
      install: install([game({ files })]),
      edition: game({ files }),
    });
    expect(screen.getByText("Movies not installed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ADD MOVIES" }));
    expect(props.onResume).toHaveBeenCalledWith(1);
  });

  it("an unfinished import says so and offers RESUME INSTALL", async () => {
    const { props, user } = show({ install: install([game({ complete: false })]) });
    expect(screen.getByText("Install not finished")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "RESUME INSTALL" }));
    expect(props.onResume).toHaveBeenCalledWith(1);
  });

  it("offers resume when an edition has not been registered yet", () => {
    show({ install: install([ra2()], { editions: ["ra2", "ra2md"] }) });
    expect(screen.getByRole("button", { name: "RESUME INSTALL" })).toBeInTheDocument();
  });

  it("is titled GAME, with no rename and no second copy", () => {
    show({ install: install([game()], { displayName: "Modded" }) });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("GAME");
    expect(screen.queryByRole("button", { name: /^Rename/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "INSTALL ANOTHER COPY" })).toBeNull();
  });

  it("browses the files of the whole installation", async () => {
    const browseSource = vi.fn(() => ({
      label: "Both — files",
      rootLabel: "Both (files)",
      list: async () => [],
      readText: async () => "",
    }));
    const { user } = show({ browseSource, install: install([ra2(), game()]) });
    await user.click(screen.getByRole("button", { name: "BROWSE FILES" }));
    expect(browseSource).toHaveBeenCalledWith(expect.objectContaining({ slot: 1 }), [
      expect.objectContaining({ id: "ra2" }),
      expect.objectContaining({ id: "ra2md" }),
    ]);
    expect(await screen.findByRole("dialog")).toHaveTextContent("Both — files");
  });

  it("opens a read-only browser of the imported files by default", async () => {
    const { user } = show();
    await user.click(screen.getByRole("button", { name: "BROWSE FILES" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Yuri's Revenge — imported files");
  });

  it("downloads the saves of the chosen edition, and brings some in from a zip", async () => {
    const yr = game();
    const red = ra2();
    const { props, user } = show({ install: install([red, yr]), edition: red });
    await user.click(screen.getByRole("button", { name: "DOWNLOAD .ZIP" }));
    expect(await screen.findByText("The saved games are downloading.")).toBeInTheDocument();
    expect(props.onDownloadSaves).toHaveBeenCalledWith(expect.objectContaining({ id: "ra2" }));
    const zip = new File(["x"], "saves.zip", { type: "application/zip" });
    await user.upload(screen.getByLabelText("Saves for Red Alert 2"), zip);
    expect(await screen.findByText("2 saved games brought in.")).toBeInTheDocument();
    expect(props.onImportSaves).toHaveBeenCalledWith(expect.objectContaining({ id: "ra2" }), zip);
  });

  it("shows how much of the browser's storage is used", async () => {
    show();
    expect(await screen.findByText("4.3 GB of 60 GB")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Browser storage used" })).toHaveAttribute(
      "aria-valuenow",
      "7",
    );
  });

  it("asks before removing, saying the size and that saves and settings are kept", async () => {
    const { props, user } = show();
    await user.click(screen.getByRole("button", { name: "REMOVE GAME" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("REMOVE YURI'S REVENGE?");
    expect(dialog).toHaveTextContent("1.00 GB");
    expect(dialog).toHaveTextContent("Saved games and settings are kept.");
    expect(props.onRemove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "REMOVE" }));
    await waitFor(() =>
      expect(props.onRemove).toHaveBeenCalledWith(expect.objectContaining({ slot: 1 })),
    );
  });

  it("keeps the game when the player says keep it", async () => {
    const { props, user } = show();
    await user.click(screen.getByRole("button", { name: "REMOVE GAME" }));
    await user.click(await screen.findByRole("button", { name: "KEEP IT" }));
    expect(props.onRemove).not.toHaveBeenCalled();
  });

  it("says why a removal failed", async () => {
    const { user } = show({
      onRemove: async () => {
        throw new Error("storage said no");
      },
    });
    await user.click(screen.getByRole("button", { name: "REMOVE GAME" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "REMOVE" }),
    );
    expect(await screen.findByText("storage said no")).toBeInTheDocument();
  });

  it("offers to delete the copies left from the slot system, after asking", async () => {
    const copy = (slot: number) =>
      install([game({ slot, storage: `slot-${slot}-ra2md` })], { slot, name: "Copy" });
    const { props, user } = show({ others: [copy(2), copy(3)] });
    const panel = screen.getByRole("region", { name: "OLDER COPIES" });
    expect(panel).toHaveTextContent("2 older copies of the game take 2.00 GB.");
    expect(within(panel).queryByRole("button", { name: "USE" })).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "DELETE THEM" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("DELETE 2 OLDER COPIES?");
    expect(dialog).toHaveTextContent("Deletes 2.00 GB from this browser.");
    expect(props.onRemove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "DELETE" }));
    await waitFor(() => expect(props.onRemove).toHaveBeenCalledTimes(2));
    expect(props.onRemove).toHaveBeenCalledWith(expect.objectContaining({ slot: 2 }));
    expect(props.onRemove).toHaveBeenCalledWith(expect.objectContaining({ slot: 3 }));
    expect(props.onRemove).not.toHaveBeenCalledWith(expect.objectContaining({ slot: 1 }));
  });

  it("has no OLDER COPIES panel with one install", () => {
    show();
    expect(screen.queryByRole("region", { name: "OLDER COPIES" })).toBeNull();
  });

  it("nothing installed shows INSTALL THE GAME", async () => {
    const { props, user } = show({ install: null, edition: null });
    await user.click(screen.getByRole("button", { name: "INSTALL THE GAME" }));
    expect(props.onImport).toHaveBeenCalled();
  });
});
