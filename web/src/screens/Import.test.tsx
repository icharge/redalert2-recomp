import { Theme } from "@radix-ui/themes";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import type { FolderSource, SourceFile } from "../storage/importer";
import type { BuildInfo } from "../storage/install";
import { Manifest } from "../storage/manifest";
import type { CopyTarget } from "../storage/opfs";
import { Import, type ImportDeps } from "./Import";

const STAMP = 0x3bdf544e;
const build: BuildInfo = {
  games: {
    ra2md: {
      title: "Yuri's Revenge",
      exe: "gamemd.exe",
      ini: "RA2MD.INI",
      stamp: STAMP,
      build: "test",
      runtime: { edition: "ra2md", build: "test", exeSha256: "a", blowfishSha256: "b" },
    },
  },
};

function exe(stamp: number): Uint8Array {
  const head = new Uint8Array(4096);
  const view = new DataView(head.buffer);
  view.setUint32(0x3c, 0x80, true);
  view.setUint32(0x88, stamp, true);
  return head;
}

function file(path: string, size: number, head: Uint8Array = new Uint8Array(0)): SourceFile {
  return {
    path,
    size,
    lastModified: 1,
    head: async (n) => head.slice(0, n),
    stream: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(size));
          controller.close();
        },
      }),
  };
}

const folder = (stamp = STAMP): FolderSource => ({
  name: "RA2",
  list: async () => [
    file("gamemd.exe", 100, exe(stamp)),
    file("Blowfish.dll", 10),
    file("binkw32.dll", 10),
    file("ra2.mix", 4000),
    file("ra2md.mix", 3000),
    file("maps01.mix", 2000),
    file("multi.mix", 1000),
    file("movmd03.mix", 5000),
    file("Saved Games/a.sav", 5),
    file("readme.txt", 1),
  ],
});

function memoryTarget(): CopyTarget & { files: Map<string, number> } {
  const files = new Map<string, number>();
  return {
    files,
    async write(path, stream) {
      let n = 0;
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.length;
      }
      files.set(path, n);
    },
    async size(path) {
      return files.get(path) ?? null;
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

async function setup(source: FolderSource | null, quota = 1e12) {
  const manifest = await Manifest.open(new IDBFactory());
  const target = memoryTarget();
  const deps: ImportDeps = {
    build,
    manifest,
    target,
    estimate: async () => ({ quota, usage: 0 }),
    persist: async () => true,
    pickDirectory: async () => source,
  };
  const onDone = vi.fn();
  render(
    <Theme>
      <Import deps={deps} onDone={onDone} />
    </Theme>,
  );
  return { manifest, target, onDone, user: userEvent.setup() };
}

describe("Import", () => {
  it("starts by asking for the folder, and says nothing is uploaded", async () => {
    await setup(folder());
    expect(screen.getByText("Bring your game")).toBeInTheDocument();
    expect(screen.getByText(/Red Alert 2 or Yuri's Revenge/)).toBeInTheDocument();
    expect(screen.getByText(/nothing is uploaded/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose folder…" })).toBeInTheDocument();
  });

  it("reviews a good folder, then copies it and says when it is done", async () => {
    const { user, target, manifest, onDone } = await setup(folder());
    await user.click(screen.getByRole("button", { name: "Choose folder…" }));
    expect(await screen.findByText(/Found Yuri's Revenge in RA2/)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Include the movies.*video cutscenes show as black/ }),
    ).toBeInTheDocument();
    // the movies are off by default, so only their empty stand-in is copied
    await user.click(screen.getByRole("button", { name: /^Import / }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(target.files.get("game/slot-1/movies01.mix")).toBe(12);
    expect(target.files.get("game/slot-1/movmd03.mix")).toBe(12);
    expect(target.files.has("game/slot-1/gamemd.exe")).toBe(false);
    expect(target.files.has("game/slot-1/Blowfish.dll")).toBe(false);
    expect(target.files.get("game/slot-1/ra2.mix")).toBe(4000);
    expect(target.files.has("game/slot-1/readme.txt")).toBe(false);
    expect((await manifest.getGame("ra2md"))?.complete).toBe(true);
  });

  it("brings the real movie archive when asked", async () => {
    const { user, target, onDone } = await setup(folder());
    await user.click(screen.getByRole("button", { name: "Choose folder…" }));
    await screen.findByText(/Found Yuri's Revenge/);
    await user.click(screen.getByRole("checkbox", { name: /Include the movies/ }));
    await user.click(await screen.findByRole("button", { name: /^Import / }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(target.files.get("game/slot-1/movmd03.mix")).toBe(5000);
  });

  it("does not require a matching user executable when importing content", async () => {
    const { user } = await setup(folder(0x11111111));
    await user.click(screen.getByRole("button", { name: "Choose folder…" }));
    expect(await screen.findByText(/Found Yuri's Revenge in RA2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Import / })).toBeEnabled();
  });

  it("says when the browser has too little room", async () => {
    const { user } = await setup(folder(), 1000);
    await user.click(screen.getByRole("button", { name: "Choose folder…" }));
    expect(await screen.findByText(/not enough room/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Import / })).toBeDisabled();
  });

  it("goes back to the start when what was picked is not a folder", async () => {
    const { user } = await setup(null);
    await user.click(screen.getByRole("button", { name: "Choose folder…" }));
    expect(await screen.findByText("That is not a folder.")).toBeInTheDocument();
  });
});
