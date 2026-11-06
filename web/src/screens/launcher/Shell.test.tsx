import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { GameId } from "../../storage/install";
import type { GameRecord } from "../../storage/manifest";
import { Shell } from "./Shell";

const g = (id: GameId): GameRecord => ({
  id,
  slot: 1,
  storage: id,
  title: id,
  exeStamp: 0,
  importedAt: 0,
  bytes: 0,
  complete: true,
  files: {},
});
const ra2 = g("ra2");
const yr = g("ra2md");

function renderShell(props: Partial<Parameters<typeof Shell>[0]> = {}, path = "/") {
  const onEdition = vi.fn();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Shell
        editions={[ra2, yr]}
        edition={yr}
        onEdition={onEdition}
        estimate={async () => ({})}
        {...props}
      >
        <p>content</p>
      </Shell>
    </MemoryRouter>,
  );
  return { onEdition };
}

describe("Shell", () => {
  it("marks the current tab", () => {
    renderShell({}, "/mods");
    expect(screen.getByRole("link", { name: "MODS" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "PLAY" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "GAME" })).toHaveAttribute("href", "/manage");
  });

  it("has no Maps or Ladder tab yet", () => {
    renderShell();
    expect(screen.queryByRole("link", { name: "MAPS" })).toBeNull();
    expect(screen.queryByRole("link", { name: "LADDER" })).toBeNull();
  });

  it("shows one tile per edition", () => {
    renderShell({ editions: [ra2], edition: ra2 });
    expect(screen.getByRole("button", { name: "Red Alert 2" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Yuri’s Revenge" })).toBeNull();
  });

  it("shows no tiles with nothing installed", () => {
    renderShell({ editions: [], edition: null });
    expect(screen.queryByRole("button", { name: "Red Alert 2" })).toBeNull();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings/launcher",
    );
  });

  it("switches edition", async () => {
    const { onEdition } = renderShell();
    await userEvent.click(screen.getByRole("button", { name: "Red Alert 2" }));
    expect(onEdition).toHaveBeenCalledWith(ra2);
  });

  it("shows the storage figure", async () => {
    renderShell({ estimate: async () => ({ usage: 4.3e9, quota: 60e9 }) });
    expect(await screen.findByText("4.3 / 60 GB")).toBeInTheDocument();
  });

  it("logo falls back to text", () => {
    renderShell();
    fireEvent.error(screen.getByRole("img", { name: "YuriNet" }));
    expect(screen.getByText("YURINET")).toBeInTheDocument();
  });

  it("edition icon falls back to its short name", () => {
    renderShell();
    const tile = screen.getByRole("button", { name: "Red Alert 2" });
    fireEvent.error(tile.querySelector("img")!);
    expect(tile).toHaveTextContent("RA2");
  });

  it("renders the screen", () => {
    renderShell();
    expect(screen.getByText("content")).toBeInTheDocument();
  });
});

describe("Shell settings link", () => {
  it("is current on any settings tab", () => {
    renderShell({}, "/settings/audio");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  });
});
