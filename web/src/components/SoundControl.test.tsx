import { Theme } from "@radix-ui/themes";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AudioState, GameAudio } from "../game/audio";
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

function show(audio: ReturnType<typeof fakeAudio>, volume = 1) {
  const props = { volume, onVolume: vi.fn(), giveBack: vi.fn() };
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
    await userEvent.click(screen.getByRole("button", { name: "Click to start sound" }));
    expect(audio.resume).toHaveBeenCalled();
    expect(props.giveBack).toHaveBeenCalled();
    expect(screen.queryByText("Click to start sound")).toBeNull();
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

  it("asks again when the browser suspends a sound that was running", () => {
    const audio = fakeAudio("running");
    show(audio);
    act(() => audio.change("suspended"));
    expect(screen.getByRole("button", { name: "Click to start sound" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Volume" })).toBeNull();
  });
});
