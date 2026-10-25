import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAttention } from "./attention";

function look(focused: boolean, hidden = false) {
  vi.spyOn(document, "hasFocus").mockReturnValue(focused);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(hidden ? "hidden" : "visible");
}

afterEach(() => vi.restoreAllMocks());

describe("useAttention", () => {
  it("follows the window's focus", () => {
    look(true);
    const { result } = renderHook(() => useAttention());
    expect(result.current).toBe(true);
    act(() => {
      look(false);
      window.dispatchEvent(new Event("blur"));
    });
    expect(result.current).toBe(false);
    act(() => {
      look(true);
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current).toBe(true);
  });

  it("is lost when the tab is hidden, even if the window still has focus", () => {
    look(true);
    const { result } = renderHook(() => useAttention());
    act(() => {
      look(true, true);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(false);
  });
});
