import { describe, expect, it } from "vitest";
import { serial } from "./serial";

describe("serial", () => {
  it("runs one task after the other finishes", async () => {
    const run = serial();
    const order: string[] = [];
    let release!: () => void;
    const first = run(async () => {
      order.push("first start");
      await new Promise<void>((resolve) => (release = resolve));
      order.push("first end");
    });
    const second = run(async () => {
      order.push("second");
      return 2;
    });
    await Promise.resolve();
    expect(order).toEqual(["first start"]);
    release();
    await first;
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(["first start", "first end", "second"]);
  });

  it("a failed task does not stop the next", async () => {
    const run = serial();
    await expect(run(async () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    await expect(run(async () => "yes")).resolves.toBe("yes");
  });
});
