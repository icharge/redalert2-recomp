import { Theme } from "@radix-ui/themes";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GameRecord } from "../storage/manifest";
import { Library } from "./Library";

const game = (over: Partial<GameRecord> = {}): GameRecord => ({
  id: "ra2md",
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
  it("lists the game with its size and plays it", async () => {
    const { props, user } = show([game()]);
    expect(screen.getByText("Yuri's Revenge")).toBeInTheDocument();
    expect(screen.getByText(/1\.00 GB/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(props.onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: "ra2md" }));
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

  it("asks before removing, and removes when told to", async () => {
    const { props, user } = show([game()]);
    await user.click(screen.getByRole("button", { name: "Remove…" }));
    expect(await screen.findByText("Remove Yuri's Revenge?")).toBeInTheDocument();
    expect(props.onRemove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(props.onRemove).toHaveBeenCalledTimes(1));
  });

  it("keeps the game when the player says keep it", async () => {
    const { props, user } = show([game()]);
    await user.click(screen.getByRole("button", { name: "Remove…" }));
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
    await user.click(screen.getByRole("button", { name: "Remove…" }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    expect(await screen.findByText("storage said no")).toBeInTheDocument();
  });
});
