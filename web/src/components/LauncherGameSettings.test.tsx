import { Theme } from "@radix-ui/themes";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameRecord } from "../storage/manifest";
import { encodeLatin1 } from "../storage/game-settings";
import { LauncherGameSettings } from "./LauncherGameSettings";

const game: GameRecord = {
  id: "ra2md",
  slot: 1,
  storage: "slot-1-ra2md",
  title: "Yuri's Revenge",
  exeStamp: 0,
  importedAt: 0,
  bytes: 0,
  complete: true,
  files: {},
};

const decoded = (data: Uint8Array) => new TextDecoder("latin1").decode(data);

function setup({ keyboard = true, main = true }: { keyboard?: boolean; main?: boolean } = {}) {
  const saved = new Map<string, string>();
  if (main)
    saved.set(
      "ra2md.ini",
      "[Options]\nGameSpeed=1\nDifficulty=1\nAutoScroll=yes\nScrollRate=3\n[Audio]\nSoundVolume=0.700000\n[Video]\nScreenWidth=800\nScreenHeight=600\n[MultiPlayer]\nHandle=50,6c,61,79,65,72,\n",
    );
  if (keyboard) saved.set("keyboardmd.ini", "[Hotkey]\nTeamCreate_1=561\nTeamSelect_1=49\n");
  const written: { name: string; text: string }[] = [];
  const deps = {
    readSave: vi.fn(async (_storage: string, name: string) => {
      const text = saved.get(name);
      return text === undefined ? null : { name, data: encodeLatin1(text) };
    }),
    readImported: vi.fn(async () => {
      throw new Error("nothing was imported");
    }),
    writeSave: vi.fn(async (_storage: string, name: string, data: Uint8Array) => {
      const text = decoded(data);
      saved.set(name.toLowerCase(), text);
      written.push({ name, text });
    }),
  };
  render(
    <Theme>
      <LauncherGameSettings game={game} onClose={() => {}} gameSettingsDeps={deps} />
    </Theme>,
  );
  return { deps, written };
}

async function gameplay() {
  await userEvent.click(screen.getByRole("tab", { name: /Gameplay/ }));
  await screen.findByRole("switch", { name: "Auto scroll" });
}

