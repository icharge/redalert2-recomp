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
    expect(screen.getByRole("heading", { name: "INSTALL THE GAME" })).toBeInTheDocument();
    expect(
      screen.getByText("Pick your Red Alert 2 folder. Nothing is uploaded."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CHOOSE FOLDER" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use file picker" })).toBeInTheDocument();
    expect(screen.getByText("Drop the folder here")).toBeInTheDocument();
  });

  it("marks the current step", async () => {
    const { user } = await setup(folder());
    const steps = screen.getByRole("list", { name: "Steps" });
    expect(steps).toHaveTextContent("1 FOLDER2 CHECK3 COPY");
    expect(screen.getByText("1 FOLDER").closest("li")).toHaveAttribute("aria-current", "step");
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("heading", { name: "READY TO INSTALL" });
    expect(screen.getByText("2 CHECK").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("1 FOLDER").closest("li")).not.toHaveAttribute("aria-current");
  });

  it("without a folder picker, CHOOSE FOLDER uses the file picker", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    render(
      <Theme>
        <Import
          deps={{
            build,
            manifest,
            target: memoryTarget(),
            estimate: async () => ({}),
            persist: async () => true,
            pickDirectory: null,
          }}
          onDone={() => {}}
        />
      </Theme>,
    );
    expect(screen.getByRole("button", { name: "CHOOSE FOLDER" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use file picker" })).toBeNull();
  });

  it("goes back when asked", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const onBack = vi.fn();
    render(
      <Theme>
        <Import
          deps={{
            build,
            manifest,
            target: memoryTarget(),
            estimate: async () => ({}),
            persist: async () => true,
            pickDirectory: null,
          }}
          onDone={() => {}}
          onBack={onBack}
        />
      </Theme>,
    );
    await userEvent.click(screen.getByRole("button", { name: "BACK" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("reviews a good folder, then copies it and says when it is done", async () => {
    const { user, target, manifest, onDone } = await setup(folder());
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    expect(await screen.findByRole("heading", { name: "READY TO INSTALL" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Yuri’s Revenge" })).toHaveTextContent("Found");
    expect(screen.getByRole("checkbox", { name: /^Movies/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Saved games" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Settings and hotkeys" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "OTHER FOLDER" })).toBeInTheDocument();
    // the movies are off by default, so only their empty stand-in is copied
    await user.click(screen.getByRole("button", { name: /^INSTALL / }));
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
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("heading", { name: "READY TO INSTALL" });
    await user.click(screen.getByRole("checkbox", { name: /^Movies/ }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /^Movies/ })).toBeChecked());
    await user.click(await screen.findByRole("button", { name: /^INSTALL / }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(target.files.get("game/slot-1/movmd03.mix")).toBe(5000);
  });

  it("leaves the folder's settings out unless they are asked for", async () => {
    const source: FolderSource = {
      name: "RA2",
      list: async () => [...(await folder().list()), file("RA2MD.INI", 20)],
    };
    const { user, target, onDone } = await setup(source);
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("heading", { name: "READY TO INSTALL" });
    await user.click(screen.getByRole("button", { name: /^INSTALL / }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(target.files.has("game/slot-1/RA2MD.INI")).toBe(false);
  });

  it("brings the folder's settings when asked", async () => {
    const source: FolderSource = {
      name: "RA2",
      list: async () => [...(await folder().list()), file("RA2MD.INI", 20)],
    };
    const { user, target, onDone } = await setup(source);
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("heading", { name: "READY TO INSTALL" });
    await user.click(screen.getByRole("checkbox", { name: "Settings and hotkeys" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Settings and hotkeys" })).toBeChecked(),
    );
    await user.click(screen.getByRole("button", { name: /^INSTALL / }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(target.files.get("game/slot-1/RA2MD.INI")).toBe(20);
  });

  it("does not require a matching user executable when importing content", async () => {
    const { user } = await setup(folder(0x11111111));
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    expect(await screen.findByRole("heading", { name: "READY TO INSTALL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^INSTALL / })).toBeEnabled();
  });

  it("says when the browser has too little room", async () => {
    const { user } = await setup(folder(), 1000);
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    expect(await screen.findByText(/not enough room/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^INSTALL / })).toBeDisabled();
  });

  it("shows the copy with a CANCEL button", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const target = memoryTarget();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: CopyTarget = {
      ...target,
      write: async (path, stream) => {
        await gate;
        await target.write(path, stream);
      },
    };
    render(
      <Theme>
        <Import
          deps={{
            build,
            manifest,
            target: slow,
            estimate: async () => ({ quota: 1e12, usage: 0 }),
            persist: async () => false,
            pickDirectory: async () => folder(),
          }}
          onDone={() => {}}
        />
      </Theme>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await user.click(await screen.findByRole("button", { name: /^INSTALL / }));
    expect(await screen.findByRole("heading", { name: "INSTALLING" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Copying the game" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CANCEL" })).toBeInTheDocument();
    expect(await screen.findByText(/may clear this copy/)).toBeInTheDocument();
    expect(screen.getByText("3 COPY").closest("li")).toHaveAttribute("aria-current", "step");
    release();
  });

  it("goes back to the start when what was picked is not a folder", async () => {
    const { user } = await setup(null);
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    expect(await screen.findByText("That is not a folder.")).toBeInTheDocument();
  });
});
