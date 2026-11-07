import { Theme } from "@radix-ui/themes";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_VIDEO_SIZE } from "../storage/video-preferences";
import { SettingsDialog } from "./SettingsDialog";
import { Setting, type HostSettings } from "../game/protocol";

const settings: HostSettings = {
  open: true,
  scale: "sharp",
  bars: true,
  hd: false,
  modern: false,
  width: 1280,
  height: 720,
  mod: "",
};

function setup(over: Partial<HostSettings> = {}) {
  const props = {
    command: vi.fn(),
    onVideoChange: vi.fn(),
    onClose: vi.fn(),
    onFullscreen: vi.fn(),
    onPointerLock: vi.fn(),
    onStatsChange: vi.fn(),
  };
  render(
    <Theme>
      <SettingsDialog
        settings={{ ...settings, ...over }}
        statsOn={false}
        videoChoice={null}
        {...props}
      />
    </Theme>,
  );
  return props;
}

const row = (name: string) =>
  screen.getByRole("switch", { name }).closest("div[class]")!.parentElement!;

describe("SettingsDialog", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("is a dialog named Settings", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("has five scaling choices", async () => {
    const { command } = setup();
    const scaling = screen.getByRole("radiogroup", { name: "Scaling" });
    expect(within(scaling).getAllByRole("radio")).toHaveLength(5);
    expect(within(scaling).getByRole("radio", { name: "Sharp" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(within(scaling).getByRole("radio", { name: "CRT" }));
    expect(command).toHaveBeenCalledWith(Setting.Scale, 2);
  });

  it("shows the game resolution, with its tip", () => {
    setup();
    expect(screen.getByRole("combobox", { name: "Resolution" })).toHaveDisplayValue("1280 × 720");
    expect(
      screen.getByRole("button", {
        name: "Applies now in a Yuri's Revenge skirmish or campaign; otherwise from the next match.",
      }),
    ).toBeInTheDocument();
  });

  it("offers Match browser size", async () => {
    const { onVideoChange } = setup();
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Resolution" }),
      "Match browser size",
    );
    expect(onVideoChange).toHaveBeenCalledWith(BROWSER_VIDEO_SIZE);
  });

  it("reports a fixed size", async () => {
    const { onVideoChange } = setup();
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Resolution" }),
      "1920x1080",
    );
    expect(onVideoChange).toHaveBeenCalledWith({ w: 1920, h: 1080 });
  });

  it("sends the display and control switches to the host", async () => {
    const { command } = setup();
    await userEvent.click(screen.getByRole("switch", { name: "HD vehicles" }));
    expect(command).toHaveBeenCalledWith(Setting.Hd, 1);
    await userEvent.click(screen.getByRole("switch", { name: "MOBA style" }));
    expect(command).toHaveBeenCalledWith(Setting.Modern, 1);
  });

  it("shows the keys of Lock pointer and FPS counter", async () => {
    const { onPointerLock, onStatsChange } = setup();
    expect(row("Lock pointer")).toHaveTextContent("Esc");
    expect(row("FPS counter")).toHaveTextContent("Alt+Shift+F");
    await userEvent.click(screen.getByRole("switch", { name: "Lock pointer" }));
    expect(onPointerLock).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("switch", { name: "FPS counter" }));
    expect(onStatsChange).toHaveBeenCalledWith(true);
  });

  it("shows the mod and its key", () => {
    setup({ mod: "Mental Omega" });
    const mod = screen.getByText("Mental Omega").parentElement!;
    expect(mod).toHaveTextContent("F9");
  });

  it("calls the original game Vanilla", () => {
    setup();
    expect(screen.getByText("Vanilla")).toBeInTheDocument();
  });

  it("BACK TO GAME closes it, and F11 toggles fullscreen", async () => {
    const { onClose, onFullscreen } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    expect(onFullscreen).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "BACK TO GAME" }));
    expect(onClose).toHaveBeenCalled();
  });
});
