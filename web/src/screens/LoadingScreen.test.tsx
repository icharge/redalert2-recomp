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
      step: "Preparing your game files",
      detail: "400 MB of 1.00 GB · ra2.mix",
      percent: (400 / 1024) * 100,
    });
  });

  it("drops the first unit when both sizes share it", () => {
    const big = {
      doneBytes: 1.1 * 1024 * MB,
      totalBytes: 2.9 * 1024 * MB,
      doneFiles: 3,
      totalFiles: 9,
      file: "ra2md.mix",
    };
    expect(describeLoading({ phase: "loading", copy: big }).detail).toBe(
      "1.10 of 2.90 GB · ra2md.mix",
    );
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
  it("shows the step and the detail with a segmented progress bar", () => {
    render(
      <Theme>
        <LoadingScreen state={{ phase: "loading", copy: copy(10, 256 * MB) }} />
      </Theme>,
    );
    expect(screen.getByText("Preparing your game files")).toBeInTheDocument();
    expect(screen.getByText(/256 MB of 1.00 GB/)).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(bar.querySelectorAll("span")).toHaveLength(40);
    expect(bar.querySelectorAll("span[data-on]")).toHaveLength(10);
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("names the edition, with EXPANSION for Yuri's Revenge", () => {
    render(
      <Theme>
        <LoadingScreen state={{ phase: "loading", copy: null, edition: "ra2md" }} />
      </Theme>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("YURI’S REVENGE");
    expect(screen.getByText("EXPANSION")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });

  it("names Red Alert 2 without a kicker", () => {
    render(
      <Theme>
        <LoadingScreen state={{ phase: "loading", copy: null, edition: "ra2" }} />
      </Theme>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("RED ALERT 2");
    expect(screen.queryByText("EXPANSION")).toBeNull();
  });

  it("shows only a small status while the game's own boot screen is up", () => {
    render(
      <Theme>
        <LoadingScreen state={{ phase: "booting", copy: null }} variant="chip" />
      </Theme>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Starting the game");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("The game is setting itself up")).not.toBeInTheDocument();
  });
});
