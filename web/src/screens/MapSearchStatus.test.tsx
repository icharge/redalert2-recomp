import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { MapSearchStatus, labelPosition } from "./MapSearchStatus";

const list = { open: true, noMatches: true, x: 332, y: 209, w: 177, h: 241 };

describe("labelPosition", () => {
  it("puts the label inside the list's top right corner, where the picture is drawn", () => {
    // an 800x600 picture drawn at 1x in the middle of a 1000x700 canvas (integer scaling)
    const at = labelPosition(
      { left: 10, top: 20, width: 1000, height: 700 },
      { left: 10, top: 0 },
      { x: 0.1, y: 50 / 700, width: 0.8, height: 600 / 700 },
      { width: 800, height: 600 },
      list,
    );
    expect(at.left).toBeCloseTo(100 + 332 + 177 - 4);
    expect(at.top).toBeCloseTo(20 + 50 + 209 + 3);
  });

  it("scales with the picture", () => {
    const at = labelPosition(
      { left: 0, top: 0, width: 1600, height: 1200 },
      { left: 0, top: 0 },
      { x: 0, y: 0, width: 1, height: 1 },
      { width: 800, height: 600 },
      list,
    );
    expect(at.left).toBeCloseTo((332 + 177) * 2 - 4);
    expect(at.top).toBeCloseTo(209 * 2 + 3);
  });
});

describe("MapSearchStatus", () => {
  const presenter = {
    pictureRect: () => ({ x: 0, y: 0, width: 1, height: 1 }),
    gameSize: () => ({ width: 800, height: 600 }),
  };

  it("says no maps match over the list", () => {
    const stage = createRef<HTMLDivElement>();
    const canvas = createRef<HTMLCanvasElement>();
    render(
      <div ref={stage}>
        <canvas ref={canvas} />
        <MapSearchStatus status={list} presenter={presenter} stage={stage} canvas={canvas} />
      </div>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("No maps match");
  });

  it("shows nothing while maps match, or with the map screen closed", () => {
    const stage = createRef<HTMLDivElement>();
    const canvas = createRef<HTMLCanvasElement>();
    const { rerender } = render(
      <div ref={stage}>
        <canvas ref={canvas} />
        <MapSearchStatus
          status={{ ...list, noMatches: false }}
          presenter={presenter}
          stage={stage}
          canvas={canvas}
        />
      </div>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    rerender(
      <div ref={stage}>
        <canvas ref={canvas} />
        <MapSearchStatus
          status={{ ...list, open: false }}
          presenter={presenter}
          stage={stage}
          canvas={canvas}
        />
      </div>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});
