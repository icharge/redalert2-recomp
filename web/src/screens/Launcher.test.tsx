import { Theme } from "@radix-ui/themes";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameRecord } from "../storage/manifest";
import { Launcher } from "./Launcher";
import type { LibraryProps } from "./Library";

const game = (id: "ra2" | "ra2md", slot = 1): GameRecord => ({
  id,
  slot,
  storage: `slot-${slot}-${id}`,
  title: id === "ra2" ? "Red Alert 2" : "Yuri's Revenge",
  exeStamp: 1,
  importedAt: 1,
  bytes: 1024,
  complete: true,
  files: {},
});
function show(over: Partial<LibraryProps> = {}) {
  const props: LibraryProps = {
    games: [game("ra2"), game("ra2md")],
    installations: [{ slot: 1, name: "Classic collection", importedAt: 1 }],
    onPlay: vi.fn(),
    onImport: vi.fn(),
    onResume: vi.fn(),
    onRemove: vi.fn(async () => {}),
    onDownloadSaves: vi.fn(async () => "Downloaded saves."),
    onImportSaves: vi.fn(async () => "Imported saves."),
    estimate: async () => ({}),
    ...over,
  };
  return {
    ...render(
      <Theme>
        <Launcher {...props} />
      </Theme>,
    ),
    props,
    user: userEvent.setup(),
  };
}
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("selectable launcher themes", () => {
  it("offers the original and all six trials, preserving edition and real Play across every theme", async () => {
    const { user, props } = show();
    const picker = screen.getByRole("combobox", { name: "Launcher theme" });
    expect(picker.querySelectorAll("option")).toHaveLength(7);
    expect(picker).toHaveValue("retro");
    await user.click(screen.getByRole("tab", { name: /Red Alert 2/ }));
    for (const id of [
      "skeuomorphic",
      "framed-tech",
      "game-ui",
      "game-feel",
      "atmosphere",
      "animation",
      "retro",
    ]) {
      await user.selectOptions(picker, id);
      expect(document.querySelector("[data-theme]")).toHaveAttribute("data-theme", id);
      expect(screen.getByRole("tab", { name: /Red Alert 2/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await user.click(screen.getByRole("button", { name: "Play" }));
      expect(props.onPlay).toHaveBeenLastCalledWith(expect.objectContaining({ id: "ra2" }));
    }
  });
  it("remembers appearance and installation on remount", async () => {
    const data = {
      games: [game("ra2", 1), game("ra2md", 2)],
      installations: [
        { slot: 1, name: "Original", importedAt: 1 },
        { slot: 2, name: "Modded", importedAt: 2 },
      ],
    };
    const { user, unmount } = show(data);
    await user.selectOptions(screen.getByRole("combobox", { name: "Installation" }), "2");
    await user.selectOptions(screen.getByRole("combobox", { name: "Launcher theme" }), "game-ui");
    unmount();
    show(data);
    expect(screen.getByRole("combobox", { name: "Launcher theme" })).toHaveValue("game-ui");
    expect(screen.getByRole("combobox", { name: "Installation" })).toHaveValue("2");
  });
  it("still switches appearance when storage writes fail", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { user } = show();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Launcher theme" }),
      "atmosphere",
    );
    expect(document.querySelector("[data-theme]")).toHaveAttribute("data-theme", "atmosphere");
  });
  it("uses the selected installation for settings and save actions", async () => {
    const { user, props } = show();
    await user.click(screen.getByRole("button", { name: "Game settings" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Yuri's Revenge settings");
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Game settings" })).toHaveFocus(),
    );
    await user.click(screen.getByRole("button", { name: "Saved games" }));
    await user.click(screen.getByRole("button", { name: "Download saves" }));
    await waitFor(() =>
      expect(props.onDownloadSaves).toHaveBeenCalledWith(expect.objectContaining({ id: "ra2md" })),
    );
  });
  it("retains import for an empty library and resume for unfinished installations", async () => {
    const empty = show({ games: [], installations: [] });
    await empty.user.click(screen.getByRole("button", { name: "Add installation" }));
    expect(empty.props.onImport).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();
    empty.unmount();
    const unfinished = show({ games: [{ ...game("ra2"), complete: false }] });
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    await unfinished.user.click(screen.getByRole("button", { name: "Resume import" }));
    expect(unfinished.props.onResume).toHaveBeenCalledWith(1);
  });
  it("does not enable Play when the runtime or required content is missing", () => {
    show({ build: { games: {} } });
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/Runtime not built/);
  });

  it("keeps an open file browser source stable while installation records refresh", async () => {
    const browseSource = vi.fn(() => ({
      mode: "read-only" as const,
      title: "Collection files",
      label: "Collection files",
      rootLabel: "Files",
      list: async () => [],
      readText: async () => "",
    }));
    const view = show({ browseSource });
    await view.user.click(screen.getByRole("button", { name: "Browse files" }));
    await screen.findByRole("dialog");
    expect(browseSource).toHaveBeenCalledTimes(1);
    view.rerender(
      <Theme>
        <Launcher
          {...view.props}
          games={[...view.props.games]}
          installations={[...view.props.installations!]}
        />
      </Theme>,
    );
    expect(browseSource).toHaveBeenCalledTimes(1);
  });

  it("uses edition changes made in collection management immediately", async () => {
    const { user, props } = show();
    await user.click(screen.getByRole("tab", { name: /Red Alert 2/ }));
    await user.click(screen.getByRole("button", { name: "Manage collection" }));
    await user.click(screen.getByRole("radio", { name: "Yuri's Revenge" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Manage collection" })).toHaveFocus(),
    );
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(props.onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: "ra2md" }));
  });
});
