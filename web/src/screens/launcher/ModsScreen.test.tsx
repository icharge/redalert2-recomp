import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeLatin1, type GameSettingsDeps } from "../../storage/game-settings";
import type { GameId } from "../../storage/install";
import type { GameRecord, Manifest } from "../../storage/manifest";
import type { ModRecord } from "../../storage/mods";
import type { CopyTarget } from "../../storage/opfs";
import { ModsScreen } from "./ModsScreen";

const dropped = vi.hoisted(() => ({ files: [] as File[] }));
vi.mock("../../storage/importer", async (load) => {
  const actual = await load<typeof import("../../storage/importer")>();
  return { ...actual, droppedSource: async () => actual.fileListSource(dropped.files) };
});

const g = (id: GameId): GameRecord => ({
  id,
  slot: 1,
  storage: `${id}-1`,
  title: id,
  exeStamp: 0,
  importedAt: 0,
  bytes: 0,
  complete: true,
  files: {},
});
const ra2 = g("ra2");
const yr = g("ra2md");
const mod = (name: string, bytes = 412e6): ModRecord => ({
  name,
  files: [{ name: "rules.ini", size: bytes }],
  bytes,
});

function fakeManifest(initial: Record<string, ModRecord[]>) {
  const settings = new Map<string, unknown>(
    Object.entries(initial).map(([k, v]) => [`mods:${k}`, v]),
  );
  return {
    settings,
    manifest: {
      getSetting: async (key: string) => settings.get(key),
      setSetting: async (key: string, value: unknown) => void settings.set(key, value),
    } as unknown as Manifest,
  };
}

function fakeTarget() {
  const files = new Map<string, number>();
  const target = {
    write: async (path: string, stream: ReadableStream<Uint8Array>) => {
      let size = 0;
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
      }
      files.set(path, size);
    },
    size: async (path: string) => files.get(path) ?? 0,
    remove: async (path: string) => void files.delete(path),
  } as unknown as CopyTarget;
  return { files, target };
}

function settingsStore() {
  const files = new Map<string, string>();
  const deps: GameSettingsDeps = {
    readSave: async () => null,
    writeSave: async (storage, name, data) =>
      void files.set(`${storage}/${name}`, decodeLatin1(data)),
    readImported: async () => {
      throw new Error("none");
    },
  };
  return { files, deps };
}

/** jsdom's File has no stream(); give the test file one, and the folder path the picker sets. */
function folderFile(folder: string, name: string, text: string): File {
  const file = new File([text], name);
  const bytes = new TextEncoder().encode(text);
  Object.defineProperty(file, "webkitRelativePath", { value: `${folder}/${name}` });
  Object.defineProperty(file, "stream", {
    value: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  });
  return file;
}

let manifestState: ReturnType<typeof fakeManifest>;
let targetState: ReturnType<typeof fakeTarget>;
let settings: ReturnType<typeof settingsStore>;

beforeEach(() => {
  manifestState = fakeManifest({ "ra2-1": [mod("Rise", 96e6)], "ra2md-1": [mod("Mental Omega")] });
  targetState = fakeTarget();
  settings = settingsStore();
});

