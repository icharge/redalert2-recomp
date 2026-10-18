import { describe, expect, it } from "vitest";
import { CopyCancelled, copyInstall, removeFiles, type CopyJob, type CopyTarget } from "./opfs";

/** A target in memory. */
function memoryTarget(): CopyTarget & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async write(path, stream, signal) {
      const chunks: Uint8Array[] = [];
      const reader = stream.getReader();
      for (;;) {
        if (signal?.aborted) {
          await reader.cancel();
          throw new DOMException("aborted", "AbortError");
        }
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const whole = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const chunk of chunks) {
        whole.set(chunk, at);
        at += chunk.length;
      }
      files.set(path, whole);
    },
    async size(path) {
      return files.get(path)?.length ?? null;
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

const bytes = (n: number, chunk = 4) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < n; at += chunk)
        controller.enqueue(new Uint8Array(Math.min(chunk, n - at)));
      controller.close();
    },
  });

const job = (
  name: string,
  size: number,
  home: "ra2md" | "ra2" = "ra2md",
  given = size,
): CopyJob => ({
  name,
  size,
  lastModified: 1,
  needs: [home],
  home,
  open: () => bytes(given),
});

describe("copyInstall", () => {
  it("copies each file to its game's folder, marks it done, and reports the bytes", async () => {
    const target = memoryTarget();
    const done: string[] = [];
    const seen: number[] = [];
    await copyInstall({
      jobs: [job("a.mix", 10), job("b.mix", 6, "ra2")],
      target,
      markDone: async (name) => void done.push(name),
      onProgress: (p) => seen.push(p.doneBytes),
    });
    expect([...target.files.keys()]).toEqual(["game/ra2md/a.mix", "game/ra2/b.mix"]);
    expect(done).toEqual(["a.mix", "b.mix"]);
    expect(seen.at(-1)).toBe(16);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it("starts the bar where an earlier run stopped", async () => {
    const target = memoryTarget();
    let last: {
      doneBytes: number;
      totalBytes: number;
      doneFiles: number;
      totalFiles: number;
    } | null = null;
    await copyInstall({
      jobs: [job("c.mix", 4)],
      target,
      alreadyBytes: 96,
      alreadyFiles: 7,
      markDone: async () => {},
      onProgress: (p) => (last = p),
    });
    expect(last).toMatchObject({ doneBytes: 100, totalBytes: 100, doneFiles: 8, totalFiles: 8 });
  });

  it("stops on abort without marking the next file, and keeps what was finished", async () => {
    const target = memoryTarget();
    const done: string[] = [];
    const controller = new AbortController();
    await expect(
      copyInstall({
        jobs: [job("a.mix", 8), job("b.mix", 8)],
        target,
        signal: controller.signal,
        markDone: async (name) => {
          done.push(name);
          controller.abort();
        },
      }),
    ).rejects.toBeInstanceOf(CopyCancelled);
    expect(done).toEqual(["a.mix"]);
    expect(target.files.has("game/ra2md/a.mix")).toBe(true);
    expect(target.files.has("game/ra2md/b.mix")).toBe(false);
  });

  it("refuses a file that came to another size than the folder said, and deletes it", async () => {
    const target = memoryTarget();
    await expect(
      copyInstall({ jobs: [job("a.mix", 10, "ra2md", 7)], target, markDone: async () => {} }),
    ).rejects.toThrow(/a\.mix came to 7 bytes, not 10/);
    expect(target.files.size).toBe(0);
  });
});

describe("removeFiles", () => {
  it("deletes from each file's own folder and ignores a missing one", async () => {
    const target = memoryTarget();
    target.files.set("game/ra2md/a.mix", new Uint8Array(1));
    target.files.set("game/ra2/b.mix", new Uint8Array(1));
    await removeFiles(target, [
      { home: "ra2md", name: "a.mix" },
      { home: "ra2", name: "gone.mix" },
    ]);
    expect([...target.files.keys()]).toEqual(["game/ra2/b.mix"]);
  });
});
