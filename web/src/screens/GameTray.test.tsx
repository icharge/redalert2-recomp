import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { GameTray } from "./GameTray";

afterEach(() => localStorage.clear());

describe("GameTray", () => {
  it("starts collapsed: only the star", () => {
    render(
      <GameTray>
        <button type="button">SETTINGS</button>
      </GameTray>,
    );
    const star = screen.getByRole("button", { name: "Page controls" });
    expect(star).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("opens to show the page controls, and remembers it", async () => {
    const { unmount } = render(
      <GameTray>
        <button type="button">SETTINGS</button>
      </GameTray>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Page controls" }));
    expect(screen.getByRole("button", { name: "Page controls" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("toolbar", { name: "Page controls" })).toContainElement(
      screen.getByRole("button", { name: "SETTINGS" }),
    );
    unmount();
    render(
      <GameTray>
        <button type="button">SETTINGS</button>
      </GameTray>,
    );
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
  });

  it("goes quiet in a match, keeping the bar open and reachable", () => {
    localStorage.setItem("ra2-tray-open", "1");
    const { rerender } = render(
      <GameTray quiet={false}>
        <button type="button">SETTINGS</button>
      </GameTray>,
    );
    const tray = screen.getByRole("button", { name: "Page controls" }).parentElement!;
    expect(tray).not.toHaveAttribute("data-quiet");
    rerender(
      <GameTray quiet>
        <button type="button">SETTINGS</button>
      </GameTray>,
    );
    expect(tray).toHaveAttribute("data-quiet");
    expect(screen.getByRole("toolbar", { name: "Page controls" })).toContainElement(
      screen.getByRole("button", { name: "SETTINGS" }),
    );
  });

  it("keeps what is inside mounted while collapsed", () => {
    render(
      <GameTray>
        <span data-testid="kept">sound</span>
      </GameTray>,
    );
    expect(screen.getByTestId("kept")).toBeInTheDocument();
  });
});
