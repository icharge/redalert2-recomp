import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { describeLoading, LoadingScreen } from "./LoadingScreen";

const MB = 1024 * 1024;
const copy = (doneFiles: number, doneBytes: number) => ({
  doneBytes,
  totalBytes: 1024 * MB,
  doneFiles,
  totalFiles: 55,
  file: "ra2.mix",
});

describe("describeLoading", () => {
  it("says how far the copy is, in bytes and files", () => {
    expect(describeLoading({ phase: "loading", copy: copy(39, 400 * MB) })).toEqual({
      step: "Copying your game files",
      detail: "400 MB of 1.00 GB · ra2.mix (40 of 55)",
      percent: (400 / 1024) * 100,
    });
  });

  it("is starting once every file is in, and while the game boots", () => {
    expect(describeLoading({ phase: "loading", copy: copy(55, 1024 * MB) }).step).toBe(
      "Starting the game",
    );
    expect(describeLoading({ phase: "booting", copy: null }).step).toBe("Starting the game");
  });

  it("is only getting ready before anything is known", () => {
    expect(describeLoading({ phase: "loading", copy: null })).toMatchObject({
      step: "Getting ready",
      percent: null,
    });
  });
});

describe("LoadingScreen", () => {
  it("shows the step and the detail with a progress bar", () => {
    render(
      <Theme>
        <LoadingScreen state={{ phase: "loading", copy: copy(10, 200 * MB) }} />
      </Theme>,
    );
    expect(screen.getByText("Copying your game files")).toBeInTheDocument();
    expect(screen.getByText(/200 MB of 1.00 GB/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});
