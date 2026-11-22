import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlayerMenu } from "./PlayerMenu";

function show(self = false) {
  const props = {
    onAddFriend: vi.fn(),
    onMessage: vi.fn(),
    onProfile: vi.fn(),
    onClose: vi.fn(),
  };
  render(<PlayerMenu name="Dave" left={10} top={20} self={self} {...props} />);
  return props;
}

describe("PlayerMenu", () => {
  it("offers Add friend, Message and Profile for a player, and closes after a choice", async () => {
    const props = show();
    expect(screen.getByRole("menu", { name: "Player Dave" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Add friend" }));
    expect(props.onAddFriend).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("menuitem", { name: "Profile" }));
    expect(props.onProfile).toHaveBeenCalledOnce();
  });

  it("offers only Profile for the player's own name", () => {
    show(true);
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Profile"]);
  });

  it("closes on Escape and on a click elsewhere", () => {
    const props = show();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(document.body);
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
