import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandImage } from "./BrandImage";

describe("BrandImage", () => {
  it("shows the image while it loads", () => {
    render(<BrandImage src="brand/ra2-icon.png" alt="Red Alert 2" fallback={<span>RA2</span>} />);
    expect(screen.getByRole("img", { name: "Red Alert 2" })).toHaveAttribute(
      "src",
      "brand/ra2-icon.png",
    );
    expect(screen.queryByText("RA2")).toBeNull();
  });

  it("shows the fallback when the image fails", () => {
    render(<BrandImage src="brand/missing.png" alt="" fallback={<span>RA2</span>} />);
    fireEvent.error(document.querySelector("img")!);
    expect(screen.getByText("RA2")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
