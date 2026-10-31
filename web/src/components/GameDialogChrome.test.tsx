import { Dialog, Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GameDialogChrome, gameDialogButtonClass } from "./GameDialogChrome";
import { GAME_DIALOG_PALETTE } from "./game-dialog-palette";

function show() {
  const { container } = render(
    <Theme>
      <Dialog.Root open>
        <Dialog.Content>
          <GameDialogChrome title="Community">
            <p>The game asked for this page.</p>
            <button type="button" className={gameDialogButtonClass}>
              Close
            </button>
          </GameDialogChrome>
        </Dialog.Content>
      </Dialog.Root>
    </Theme>,
  );
  return container;
}

describe("GameDialogChrome", () => {
  it("labels the dialog with the game-style title bar", () => {
    show();
    const heading = screen.getByRole("heading", { name: "Community" });
    expect(["H1", "H2"]).toContain(heading.tagName);
    // Radix points Dialog.Content at the title, so the chrome label is the
    // dialog's accessible name rather than a decorative strip.
    const dialog = screen.getByRole("dialog");
    expect(heading.id).not.toBe("");
    expect(dialog).toHaveAttribute("aria-labelledby", heading.id);
    expect(screen.getByText("The game asked for this page.")).toBeInTheDocument();
  });

  it("layers the exported art over the sampled palette", () => {
    show();
    const chrome = screen.getByTestId("game-dialog-chrome");
    const style = chrome.style;
    expect(style.getPropertyValue("--gd-title-art")).toContain("dialog-art/title.png");
    expect(style.getPropertyValue("--gd-background-art")).toContain("dialog-art/background.jpg");
    expect(style.getPropertyValue("--gd-button-art")).toContain("dialog-art/button.png");
    expect(style.getPropertyValue("--gd-button-hover-art")).toContain("dialog-art/button-hover.png");
    for (const key of ["metal", "metalLight", "metalDark", "plate", "plateLight", "plateDark"] as const) {
      expect(style.getPropertyValue(`--gd-${kebab(key)}`)).toBe(GAME_DIALOG_PALETTE[key]);
    }
  });

  it("styles actions as real DOM controls over the button plate", () => {
    show();
    const action = screen.getByRole("button", { name: "Close" });
    expect(action.className).toBe(gameDialogButtonClass);
    expect(action).toHaveProperty("tagName", "BUTTON");
  });
});

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