describe("LauncherGameSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    HTMLElement.prototype.scrollIntoView = () => {};
  });

  it("writes a switch to the game's own INI", async () => {
    const { deps, written } = setup();
    await gameplay();
    await userEvent.click(screen.getByRole("switch", { name: "Auto scroll" }));
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written[0]?.name).toBe("ra2md.ini");
    expect(written[0]?.text).toContain("AutoScroll=no");
    expect(deps.writeSave).toHaveBeenCalledWith(
      "slot-1-ra2md",
      "ra2md.ini",
      expect.any(Uint8Array),
    );
  });

  it("writes a select to the game's own INI", async () => {
    const { written } = setup();
    await gameplay();
    await userEvent.click(screen.getByRole("combobox", { name: "Difficulty" }));
    await userEvent.click(await screen.findByRole("option", { name: "Hard" }));
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.text).toContain("Difficulty=2");
  });

  it("offers the fastest scroll rate the game has", async () => {
    const { written } = setup();
    await gameplay();
    await userEvent.click(screen.getByRole("combobox", { name: "Scroll rate" }));
    await userEvent.click(await screen.findByRole("option", { name: "0 — fastest" }));
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.text).toContain("ScrollRate=0");
  });

  it("writes a slider when it is committed", async () => {
    const { written } = setup();
    await gameplay();
    const slider = screen.getByRole("slider", { name: "Game speed" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.text).toContain("GameSpeed=2");
  });

  it("writes the player name as the game's Handle bytes", async () => {
    const { written } = setup();
    await gameplay();
    const name = screen.getByRole("textbox", { name: "Player name" });
    await userEvent.clear(name);
    await userEvent.type(name, "iCharge");
    fireEvent.blur(name);
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.name).toBe("ra2md.ini");
    expect(written.at(-1)?.text).toContain("Handle=69,43,68,61,72,67,65,");
  });

  it("shows the game's defaults when no settings file was imported", async () => {
    setup({ main: false, keyboard: false });
    await gameplay();
    expect(await screen.findByText(/No settings file was found/)).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Game speed" })).toHaveAttribute(
      "aria-valuenow",
      "5",
    );
    expect(screen.getByRole("switch", { name: "Show hidden objects" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "Player name" })).toHaveValue("");
    await userEvent.click(screen.getByRole("tab", { name: /Audio/ }));
    expect(screen.getByRole("slider", { name: "Sound volume" })).toHaveAttribute(
      "aria-valuenow",
      "70",
    );
  });

  it("stores the campaign speed-control choice for the next launch", async () => {
    setup();
    await gameplay();
    const toggle = screen.getByRole("switch", { name: "Campaign speed control" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(localStorage.getItem("ra2.speed-control.slot-1-ra2md")).toBe("1");
  });

  it("writes the presentation settings to the host file", async () => {
    const { written } = setup();
    const scaling = screen.getByRole("combobox", { name: "Scaling" });
    expect(scaling).toHaveTextContent("Smooth");
    await userEvent.click(scaling);
    await userEvent.click(await screen.findByRole("option", { name: "CRT" }));
    await waitFor(() =>
      expect(
        written.some(
          (entry) => entry.name === ".host/ra2md.ini" && entry.text.includes("scale=crt"),
        ),
      ).toBe(true),
    );
    await userEvent.click(screen.getByRole("switch", { name: "Blur menu bars" }));
    await waitFor(() => expect(written.at(-1)?.text).toContain("bars=black"));
    await userEvent.click(screen.getByRole("switch", { name: "HD vehicles" }));
    await waitFor(() => expect(written.at(-1)?.text).toContain("hdvox=1"));
    expect(written.at(-1)?.text).toContain("scale=crt");
    expect(written.at(-1)?.text).toContain("bars=black");
  });

  it("stores the software-cursor choice for the next launch", async () => {
    setup();
    const cursor = screen.getByRole("combobox", { name: "Cursor" });
    expect(cursor).toHaveTextContent("Page layer");
    await userEvent.click(cursor);
    await userEvent.click(await screen.findByRole("option", { name: /Game's own/ }));
    expect(localStorage.getItem("ra2.software-cursor.slot-1-ra2md")).toBe("1");
    await userEvent.click(cursor);
    await userEvent.click(await screen.findByRole("option", { name: /Page layer/ }));
    expect(localStorage.getItem("ra2.software-cursor.slot-1-ra2md")).toBeNull();
  });

  it("writes the MOBA-style control to the host file", async () => {
    const { written } = setup();
    await gameplay();
    await userEvent.click(screen.getByRole("switch", { name: "MOBA style" }));
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.name).toBe(".host/ra2md.ini");
    expect(written.at(-1)?.text).toContain("controls=modern");
  });

  it("turns campaign speed control and MOBA style off when gameplay defaults are reset", async () => {
    const { written } = setup();
    await gameplay();
    await userEvent.click(screen.getByRole("switch", { name: "Campaign speed control" }));
    await userEvent.click(screen.getByRole("switch", { name: "MOBA style" }));
    await waitFor(() => expect(localStorage.getItem("ra2.speed-control.slot-1-ra2md")).toBe("1"));
    await waitFor(() =>
      expect(
        written.some(
          (entry) => entry.name === ".host/ra2md.ini" && entry.text.includes("controls=modern"),
        ),
      ).toBe(true),
    );

    await userEvent.click(screen.getByRole("button", { name: "Reset gameplay defaults" }));
    await waitFor(() => {
      expect(localStorage.getItem("ra2.speed-control.slot-1-ra2md")).toBeNull();
      expect(screen.getByRole("switch", { name: "Campaign speed control" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
      expect(screen.getByRole("switch", { name: "MOBA style" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
    });
    expect(
      written.some(
        (entry) => entry.name === ".host/ra2md.ini" && entry.text.includes("controls=classic"),
      ),
    ).toBe(true);
  });

  it("writes the defaults back when a tab is reset", async () => {
    const { written } = setup();
    await userEvent.click(screen.getByRole("tab", { name: /Audio/ }));
    await userEvent.click(screen.getByRole("button", { name: "Reset audio defaults" }));
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.text).toContain("SoundVolume=0.700000");
    expect(written.at(-1)?.text).toContain("ScoreVolume=0.400000");
    expect(written.at(-1)?.text).toContain("SoundLatency=9");
  });

  it("assigns a captured hotkey from the keyboard editor", async () => {
    const { written } = setup();
    await userEvent.click(screen.getByRole("tab", { name: /Keyboard/ }));
    const capture = await screen.findByRole("button", { name: "Assign new hotkey" });
    await userEvent.click(capture);
    fireEvent.keyDown(capture, { code: "Escape", key: "Escape" });
    await userEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.name).toBe("keyboardmd.ini");
    expect(written.at(-1)?.text).toContain("TeamCreate_1=27");
  });

  it("shows and writes the built-in bindings when the game has no keyboard file", async () => {
    const { written } = setup({ keyboard: false });
    await userEvent.click(screen.getByRole("tab", { name: /Keyboard/ }));
    expect(await screen.findByText(/no keyboard file yet/i)).toBeInTheDocument();
    const capture = await screen.findByRole("button", { name: "Assign new hotkey" });
    await userEvent.click(capture);
    fireEvent.keyDown(capture, { code: "F5", key: "F5" });
    await userEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.name).toBe("keyboardmd.ini");
    expect(written.at(-1)?.text).toContain("ToggleAlliance=116");
    expect(written.at(-1)?.text).toContain("Options=27");
    expect(written.at(-1)?.text).toContain("CursorCheat=222");
  });

  it("resets every binding to the game's defaults", async () => {
    const { written } = setup();
    await userEvent.click(screen.getByRole("tab", { name: /Keyboard/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Reset All" }));
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.name).toBe("keyboardmd.ini");
    expect(written.at(-1)?.text).toContain("Options=27");
    expect(written.at(-1)?.text).toContain("CursorCheat=222");
    expect(written.at(-1)?.text).toContain("TeamSelect_1=49");
  });

  it("shows a write error and keeps the rest of the dialog usable", async () => {
    const { deps } = setup();
    deps.writeSave.mockRejectedValueOnce(new Error("disk full"));
    await gameplay();
    await userEvent.click(screen.getByRole("switch", { name: "Auto scroll" }));
    expect(
      await screen.findByText(/Could not save the game settings: disk full/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /Audio/ }));
    expect(screen.getByRole("slider", { name: "Sound volume" })).toBeInTheDocument();
  });
});
