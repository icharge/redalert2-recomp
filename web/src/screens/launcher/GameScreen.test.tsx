import { Theme } from "@radix-ui/themes";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { formatBytes } from "../../components/format";
import type { ActiveInstall } from "../../storage/active-install";
import type { BuildInfo } from "../../storage/install";
import type { PartCounts, PartSizes } from "../../storage/install-parts";
import type { GameRecord } from "../../storage/manifest";
import type { SaveEntry } from "../../storage/save-library";
import { GameScreen } from "./GameScreen";

const MB = 1024 * 1024;
const GB = 1024 * MB;

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
const save = (name: string, over: Partial<SaveEntry> = {}): SaveEntry => ({
  name,
  size: 1_600_000,
  modified: Date.UTC(2026, 10, 2, 21, 14),
  info: null,
  written: true,
  imported: false,
  ...over,
});

// what the Manage panel measures for the default install: the game, two mods' worth of bytes, one map
const partSizes: PartSizes = { game: GB, mods: 2 * MB, maps: MB, saves: 0, settings: 0 };
const partCounts: PartCounts = { mods: 1, maps: 1, saves: 0 };
// the bytes the Remove dialog starts with: mods and custom maps are ticked
const startsWith = formatBytes(3 * MB);

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
    listSaves: vi.fn(async () => [] as SaveEntry[]),
    onDownloadSave: vi.fn(async () => {}),
    onRemoveSaves: vi.fn(async () => {}),
    measureParts: vi.fn(async () => partSizes),
    countParts: vi.fn(async () => partCounts),
    onRemoveParts: vi.fn(async () => {}),
    onReinstall: vi.fn(async () => {}),
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

