import { Theme } from "@radix-ui/themes";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import type { FolderSource, SourceFile } from "../storage/importer";
import type { BuildInfo } from "../storage/install";
import { Manifest } from "../storage/manifest";
import { listMods } from "../storage/mods";
import type { CopyTarget } from "../storage/opfs";
import { Import, type ImportDeps } from "./Import";
import { SOURCES } from "./InstallGuide";

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

describe("Import background", () => {
  it("shows the selected game's background", async () => {
    const { container } = render(
      <Theme>
        <Import deps={{} as ImportDeps} onDone={vi.fn()} edition="ra2md" />
      </Theme>,
    );
    expect(container.querySelector("[data-edition]")).toHaveAttribute("data-edition", "ra2md");
  });
});

describe("Import", () => {
  it("starts by asking for the folder, and says nothing is uploaded", async () => {
    await setup(folder());
    expect(screen.getByRole("heading", { name: "INSTALL THE GAME" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Use your own copy of Red Alert 2 or Yuri’s Revenge. The files are copied into this browser. Nothing is uploaded.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CHOOSE FOLDER" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Folder button not working?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "USE AN ARCHIVE OR INSTALLER" })).toBeInTheDocument();
    expect(screen.getByText("Drop your game folder here")).toBeInTheDocument();
    expect(
      screen.getByText(/Needs about 2 GB free, or 3 GB with the movies\./),
    ).toBeInTheDocument();
  });

  it("says where each copy of the game puts its folder", async () => {
    const { user } = await setup(folder());
    const where = screen.getByRole("complementary", { name: "WHERE IS MY GAME?" });
    const buttons = within(where).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(SOURCES.map((entry) => entry.name));
    expect(buttons[0]).toHaveAttribute("aria-expanded", "true");
    expect(within(where).getByText(SOURCES[0]!.folders[0]!)).toBeInTheDocument();
    const steam = within(where).getByRole("button", { name: "Steam" });
    const steamEntry = SOURCES.find((entry) => entry.id === "steam")!;
    expect(steam).toHaveAttribute("aria-expanded", "false");
    expect(within(where).queryByText(steamEntry.folders[0]!)).toBeNull();
    await user.click(steam);
    expect(steam).toHaveAttribute("aria-expanded", "true");
    expect(within(where).getByText(steamEntry.folders[0]!)).toBeInTheDocument();
    expect(within(where).getByText(steamEntry.pick)).toBeInTheDocument();
    expect(buttons[0]).toHaveAttribute("aria-expanded", "false");
    expect(within(where).queryByText(SOURCES[0]!.folders[0]!)).toBeNull();
    await user.click(steam);
    expect(steam).toHaveAttribute("aria-expanded", "false");
  });

  it("offers the file picker when the folder button does not work", async () => {
    const { user } = await setup(folder());
    const input = screen.getByLabelText("Game folder");
    const click = vi.spyOn(input, "click");
    await user.click(screen.getByRole("button", { name: "Folder button not working?" }));
    expect(click).toHaveBeenCalled();
  });

  it("opens an archive or installer with 7-Zip, then checks it like a folder", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const close = vi.fn();
    const openArchive = vi.fn((file: File) => ({ ...folder(), name: file.name, close }));
    const onDone = vi.fn();
    render(
      <Theme>
        <Import
          deps={{
            build,
            manifest,
            target: memoryTarget(),
            estimate: async () => ({ quota: 1e12, usage: 0 }),
            persist: async () => true,
            pickDirectory: null,
            openArchive,
          }}
          onDone={onDone}
        />
      </Theme>,
    );
    const user = userEvent.setup();
    const archive = new File(["7z"], "RA2.7z");
    await user.upload(screen.getByLabelText("Archive or installer"), archive);
    expect(openArchive).toHaveBeenCalledWith(archive);
    expect(
      await screen.findByRole("heading", { name: "CHOOSE WHAT TO INSTALL" }),
    ).toBeInTheDocument();
    expect(screen.getByText("in RA2.7z")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^INSTALL / }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // the worker is let go when the copy is done
    expect(close).toHaveBeenCalled();
  });

  it("marks the current step", async () => {
    const { user } = await setup(folder());
    const steps = screen.getByRole("list", { name: "Steps" });
    expect(steps).toHaveTextContent("1 CHOOSE2 REVIEW3 INSTALL");
    const step = (label: string) => screen.getByText(label).closest("li");
    expect(step("1 CHOOSE")).toHaveAttribute("aria-current", "step");
    expect(step("1 CHOOSE")).toHaveAttribute("data-state", "current");
    expect(step("2 REVIEW")).toHaveAttribute("data-state", "next");
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("heading", { name: "CHOOSE WHAT TO INSTALL" });
    expect(step("2 REVIEW")).toHaveAttribute("aria-current", "step");
    expect(step("1 CHOOSE")).not.toHaveAttribute("aria-current");
    expect(step("1 CHOOSE")).toHaveAttribute("data-state", "done");
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
    expect(screen.queryByRole("button", { name: "Folder button not working?" })).toBeNull();
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
    await userEvent.click(screen.getByRole("button", { name: "LAUNCHER" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("opens the install guide when asked", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const deps: ImportDeps = {
      build,
      manifest,
      target: memoryTarget(),
      estimate: async () => ({}),
      persist: async () => true,
      pickDirectory: null,
    };
    const onGuide = vi.fn();
    const { unmount } = render(
      <Theme>
        <Import deps={deps} onDone={() => {}} onGuide={onGuide} />
      </Theme>,
    );
    await userEvent.click(screen.getByRole("button", { name: "INSTALL GUIDE" }));
    expect(onGuide).toHaveBeenCalled();
    unmount();
    render(
      <Theme>
        <Import deps={deps} onDone={() => {}} />
      </Theme>,
    );
    expect(screen.queryByRole("button", { name: "INSTALL GUIDE" })).toBeNull();
  });

  it("reviews a good folder, then copies it and says when it is done", async () => {
    const { user, target, manifest, onDone } = await setup(folder());
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    expect(
      await screen.findByRole("heading", { name: "CHOOSE WHAT TO INSTALL" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Yuri’s Revenge" })).toHaveTextContent("Found");
    // the movies are ticked at first
    expect(screen.getByRole("checkbox", { name: /^Movies/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Saved games" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Settings and hotkeys" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "CHOOSE ANOTHER FOLDER" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^INSTALL / }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // the folder has movmd03.mix; movies01.mix is not in it, so only its empty stand-in is copied
    expect(target.files.get("game/slot-1/movmd03.mix")).toBe(5000);
    expect(target.files.get("game/slot-1/movies01.mix")).toBe(12);
    expect(target.files.has("game/slot-1/gamemd.exe")).toBe(false);
    expect(target.files.has("game/slot-1/Blowfish.dll")).toBe(false);
    expect(target.files.get("game/slot-1/ra2.mix")).toBe(4000);
    expect(target.files.has("game/slot-1/readme.txt")).toBe(false);
    expect((await manifest.getGame("ra2md"))?.complete).toBe(true);
  });

  const sorted = (...extra: SourceFile[]): FolderSource => ({
    name: "RA2",
    list: async () => [
      ...(await folder().list()),
      file("Tour of Egypt.map", 30),
      file("Mods/Lite/rulesmd.ini", 6),
      file("RA2MD.INI", 20),
      ...extra,
    ],
  });
  const row = (name: string) =>
    screen.getByRole("checkbox", { name }).closest("label") as HTMLElement;

  it("sorts the folder into game content, movies, mods, maps, saves and settings", async () => {
    const { user } = await setup(sorted());
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    const group = await screen.findByRole("group", { name: "What to install" });
    expect(within(group).getByText("Game content").closest("div")).toHaveTextContent("4 files");
    expect(row("Movies")).toHaveTextContent("1 file");
    expect(row("Mods")).toHaveTextContent("1 mod");
    expect(row("Custom maps")).toHaveTextContent("1 map");
    expect(row("Saved games")).toHaveTextContent("1 save");
    expect(row("Settings and hotkeys")).toHaveTextContent("1 file");
    expect(screen.getByRole("checkbox", { name: "Mods" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Custom maps" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Movies" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Settings and hotkeys" })).not.toBeChecked();
  });

  it("says what the folder does not have", async () => {
    const { user } = await setup(folder());
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("group", { name: "What to install" });
    expect(screen.getByRole("checkbox", { name: "Custom maps" })).toBeDisabled();
    expect(row("Custom maps")).toHaveTextContent("None");
    expect(screen.getByRole("checkbox", { name: "Mods" })).toBeDisabled();
  });

  it("brings the mods to the MODS tab and the maps to the game", async () => {
    const { user, target, manifest, onDone } = await setup(sorted());
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await user.click(await screen.findByRole("button", { name: /^INSTALL / }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await listMods(manifest, "slot-1-ra2md")).map((mod) => mod.name)).toEqual(["Lite"]);
    expect(target.files.get("game/slot-1/Tour of Egypt.map")).toBe(30);
  });

  it("leaves the mods and the maps out when asked", async () => {
    const { user, target, manifest, onDone } = await setup(sorted());
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await user.click(await screen.findByRole("checkbox", { name: "Mods" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Mods" })).not.toBeChecked());
    await user.click(screen.getByRole("checkbox", { name: "Custom maps" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Custom maps" })).not.toBeChecked(),
    );
    await user.click(screen.getByRole("button", { name: /^INSTALL / }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(await listMods(manifest, "slot-1-ra2md")).toEqual([]);
    expect(target.files.has("game/slot-1/Tour of Egypt.map")).toBe(false);
  });

  it("names a mod that patches the exe, and leaves it out", async () => {
    const { user } = await setup(
      sorted(file("Mods/Patched/Ares.dll", 4), file("Mods/Patched/rulesmd.ini", 5)),
    );
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("group", { name: "What to install" });
    expect(row("Mods")).toHaveTextContent("1 mod");
    expect(screen.getByText(/^Patched is left out: it patches the game/)).toBeInTheDocument();
  });

  it("opens the mods in a dialog to show each one's game, size and files", async () => {
    const { user } = await setup(
      sorted(
        file("Mods/Lite/expandmd90.mix", 9),
        file("Mods/Patched/Ares.dll", 4),
        file("Mods/Patched/rulesmd.ini", 5),
      ),
    );
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    const toggle = await screen.findByRole("button", { name: "1 mod" });
    expect(toggle).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(toggle);
    const dialog = await screen.findByRole("dialog", { name: "MODS IN THE FOLDER" });
    const lite = within(dialog).getByRole("listitem", { name: "Lite" });
    expect(lite).toHaveTextContent("Yuri’s Revenge");
    expect(within(lite).getByText("rulesmd.ini")).toBeInTheDocument();
    expect(within(lite).getByText("expandmd90.mix")).toBeInTheDocument();
    expect(within(dialog).getByRole("listitem", { name: "Patched" })).toHaveTextContent(
      "Left out: patches the game",
    );
    await user.click(within(dialog).getByRole("button", { name: "DONE" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // closing the dialog does not untick the mods
    expect(screen.getByRole("checkbox", { name: "Mods" })).toBeChecked();
  });

  it("brings the movies unless they are unticked", async () => {
    const { user, target, onDone } = await setup(folder());
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("heading", { name: "CHOOSE WHAT TO INSTALL" });
    await user.click(await screen.findByRole("button", { name: /^INSTALL / }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(target.files.get("game/slot-1/movmd03.mix")).toBe(5000);
  });

  it("leaves the movies out, with empty stand-ins, when they are unticked", async () => {
    const { user, target, onDone } = await setup(folder());
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("heading", { name: "CHOOSE WHAT TO INSTALL" });
    await user.click(screen.getByRole("checkbox", { name: /^Movies/ }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /^Movies/ })).not.toBeChecked(),
    );
    await user.click(await screen.findByRole("button", { name: /^INSTALL / }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(target.files.get("game/slot-1/movmd03.mix")).toBe(12);
  });

  it("says which games were found and where", async () => {
    const { user } = await setup(folder());
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("group", { name: "What to install" });
    const found = screen.getByRole("listitem", { name: "Yuri’s Revenge" });
    expect(found).toHaveTextContent("Found");
    expect(screen.getByText("in RA2")).toBeInTheDocument();
  });

  it("leaves the folder out of the found line when it has no name", async () => {
    const { user } = await setup({ ...folder(), name: "" });
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("group", { name: "What to install" });
    expect(screen.queryByText(/^in\s*$/)).toBeNull();
  });

  it("names one game when the folder has one", async () => {
    const both: BuildInfo = {
      games: {
        ra2: {
          title: "Red Alert 2",
          exe: "game.exe",
          ini: "RA2.INI",
          stamp: 1,
          build: "test",
          runtime: { edition: "ra2", build: "test", exeSha256: "a", blowfishSha256: "b" },
        },
        ...build.games,
      },
    };
    const manifest = await Manifest.open(new IDBFactory());
    const only: FolderSource = {
      name: "RA2",
      list: async () => [file("ra2.mix", 4000), file("maps01.mix", 2000), file("multi.mix", 1000)],
    };
    render(
      <Theme>
        <Import
          deps={{
            build: both,
            manifest,
            target: memoryTarget(),
            estimate: async () => ({ quota: 1e12, usage: 0 }),
            persist: async () => true,
            pickDirectory: async () => only,
          }}
          onDone={() => {}}
        />
      </Theme>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    const group = await screen.findByRole("group", { name: "What to install" });
    const content = within(group).getByText("Game content").closest("div") as HTMLElement;
    expect(content).toHaveTextContent("Red Alert 2");
    expect(content).not.toHaveTextContent(/ and /);
    expect(content).not.toHaveTextContent("Yuri");
  });

  it("shows the space the install needs against what the browser allows", async () => {
    const { user } = await setup(folder(), 1e12);
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("group", { name: "What to install" });
    const space = screen.getByRole("complementary", { name: "Space" });
    const meter = within(space).getByRole("img");
    expect(meter).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/^[\d.]+ (KB|MB) of [\d.]+ GB$/),
    );
    expect(within(space).getByText(/this browser allows/)).toHaveTextContent(
      /^of the [\d.]+ GB this browser allows$/,
    );
  });

  it("hides the meter when the browser gives no quota, and shows no NaN", async () => {
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
            pickDirectory: async () => folder(),
          }}
          onDone={() => {}}
        />
      </Theme>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("group", { name: "What to install" });
    const space = screen.getByRole("complementary", { name: "Space" });
    expect(within(space).queryByRole("img")).toBeNull();
    expect(screen.queryByText(/this browser allows/)).toBeNull();
    expect(document.body).not.toHaveTextContent(/NaN|undefined/);
  });

  it("warns that cutscenes will be black when the movies are unticked, and not when the folder has none", async () => {
    const { user } = await setup(folder());
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("group", { name: "What to install" });
    expect(screen.queryByText(/Cutscenes will be black/)).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: /^Movies/ }));
    expect(await screen.findByText(/Cutscenes will be black/)).toBeInTheDocument();
  });

  it("does not warn about cutscenes when the folder has no movies", async () => {
    const bare: FolderSource = {
      name: "RA2",
      list: async () => (await folder().list()).filter((entry) => entry.path !== "movmd03.mix"),
    };
    const { user } = await setup(bare);
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("group", { name: "What to install" });
    expect(row("Movies")).toHaveTextContent("None");
    expect(screen.getByRole("checkbox", { name: /^Movies/ })).toBeDisabled();
    expect(screen.queryByText(/Cutscenes will be black/)).toBeNull();
  });

  it("says what is left out when asked", async () => {
    const { user } = await setup(folder());
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("group", { name: "What to install" });
    const toggle = screen.getByRole("button", { name: /other files are left out$/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/files the game does not read are not copied/)).toBeNull();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText(
        "Tools, the game’s exe and DLLs, and files the game does not read are not copied.",
      ),
    ).toBeInTheDocument();
  });

  it("leaves the folder's settings out unless they are asked for", async () => {
    const source: FolderSource = {
      name: "RA2",
      list: async () => [...(await folder().list()), file("RA2MD.INI", 20)],
    };
    const { user, target, onDone } = await setup(source);
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await screen.findByRole("heading", { name: "CHOOSE WHAT TO INSTALL" });
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
    await screen.findByRole("heading", { name: "CHOOSE WHAT TO INSTALL" });
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
    expect(
      await screen.findByRole("heading", { name: "CHOOSE WHAT TO INSTALL" }),
    ).toBeInTheDocument();
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
    expect(screen.getByText("3 INSTALL").closest("li")).toHaveAttribute("aria-current", "step");
    release();
  });

  /** Renders the screen over a target that `write` can hold open or fail, and starts the install. */
  async function install(
    write: (path: string, stream: ReadableStream<Uint8Array>) => Promise<void>,
    extra: { source?: FolderSource; onDone?: () => void } = {},
  ) {
    const manifest = await Manifest.open(new IDBFactory());
    const target = memoryTarget();
    const wrapped: CopyTarget = {
      ...target,
      write: async (path, stream) => {
        await write(path, stream);
        await target.write(path, stream);
      },
    };
    const onDone = extra.onDone ?? vi.fn();
    render(
      <Theme>
        <Import
          deps={{
            build,
            manifest,
            target: wrapped,
            estimate: async () => ({ quota: 1e12, usage: 0 }),
            persist: async () => true,
            pickDirectory: async () => extra.source ?? folder(),
          }}
          onDone={onDone}
        />
      </Theme>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await user.click(await screen.findByRole("button", { name: /^INSTALL / }));
    return { manifest, onDone, user };
  }

  it("shows each part of the copy and where it stands", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // the empty stand-ins go through; the game's own archive waits
    await install(async (path) => {
      if (path.endsWith("ra2.mix")) await gate;
    });
    const parts = await screen.findByRole("list", { name: "Parts" });
    await waitFor(() =>
      expect(within(parts).getByText("Game content").closest("li")).toHaveTextContent("COPYING"),
    );
    expect(within(parts).getByText("Movies").closest("li")).toHaveTextContent("WAITING");
    expect(within(parts).getByText("Saved games").closest("li")).toHaveTextContent("WAITING");
    release();
    await waitFor(() =>
      expect(within(parts).getByText("Game content").closest("li")).not.toHaveTextContent(
        "COPYING",
      ),
    );
  });

  it("says to keep the tab open", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await install(() => gate);
    expect(await screen.findByText(/Keep this tab open until it finishes/)).toBeInTheDocument();
    expect(screen.getByText(/RESUME INSTALL carries on\./)).toBeInTheDocument();
    release();
  });

  it("a failed copy says what was kept and tries again in the same installation", async () => {
    let writes = 0;
    let failing = true;
    const { manifest, onDone, user } = await install(async () => {
      if (failing && ++writes === 2) throw new Error("The disk is full.");
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("THAT DID NOT WORK");
    expect(alert).toHaveTextContent("The disk is full.");
    expect(alert).toHaveTextContent(/was copied and is kept/);
    expect(alert).toHaveTextContent("TRY AGAIN carries on from there.");
    expect(screen.getByText("3 INSTALL").closest("li")).toHaveAttribute("data-state", "failed");
    failing = false;
    await user.click(screen.getByRole("button", { name: "TRY AGAIN" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(await manifest.listInstallations()).toHaveLength(1);
    expect((await manifest.getGame("ra2md"))?.complete).toBe(true);
  });

  it("a failed copy can go back to choose another folder", async () => {
    const close = vi.fn();
    let writes = 0;
    const { user } = await install(
      async () => {
        if (++writes === 2) throw new Error("The disk is full.");
      },
      { source: { ...folder(), close } },
    );
    await screen.findByRole("alert");
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "CHOOSE ANOTHER FOLDER" }));
    expect(await screen.findByRole("heading", { name: "INSTALL THE GAME" })).toBeInTheDocument();
    expect(close).toHaveBeenCalled();
  });

  it("a failure before the copy only offers to try again from the start", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    render(
      <Theme>
        <Import
          deps={{
            build,
            manifest,
            target: memoryTarget(),
            estimate: async () => ({ quota: 1e12, usage: 0 }),
            persist: async () => true,
            pickDirectory: async () => {
              throw new Error("The folder could not be read.");
            },
          }}
          onDone={() => {}}
        />
      </Theme>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The folder could not be read.");
    expect(alert).not.toHaveTextContent(/was copied/);
    expect(screen.queryByRole("button", { name: "CHOOSE ANOTHER FOLDER" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "TRY AGAIN" }));
    expect(await screen.findByRole("heading", { name: "INSTALL THE GAME" })).toBeInTheDocument();
  });

  it("a failed copy offers the install guide when it can", async () => {
    let writes = 0;
    const manifest = await Manifest.open(new IDBFactory());
    const target = memoryTarget();
    const onGuide = vi.fn();
    render(
      <Theme>
        <Import
          deps={{
            build,
            manifest,
            target: {
              ...target,
              write: async () => {
                if (++writes === 1) throw new Error("The disk is full.");
              },
            },
            estimate: async () => ({ quota: 1e12, usage: 0 }),
            persist: async () => true,
            pickDirectory: async () => folder(),
          }}
          onDone={() => {}}
          onGuide={onGuide}
        />
      </Theme>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    await user.click(await screen.findByRole("button", { name: /^INSTALL \d/ }));
    await screen.findByRole("alert");
    // nothing was copied yet, so there is no line about what was kept
    expect(screen.getByRole("alert")).not.toHaveTextContent(/was copied/);
    await user.click(screen.getByRole("button", { name: "Read the install guide" }));
    expect(onGuide).toHaveBeenCalled();
  });

  it("goes back to the start when what was picked is not a folder", async () => {
    const { user } = await setup(null);
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    expect(await screen.findByText("That is not a folder or an archive.")).toBeInTheDocument();
  });
});
