import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KeyArt } from "./KeyArt";

const img = (c: HTMLElement) => c.querySelector("img");

describe("KeyArt", () => {
  it("uses the edition's background", () => {
    const { container } = render(<KeyArt edition="ra2" />);
    expect(img(container)?.getAttribute("src")).toMatch(/brand\/bg-ra2\.webp$/);
  });

  it("uses the Yuri's Revenge background for ra2md", () => {
    const { container } = render(<KeyArt edition="ra2md" />);
    expect(img(container)?.getAttribute("src")).toMatch(/brand\/bg-yr\.webp$/);
  });

  it("falls back to the gradient", () => {
    const { container } = render(<KeyArt edition="ra2md" />);
    fireEvent.error(img(container)!);
    expect(container.querySelector('[data-fallback="gradient"]')).not.toBeNull();
    expect(img(container)).toBeNull();
  });

  it("null edition uses the RA2 art", () => {
    const { container } = render(<KeyArt edition={null} />);
    expect(img(container)?.getAttribute("src")).toMatch(/brand\/bg-ra2\.webp$/);
  });

  it("dim adds a layer", () => {
    const { container } = render(<KeyArt edition="ra2" dim={0.78} />);
    const layers = [...container.querySelectorAll<HTMLElement>("div")];
    expect(layers.some((d) => d.style.background === "rgba(7, 8, 11, 0.78)")).toBe(true);
  });

  it("is hidden from screen readers", () => {
    const { container } = render(<KeyArt edition="ra2" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("KeyArt motion", () => {
  it("fades in the first time only, so changing tab does not dip the background", async () => {
    vi.resetModules();
    const { KeyArt: Art } = await import("./KeyArt");
    const first = render(<Art edition="ra2" />);
    expect(img(first.container)).toHaveAttribute("data-arrive");
    first.unmount();
    const later = render(<Art edition="ra2md" />);
    expect(img(later.container)).not.toHaveAttribute("data-arrive");
  });

  it("drifts on one shared clock, so a new screen continues where the last one was", () => {
    const { container } = render(<KeyArt edition="ra2" />);
    const phase = (container.firstElementChild as HTMLElement).style.getPropertyValue("--phase");
    expect(phase).toMatch(/^-\d+(\.\d+)?s$/);
  });
});
