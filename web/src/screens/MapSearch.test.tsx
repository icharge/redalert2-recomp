import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MapList } from "../game/protocol";
import { MapSearch } from "./MapSearch";

const LIST: MapList = { x: 332, y: 186, w: 177, h: 264, shown: 48, total: 48, matched: -1, seq: 0 };
/** the picture drawn at twice its size, 10 px from the stage's top left */
const place = (x: number, y: number) => ({ left: 10 + x * 2, top: 10 + y * 2, scale: 2 });

function show(list: MapList | null, onSearch = vi.fn()) {
  const view = render(
    <Theme>
      <MapSearch list={list} place={place} onSearch={onSearch} />
    </Theme>,
  );
  const again = (next: MapList | null) =>
    view.rerender(
      <Theme>
        <MapSearch list={next} place={place} onSearch={onSearch} />
      </Theme>,
    );
  return { onSearch, again };
}

describe("MapSearch", () => {
  it("shows nothing while the game's map list is not up", () => {
    show(null);
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("sits over the map list, just above it, as wide as it", () => {
    show(LIST);
    const box = screen.getByRole("search", { name: "Map search" });
    expect(box.style.left).toBe(`${10 + 332 * 2}px`);
    expect(box.style.width).toBe(`${177 * 2}px`);
    expect(parseFloat(box.style.top)).toBeLessThan(10 + 186 * 2);
  });

  it("starts the list unfiltered when it comes up, then sends each change with a new number", async () => {
    const { onSearch } = show(LIST);
    expect(onSearch).toHaveBeenLastCalledWith("", 0, 1);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search maps" }), "la");
    expect(onSearch).toHaveBeenLastCalledWith("la", 0, 3);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Players" }), "4");
    expect(onSearch).toHaveBeenLastCalledWith("la", 4, 4);
  });

  it("says how many maps the search shows, and when none match", async () => {
    const { again } = show(LIST);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search maps" }), "lake");
    again({ ...LIST, shown: 3, matched: 3, seq: 5 });
    expect(screen.getByText("3 of 48 maps")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search maps" }), "zz");
    again({ ...LIST, shown: 48, matched: 0, seq: 7 });
    expect(screen.getByText("No maps match")).toBeInTheDocument();
  });

  it("forgets the search when the list closes, and starts again when it comes back", async () => {
    const { onSearch, again } = show(LIST);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search maps" }), "war");
    again(null);
    again(LIST);
    expect(screen.getByRole("searchbox", { name: "Search maps" })).toHaveValue("");
    expect(onSearch).toHaveBeenLastCalledWith("", 0, 5);
  });

  it("Escape clears the search and hands the keys back to the game", async () => {
    const { onSearch } = show(LIST);
    const box = screen.getByRole("searchbox", { name: "Search maps" });
    await userEvent.type(box, "war{Escape}");
    expect(box).toHaveValue("");
    expect(onSearch).toHaveBeenLastCalledWith("", 0, 5);
    expect(box).not.toHaveFocus();
  });
});