const manage = () => screen.getByRole("region", { name: "MANAGE GAME" });

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

  it("BROWSE FILES is in the MANAGE GAME panel, not in INSTALLED", async () => {
    show();
    await screen.findByText("Cache and other");
    expect(
      within(screen.getByRole("region", { name: "INSTALLED" })).queryByRole("button", {
        name: "BROWSE FILES",
      }),
    ).toBeNull();
    expect(within(manage()).getByRole("button", { name: "BROWSE FILES" })).toBeInTheDocument();
  });

  it("downloads the saves of the chosen edition, and brings some in from a zip", async () => {
    const yr = game();
    const red = ra2();
    const { props, user } = show({ install: install([red, yr]), edition: red });
    await user.click(await screen.findByRole("button", { name: /SAVED GAMES…/ }));
    const dialog = await screen.findByRole("dialog");
    const redSaves = within(dialog).getByRole("region", { name: "Red Alert 2 saves" });
    await user.click(within(redSaves).getByRole("button", { name: "DOWNLOAD .ZIP" }));
    expect(await screen.findByText("The saved games are downloading.")).toBeInTheDocument();
    expect(props.onDownloadSaves).toHaveBeenCalledWith(expect.objectContaining({ id: "ra2" }));
    const zip = new File(["x"], "saves.zip", { type: "application/zip" });
    await user.upload(screen.getByLabelText("Import saves for Red Alert 2"), zip);
    expect(await screen.findByText("2 saved games brought in.")).toBeInTheDocument();
    expect(props.onImportSaves).toHaveBeenCalledWith(expect.objectContaining({ id: "ra2" }), zip);
  });

  it("lists each edition's saves and removes them with the install's editions, so a shared save is one", async () => {
    const yr = game();
    const red = ra2();
    const editions = [red, yr];
    const listSaves = vi.fn(async (g: GameRecord) =>
      g.id === "ra2" ? [save("SAVE0001.SAV", { imported: true })] : [],
    );
    const { props, user } = show({ install: install(editions), edition: red, listSaves });
    await user.click(await screen.findByRole("button", { name: /SAVED GAMES…/ }));
    const dialog = await screen.findByRole("dialog");
    expect(listSaves).toHaveBeenCalledWith(yr, editions);
    await user.click(within(dialog).getByRole("button", { name: "Remove SAVE0001.SAV" }));
    await user.click(within(dialog).getByRole("button", { name: "REMOVE" }));
    await waitFor(() =>
      expect(props.onRemoveSaves).toHaveBeenCalledWith(red, [expect.anything()], editions),
    );
  });

  it("lists the saves again after IMPORT .ZIP brings some in", async () => {
    let imported = false;
    const listSaves = vi.fn(async () => (imported ? [save("SAVE0042.SAV")] : []));
    const onImportSaves = vi.fn(async () => {
      imported = true;
      return "1 saved game brought in.";
    });
    const { props, user } = show({ listSaves, onImportSaves });
    const button = await screen.findByRole("button", { name: /SAVED GAMES…/ });
    await waitFor(() => expect(button).toHaveTextContent("None"));
    await user.click(button);
    const dialog = await screen.findByRole("dialog");
    await user.upload(
      within(dialog).getByLabelText("Import saves for Yuri’s Revenge"),
      new File(["x"], "saves.zip", { type: "application/zip" }),
    );
    expect(await within(dialog).findByText("1 saved game brought in.")).toBeInTheDocument();
    expect(await within(dialog).findByText("SAVE0042.SAV")).toBeInTheDocument();
    expect(props.measureParts).toHaveBeenCalledTimes(2);
  });

  it("shows how much of the browser's storage is used", async () => {
    show();
    expect(await screen.findByText("4.3 GB of 60 GB")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Browser storage used" })).toHaveAttribute(
      "aria-valuenow",
      "7",
    );
  });

  it("breaks the storage down by part, with the rest as cache and other", async () => {
    show();
    // the rows appear once the install is measured
    const row = async (label: string) =>
      (await within(manage()).findByText(label)).closest("li") as HTMLElement;
    expect(await row("Game content")).toHaveTextContent("1.00 GB");
    expect(await row("Mods")).toHaveTextContent("2.00 MB");
    expect(await row("Custom maps")).toHaveTextContent("1.00 MB");
    expect(await row("Saved games")).toHaveTextContent("0 B");
    expect(await row("Cache and other")).toBeInTheDocument();
  });

  it("hides Cache and other when the parts take all of the browser's storage", async () => {
    show({ estimate: async () => ({ quota: 60e9, usage: GB + 3 * MB }) });
    await screen.findByText("Game content");
    expect(screen.queryByText("Cache and other")).toBeNull();
  });

  it("keeps the breakdown and leaves the figure out when the browser gives no estimate", async () => {
    show({ estimate: async () => ({}) });
    expect(await screen.findByText("Game content")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/ of /)).toBeNull();
  });

  it("SAVED GAMES… shows how many saves there are, and lists them", async () => {
    const { user } = show({ listSaves: vi.fn(async () => [save("SAVE0003.SAV")]) });
    const button = await screen.findByRole("button", { name: /SAVED GAMES…/ });
    await waitFor(() => expect(button).toHaveTextContent("1 save"));
    await user.click(button);
    expect(await screen.findByRole("dialog")).toHaveTextContent("SAVE0003");
  });

  it("REMOVE… removes the parts ticked, then measures the install again", async () => {
    const { props, user } = show();
    await user.click(await screen.findByRole("button", { name: "REMOVE…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("REMOVE FROM THIS BROWSER");
    await user.click(within(dialog).getByRole("button", { name: `REMOVE ${startsWith}` }));
    await waitFor(() =>
      expect(props.onRemoveParts).toHaveBeenCalledWith(props.install, ["mods", "maps"]),
    );
    await waitFor(() => expect(props.measureParts).toHaveBeenCalledTimes(2));
  });

  it("CANCEL in REMOVE… removes nothing", async () => {
    const { props, user } = show();
    await user.click(await screen.findByRole("button", { name: "REMOVE…" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "CANCEL" }));
    expect(props.onRemoveParts).not.toHaveBeenCalled();
  });

  it("says why a removal failed", async () => {
    const { user } = show({
      onRemoveParts: vi.fn(async () => {
        throw new Error("storage said no");
      }),
    });
    await user.click(await screen.findByRole("button", { name: "REMOVE…" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: `REMOVE ${startsWith}` }));
    expect(await screen.findByRole("alert")).toHaveTextContent("storage said no");
  });

  it("REINSTALL GAME asks inline, and only REINSTALL reinstalls", async () => {
    const { props, user } = show();
    await user.click(await screen.findByRole("button", { name: "REINSTALL GAME" }));
    const ask = screen.getByRole("group", { name: "Confirm reinstall" });
    expect(ask).toHaveTextContent("Reinstall? Saves, settings and mods are kept.");
    await user.click(within(ask).getByRole("button", { name: "CANCEL" }));
    expect(screen.queryByRole("group", { name: "Confirm reinstall" })).toBeNull();
    expect(props.onReinstall).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "REINSTALL GAME" }));
    await user.click(
      within(screen.getByRole("group", { name: "Confirm reinstall" })).getByRole("button", {
        name: "REINSTALL",
      }),
    );
    await waitFor(() => expect(props.onReinstall).toHaveBeenCalledWith(props.install));
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
