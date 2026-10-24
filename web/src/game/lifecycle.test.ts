import { describe, expect, it, vi } from "vitest";
import { leaveGame } from "./lifecycle";
import type { GameHandle } from "./loader";

describe("leaving the runtime document", () => {
  it("waits for pending saves before navigating and clears the old resume marker", async () => {
    let finish!: (value: number) => void;
    const order: string[] = [];
    const saved = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const game = {
      saves: {
        stop: () => order.push("stop"),
        flush: () => {
          order.push("flush");
          return saved;
        },
      },
    } as unknown as GameHandle;
    sessionStorage.setItem("ra2-resume-game", "ra2md");
    const leaving = leaveGame(Promise.resolve(game), "/emu/", (url) => order.push(url));
    await vi.waitFor(() => expect(order).toEqual(["stop", "flush"]));
    finish(1);
    await leaving;
    expect(order).toEqual(["stop", "flush", "/emu/"]);
    expect(sessionStorage.getItem("ra2-resume-game")).toBeNull();
  });

  it("keeps the document if saving fails and permits a retry", async () => {
    let attempt = 0;
    const destinations: string[] = [];
    const game = {
      saves: {
        stop() {},
        async flush() {
          if (++attempt === 1) throw new Error("disk full");
          return 1;
        },
      },
    } as unknown as GameHandle;
    const session = Promise.resolve(game);
    await expect(leaveGame(session, "/", (url) => destinations.push(url))).rejects.toThrow(
      "disk full",
    );
    expect(destinations).toEqual([]);
    await leaveGame(session, "/", (url) => destinations.push(url));
    expect(destinations).toEqual(["/"]);
  });
});
