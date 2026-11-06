import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
