import { Theme } from "@radix-ui/themes";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AudioState, GameAudio } from "../game/audio";
import { DEFAULT_SOUND_PREFERENCES, type SoundPreferences } from "../game/sound-preferences";
import { SoundControl } from "./SoundControl";

/** The part of GameAudio the control uses. */
function fakeAudio(start: AudioState) {
  const listeners = new Set<() => void>();
  const audio = {
    state: start,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    change: (state: AudioState) => {
      audio.state = state;
      for (const listener of listeners) listener();
    },
    resume: vi.fn(async () => audio.change("running")),
  };
  return audio;
}

function show(
  audio: ReturnType<typeof fakeAudio>,
  volume = 1,
  preferences: SoundPreferences = DEFAULT_SOUND_PREFERENCES,
) {
  const props = {
    volume,
    onVolume: vi.fn(),
    preferences,
    onPreference: vi.fn(),
    giveBack: vi.fn(),
  };
  render(
    <Theme>
      <SoundControl audio={audio as unknown as GameAudio} {...props} />
    </Theme>,
  );
  return props;
}

describe("SoundControl", () => {
  it("asks for a click while the browser holds the sound, and gives the focus back after it", async () => {
    const audio = fakeAudio("suspended");
    const props = show(audio);
    expect(screen.getByRole("status")).toHaveTextContent("Sound is off until you click.");
    await userEvent.click(screen.getByRole("button", { name: "TURN ON" }));
    expect(audio.resume).toHaveBeenCalled();
    expect(props.giveBack).toHaveBeenCalled();
    expect(screen.queryByText("TURN ON")).toBeNull();
    expect(screen.getByRole("button", { name: "Volume" })).toBeInTheDocument();
  });

  it("shows only the speaker once the sound runs", () => {
    show(fakeAudio("running"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Volume" })).toBeInTheDocument();
  });

  it("shows nothing before there is a context, or where there is no sound", () => {
    const view = show(fakeAudio("starting"));
    expect(view.giveBack).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the choices about when the game is heard, each as it was chosen", async () => {
    // Radix sizes its popover with a ResizeObserver, which jsdom does not have
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const props = show(fakeAudio("running"), 1, { muteOnBlur: true, menuMusic: false });
    await userEvent.click(screen.getByRole("button", { name: "Volume" }));
    const mute = screen.getByRole("switch", { name: "Mute when in background" });
    const music = screen.getByRole("switch", { name: "Menu music" });
    expect(mute).toHaveAttribute("aria-checked", "true");
    expect(music).toHaveAttribute("aria-checked", "false");
    await userEvent.click(music);
    expect(props.onPreference).toHaveBeenCalledWith("menuMusic", true);
    await userEvent.click(mute);
    expect(props.onPreference).toHaveBeenCalledWith("muteOnBlur", false);
  });

  it("sets the volume with ten pips", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const props = show(fakeAudio("running"), 0.7);
    const trigger = screen.getByRole("button", { name: "Volume" });
    expect(trigger).toHaveTextContent("70%");
    await userEvent.click(trigger);
    const pips = within(screen.getByRole("group", { name: "Volume" })).getAllByRole("button");
    expect(pips.map((pip) => pip.getAttribute("aria-label"))).toEqual(
      [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((n) => `Volume ${n}%`),
    );
    expect(screen.getByRole("button", { name: "Volume 70%" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Volume 40%" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await userEvent.click(screen.getByRole("button", { name: "Volume 40%" }));
    expect(props.onVolume).toHaveBeenCalledWith(0.4);
  });

  it("asks again when the browser suspends a sound that was running", () => {
    const audio = fakeAudio("running");
    show(audio);
    act(() => audio.change("suspended"));
    expect(screen.getByRole("button", { name: "TURN ON" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Volume" })).toBeNull();
  });
});