function renderMods(props: Partial<Parameters<typeof ModsScreen>[0]> = {}) {
  const onChanged = vi.fn();
  const onEdition = vi.fn();
  render(
    <MemoryRouter initialEntries={["/mods"]}>
      <Routes>
        <Route
          path="/mods"
          element={
            <ModsScreen
              editions={[ra2, yr]}
              manifest={manifestState.manifest}
              target={targetState.target}
              activeMods={{ "ra2md-1": "Mental Omega" }}
              onChanged={onChanged}
              onEdition={onEdition}
              gameSettingsDeps={settings.deps}
              {...props}
            />
          }
        />
        <Route path="/" element={<p>play page</p>} />
        <Route path="/import" element={<p>install page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return { onChanged, onEdition };
}

const row = (name: string) => screen.getByRole("heading", { name }).closest("li")!;

describe("ModsScreen", () => {
  it("lists mods of every edition with its edition and size", async () => {
    renderMods();
    expect(await screen.findByRole("heading", { name: "Mental Omega" })).toBeInTheDocument();
    expect(row("Mental Omega")).toHaveTextContent("Yuri’s Revenge");
    expect(row("Mental Omega")).toHaveTextContent("393 MB");
    expect(row("Rise")).toHaveTextContent("Red Alert 2");
  });

  it("ALL / RED ALERT 2 / YURI’S REVENGE filters", async () => {
    renderMods();
    await screen.findByRole("heading", { name: "Rise" });
    await userEvent.click(screen.getByRole("radio", { name: "RED ALERT 2" }));
    expect(screen.getByRole("radio", { name: "RED ALERT 2" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.queryByRole("heading", { name: "Mental Omega" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Rise" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "ALL" }));
    expect(screen.getByRole("heading", { name: "Mental Omega" })).toBeInTheDocument();
  });

  it("the active mod shows IN USE", async () => {
    renderMods();
    await screen.findByRole("heading", { name: "Rise" });
    expect(row("Mental Omega")).toHaveTextContent("IN USE");
    expect(row("Rise")).not.toHaveTextContent("IN USE");
  });

  it("INSTALL MOD asks which edition when there are two", async () => {
    const { onChanged } = renderMods();
    await screen.findByRole("heading", { name: "Rise" });
    await userEvent.click(screen.getByRole("button", { name: "INSTALL MOD" }));
    const chooser = screen.getByRole("dialog", { name: "Install a mod for" });
    await userEvent.click(within(chooser).getByRole("button", { name: "YURI’S REVENGE" }));
    const file = folderFile("Tiberium Wars", "rules.ini", "12345");
    await userEvent.upload(screen.getByLabelText("Mod folder"), [file]);
    await waitFor(() =>
      expect(
        (manifestState.settings.get("mods:ra2md-1") as ModRecord[]).map((m) => m.name),
      ).toContain("Tiberium Wars"),
    );
    expect(targetState.files.has("game/ra2md-1/mods/Tiberium Wars/rules.ini")).toBe(true);
    expect(await screen.findByRole("heading", { name: "Tiberium Wars" })).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("one edition installs without asking", async () => {
    renderMods({ editions: [yr] });
    await screen.findByRole("heading", { name: "Mental Omega" });
    await userEvent.click(screen.getByRole("button", { name: "INSTALL MOD" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a dropped folder installs", async () => {
    renderMods({ editions: [yr] });
    await screen.findByRole("heading", { name: "Mental Omega" });
    const file = folderFile("Dropped", "rules.ini", "abc");
    dropped.files = [file];
    fireEvent.drop(screen.getByText("Drop a mod folder"), {
      dataTransfer: { items: [], files: [] },
    });
    expect(await screen.findByRole("heading", { name: "Dropped" })).toBeInTheDocument();
  });

  it("REMOVE asks first, then removes", async () => {
    renderMods();
    await screen.findByRole("heading", { name: "Rise" });
    await userEvent.click(screen.getByRole("button", { name: "Remove Rise" }));
    const confirm = screen.getByRole("alertdialog");
    expect(confirm).toHaveTextContent("REMOVE RISE?");
    await userEvent.click(within(confirm).getByRole("button", { name: "REMOVE" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Rise" })).toBeNull());
    expect(manifestState.settings.get("mods:ra2-1")).toEqual([]);
  });

  it("removing the active mod clears it", async () => {
    renderMods();
    await screen.findByRole("heading", { name: "Mental Omega" });
    await userEvent.click(screen.getByRole("button", { name: "Remove Mental Omega" }));
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "REMOVE" }),
    );
    await waitFor(() =>
      expect(settings.files.get("ra2md-1/.host/ra2md.ini")).toMatch(/^active=$/m),
    );
  });

  it("PLAY makes the mod active and goes to Play", async () => {
    const { onEdition } = renderMods();
    await screen.findByRole("heading", { name: "Rise" });
    await userEvent.click(within(row("Rise")).getByRole("button", { name: "PLAY" }));
    expect(await screen.findByText("play page")).toBeInTheDocument();
    expect(settings.files.get("ra2-1/.host/ra2.ini")).toMatch(/^active=Rise$/m);
    expect(onEdition).toHaveBeenCalledWith(ra2);
  });

  it("FILES lists the mod's files", async () => {
    renderMods();
    await screen.findByRole("heading", { name: "Rise" });
    const files = screen.getByRole("button", { name: "Files of Rise" });
    expect(files).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(files);
    expect(files).toHaveAttribute("aria-expanded", "true");
    expect(row("Rise")).toHaveTextContent("rules.ini");
  });

  it("no game installed shows the install link", () => {
    renderMods({ editions: [] });
    expect(screen.getByRole("link", { name: "INSTALL THE GAME" })).toHaveAttribute(
      "href",
      "/import",
    );
    expect(screen.queryByRole("button", { name: "INSTALL MOD" })).toBeNull();
  });
});
