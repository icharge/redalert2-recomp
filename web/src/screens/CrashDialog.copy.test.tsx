import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrashDialog } from "./CrashDialog";

const log = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
const shownText = log.slice(-80).join("\n");

function renderDialog(lines: readonly string[] = log) {
  return render(<CrashDialog message="x" log={lines} onReload={() => {}} onReturn={() => {}} />);
}

describe("CrashDialog log copy", () => {
  let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

  beforeEach(() => {
    writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("has no COPY button until the log is expanded", () => {
    renderDialog();
    expect(screen.queryByRole("button", { name: "COPY" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "LOG" }));
    expect(screen.getByText("GAME LOG")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "COPY" })).toBeInTheDocument();
  });

  it("copies the shown log lines and says COPIED", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "LOG" }));
    fireEvent.click(screen.getByRole("button", { name: "COPY" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(shownText);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "COPIED" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "COPY" })).toBeNull();
  });

  it("goes back to COPY after 1.5 seconds", async () => {
    vi.useFakeTimers();
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "LOG" }));
    fireEvent.click(screen.getByRole("button", { name: "COPY" }));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "COPIED" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(screen.getByRole("button", { name: "COPIED" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("button", { name: "COPY" })).toBeInTheDocument();
  });

  it("keeps COPY when writeText rejects", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "LOG" }));
    fireEvent.click(screen.getByRole("button", { name: "COPY" }));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "COPY" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "COPIED" })).toBeNull();
  });

  it("keeps COPY when the clipboard is missing", () => {
    Reflect.deleteProperty(navigator, "clipboard");
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "LOG" }));
    fireEvent.click(screen.getByRole("button", { name: "COPY" }));
    expect(screen.getByRole("button", { name: "COPY" })).toBeInTheDocument();
  });
});
