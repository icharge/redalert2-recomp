import { Theme } from "@radix-ui/themes";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GameRecord } from "../../../storage/manifest";
import type { SaveEntry } from "../../../storage/save-library";
import { SavedGamesDialog, saveDetails, saveTitle, type SavesGroup } from "./SavedGamesDialog";

const ra2: GameRecord = {
  id: "ra2",
  slot: 1,
  storage: "ra2",
  title: "Red Alert 2",
  exeStamp: 0,
  importedAt: 0,
  bytes: 0,
  complete: true,
  files: {},
};

const yr: GameRecord = { ...ra2, id: "ra2md", slot: 2, storage: "ra2md", title: "Yuri’s Revenge" };

// local time, so the details line reads 21:14 wherever the tests run
const NOV_2_2026_2114 = new Date(2026, 10, 2, 21, 14).getTime();

function save(name: string, patch: Partial<SaveEntry> = {}): SaveEntry {
  return {
    name,
    size: 1_600_000,
    modified: NOV_2_2026_2114,
    info: null,
    written: true,
    imported: false,
    ...patch,
  };
}

const chrono = save("SAVE0003.SAV", {
  info: {
    description: "Chrono Defense",
    scenario: "Allied campaign · Mission 5",
    savedAt: NOV_2_2026_2114,
  },
});
const second = save("SAVE0002.SAV", { size: 1_400_000 });
const third = save("SAVE0001.SAV", { size: 1_200_000 });
const timeShift = save("SAVE0005.SAV", {
  info: {
    description: "Time Shift",
    scenario: "Allied campaign · Mission 1",
    savedAt: NOV_2_2026_2114,
  },
  size: 1_800_000,
});

const groups: SavesGroup[] = [
  { game: ra2, saves: [chrono, second, third] },
  { game: yr, saves: [timeShift] },
];

function setup() {
  const handlers = {
    onOpenChange: vi.fn(),
    onDownload: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onDownloadZip: vi.fn().mockResolvedValue("Saved 3 saves to a zip."),
    onImportZip: vi.fn().mockResolvedValue("Imported 1 save."),
  };
  const ui = (open: boolean) => (
    <Theme>
      <SavedGamesDialog open={open} groups={groups} {...handlers} />
    </Theme>
  );
  const view = render(ui(true));
  return { ...view, handlers, rerender: (open: boolean) => view.rerender(ui(open)) };
}

describe("saveTitle and saveDetails", () => {
  it("titles a save it could not read by its file name", () => {
    expect(saveTitle({ ...second, name: "SAVE0004.SAV", info: null })).toBe("SAVE0004");
  });

  it("formats the details line", () => {
    expect(
      saveDetails({
        ...second,
        info: { description: "x", savedAt: new Date(2026, 10, 2, 21, 14).getTime() },
      }),
    ).toMatch(/^Saved 2 Nov 2026, \d\d:14$/);
  });
});

