import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExitConfirm } from "./ExitConfirm";

function show(open = true) {
  const onAnswer = vi.fn();
  render(
    <Theme>
      <ExitConfirm open={open} onAnswer={onAnswer} returnFocus={() => {}} />
    </Theme>,
  );
  return onAnswer;
}

describe("ExitConfirm", () => {
  it("asks LEAVE THE GAME? with STAY and EXIT GAME", async () => {
    const onAnswer = show();
    expect(screen.getByRole("dialog", { name: "LEAVE THE GAME?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "EXIT GAME" }));
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it("STAY answers no", async () => {
    const onAnswer = show();
    await userEvent.click(screen.getByRole("button", { name: "STAY" }));
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it("shows nothing when not asked", () => {
    show(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
