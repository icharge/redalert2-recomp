import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CrashDialog } from "./CrashDialog";

const log = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);

describe("CrashDialog", () => {
  it("says the game stopped, and why", () => {
    render(
      <CrashDialog message="out of memory" log={log} onReload={() => {}} onReturn={() => {}} />,
    );
    expect(screen.getByRole("alertdialog", { name: "THE GAME STOPPED" })).toBeInTheDocument();
    expect(screen.getByText("out of memory")).toBeInTheDocument();
  });

  it("RELOAD and LAUNCHER do what they say", async () => {
    const onReload = vi.fn();
    const onReturn = vi.fn();
    render(<CrashDialog message="x" log={log} onReload={onReload} onReturn={onReturn} />);
    await userEvent.click(screen.getByRole("button", { name: "RELOAD" }));
    expect(onReload).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "LAUNCHER" }));
    expect(onReturn).toHaveBeenCalled();
  });

  it("LOG shows the last 80 lines", async () => {
    render(<CrashDialog message="x" log={log} onReload={() => {}} onReturn={() => {}} />);
    const button = screen.getByRole("button", { name: "LOG" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/line 100/)).toBeNull();
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const shown = screen.getByText(/line 100/);
    expect(shown.textContent).toContain("line 21\n");
    expect(shown.textContent).not.toContain("line 20\n");
    await userEvent.click(button);
    expect(screen.queryByText(/line 100/)).toBeNull();
  });

  it("has no LOG button without a log", () => {
    render(<CrashDialog message="x" log={[]} onReload={() => {}} onReturn={() => {}} />);
    expect(screen.queryByRole("button", { name: "LOG" })).toBeNull();
  });
});