describe("SavedGamesDialog", () => {
  it("groups saves by edition with their titles, details and file names", () => {
    setup();
    expect(screen.getByRole("heading", { name: "SAVED GAMES" })).toBeInTheDocument();

    const ra2Group = within(screen.getByRole("region", { name: "Red Alert 2 saves" }));
    expect(ra2Group.getByRole("heading", { name: "RED ALERT 2" })).toBeInTheDocument();
    expect(ra2Group.getByText("3 saves")).toBeInTheDocument();
    expect(ra2Group.getByText("Chrono Defense")).toBeInTheDocument();
    expect(
      ra2Group.getByText("Allied campaign · Mission 5 · Saved 2 Nov 2026, 21:14"),
    ).toBeInTheDocument();
    expect(ra2Group.getByText("SAVE0003.SAV")).toBeInTheDocument();

    const yrGroup = within(screen.getByRole("region", { name: "Yuri’s Revenge saves" }));
    expect(yrGroup.getByRole("heading", { name: "YURI’S REVENGE" })).toBeInTheDocument();
    expect(yrGroup.getByText("1 save")).toBeInTheDocument();
  });

  it("asks inline before removing one save, and KEEP cancels", async () => {
    const user = userEvent.setup();
    const { handlers } = setup();

    await user.click(screen.getByRole("button", { name: "Remove SAVE0003.SAV" }));
    const confirm = within(screen.getByRole("group", { name: "Confirm removal" }));
    expect(confirm.getByText("Remove this save?")).toBeInTheDocument();

    await user.click(confirm.getByRole("button", { name: "KEEP" }));
    expect(screen.queryByText("Remove this save?")).not.toBeInTheDocument();
    expect(handlers.onRemove).not.toHaveBeenCalled();
  });

  it("removes one save after REMOVE", async () => {
    const user = userEvent.setup();
    const { handlers } = setup();

    await user.click(screen.getByRole("button", { name: "Remove SAVE0003.SAV" }));
    await user.click(
      within(screen.getByRole("group", { name: "Confirm removal" })).getByRole("button", {
        name: "REMOVE",
      }),
    );

    expect(handlers.onRemove).toHaveBeenCalledTimes(1);
    expect(handlers.onRemove).toHaveBeenCalledWith(ra2, [chrono]);
  });

  it("asks before removing all, then removes every save of every edition", async () => {
    const user = userEvent.setup();
    const { handlers } = setup();

    await user.click(screen.getByRole("button", { name: "REMOVE ALL" }));
    const strip = within(screen.getByRole("group", { name: "Confirm remove all" }));
    expect(strip.getByText("Remove all 4 saves?")).toBeInTheDocument();
    expect(
      strip.getByText("They can't be brought back. Download them first to keep them."),
    ).toBeInTheDocument();
    expect(handlers.onRemove).not.toHaveBeenCalled();

    await user.click(strip.getByRole("button", { name: "REMOVE ALL" }));
    expect(handlers.onRemove).toHaveBeenCalledTimes(2);
    expect(handlers.onRemove).toHaveBeenCalledWith(ra2, [chrono, second, third]);
    expect(handlers.onRemove).toHaveBeenCalledWith(yr, [timeShift]);
  });

  it("downloads one save", async () => {
    const user = userEvent.setup();
    const { handlers } = setup();

    await user.click(screen.getByRole("button", { name: "Download SAVE0003.SAV" }));

    expect(handlers.onDownload).toHaveBeenCalledWith(ra2, chrono);
  });

  it("shows the error and keeps the row when a removal fails", async () => {
    const user = userEvent.setup();
    const { handlers } = setup();
    handlers.onRemove.mockRejectedValueOnce(new Error("The game is still using this save."));

    await user.click(screen.getByRole("button", { name: "Remove SAVE0003.SAV" }));
    await user.click(
      within(screen.getByRole("group", { name: "Confirm removal" })).getByRole("button", {
        name: "REMOVE",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The game is still using this save.",
    );
    expect(screen.getByText("Chrono Defense")).toBeInTheDocument();
    // the row stays in its confirmation, so the removal can be retried or kept
    expect(screen.getByRole("group", { name: "Confirm removal" })).toBeInTheDocument();
  });

  it("shows the message a zip download resolves to, as a status line", async () => {
    const user = userEvent.setup();
    const { handlers } = setup();

    const ra2Group = within(screen.getByRole("region", { name: "Red Alert 2 saves" }));
    await user.click(ra2Group.getByRole("button", { name: "DOWNLOAD .ZIP" }));

    expect(handlers.onDownloadZip).toHaveBeenCalledWith(ra2);
    expect(await screen.findByRole("status")).toHaveTextContent("Saved 3 saves to a zip.");
  });

  it("imports a zip into one edition and shows the message it resolves to", async () => {
    const user = userEvent.setup();
    const { handlers } = setup();
    const file = new File(["zip"], "saves.zip", { type: "application/zip" });

    const yrGroup = within(screen.getByRole("region", { name: "Yuri’s Revenge saves" }));
    await user.click(yrGroup.getByRole("button", { name: "IMPORT .ZIP" }));
    await user.upload(screen.getByLabelText("Import saves for Yuri’s Revenge"), file);

    expect(handlers.onImportZip).toHaveBeenCalledWith(yr, file);
    expect(await screen.findByRole("status")).toHaveTextContent("Imported 1 save.");
  });

  it("closing the dialog cancels an open confirmation", async () => {
    const user = userEvent.setup();
    const { handlers, rerender } = setup();

    await user.click(screen.getByRole("button", { name: "Remove SAVE0003.SAV" }));
    expect(screen.getByText("Remove this save?")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(handlers.onOpenChange).toHaveBeenCalledWith(false);

    rerender(false);
    rerender(true);
    expect(screen.queryByText("Remove this save?")).not.toBeInTheDocument();
    expect(handlers.onRemove).not.toHaveBeenCalled();
  });
});
