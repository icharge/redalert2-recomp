import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_VIDEO_SIZE } from "../storage/video-preferences";
import { SettingsDialog } from "./SettingsDialog";
import type { HostSettings } from "../game/protocol";

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

function setup() {
  const command = vi.fn();
  const onVideoChange = vi.fn();
  render(
    <Theme>
      <SettingsDialog
        settings={settings}
        command={command}
        onClose={() => {}}
        statsOn={false}
        onStatsChange={() => {}}
        videoChoice={null}
        onVideoChange={onVideoChange}
      />
    </Theme>,
  );
  return { command, onVideoChange };
}

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
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  it("shows the resolution the next match will use", () => {
    setup();
    expect(screen.getByRole("combobox", { name: "Resolution" })).toHaveTextContent("1280 × 720");
  });

  it("offers Match browser size", async () => {
    const { onVideoChange } = setup();
    await userEvent.click(screen.getByRole("combobox", { name: "Resolution" }));
    await userEvent.click(await screen.findByRole("option", { name: "Match browser size" }));
    expect(onVideoChange).toHaveBeenCalledWith(BROWSER_VIDEO_SIZE);
  });

  it("reports a fixed size", async () => {
    const { onVideoChange } = setup();
    await userEvent.click(screen.getByRole("combobox", { name: "Resolution" }));
    await userEvent.click(await screen.findByRole("option", { name: /1920 × 1080/ }));
    expect(onVideoChange).toHaveBeenCalledWith({ w: 1920, h: 1080 });
  });
});
