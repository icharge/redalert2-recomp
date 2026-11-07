import { Theme } from "@radix-ui/themes";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDBFactory } from "fake-indexeddb";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeLatin1 } from "../../../storage/game-settings";
import type { GameRecord } from "../../../storage/manifest";
import { Manifest } from "../../../storage/manifest";
import { SettingsEmpty, SettingsScreen, type SettingsTab } from "./SettingsScreen";

const yr: GameRecord = {
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
const ra2: GameRecord = { ...yr, id: "ra2", storage: "slot-1-ra2", title: "Red Alert 2" };

const decoded = (data: Uint8Array) => new TextDecoder("latin1").decode(data);

const YR_INI =
  "[Options]\nGameSpeed=1\nDifficulty=1\nAutoScroll=yes\nScrollRate=3\n[Audio]\nSoundVolume=0.700000\n[Video]\nScreenWidth=800\nScreenHeight=600\n[MultiPlayer]\nHandle=50,6c,61,79,65,72,\n[Skirmish]\nGameSpeed=1\n[LAN]\nGameSpeed=1\n[WonlinePref]\nGameSpeed=1\n";

function setup({
  keyboard = true,
  main = true,
  mainIni,
  editions = [yr],
  shown,
  tab = "launcher",
}: {
  keyboard?: boolean;
  main?: boolean;
  mainIni?: string;
  editions?: GameRecord[];
  shown?: GameRecord;
  tab?: SettingsTab;
} = {}) {
  const saved = new Map<string, string>();
  if (main) {
    saved.set("slot-1-ra2md/ra2md.ini", mainIni ?? YR_INI);
    saved.set("slot-1-ra2/ra2.ini", "[Options]\nGameSpeed=1\nAutoScroll=yes\n");
  }
  if (keyboard)
    saved.set("slot-1-ra2md/keyboardmd.ini", "[Hotkey]\nTeamCreate_1=561\nTeamSelect_1=49\n");
  const written: { storage: string; name: string; text: string }[] = [];
  const deps = {
    readSave: vi.fn(async (storage: string, name: string) => {
      const text = saved.get(`${storage}/${name.toLowerCase()}`);
      return text === undefined ? null : { name, data: encodeLatin1(text) };
    }),
    readImported: vi.fn(async () => {
      throw new Error("nothing was imported");
    }),
    writeSave: vi.fn(async (storage: string, name: string, data: Uint8Array) => {
      const text = decoded(data);
      saved.set(`${storage}/${name.toLowerCase()}`, text);
      written.push({ storage, name, text });
    }),
  };
  function Routed() {
    const params = useParams();
    return (
      <SettingsScreen
        editions={editions}
        edition={shown ?? editions.at(-1)!}
        tab={(params.tab ?? "launcher") as SettingsTab}
        gameSettingsDeps={deps}
      />
    );
  }
  render(
    <Theme>
      <MemoryRouter initialEntries={[`/settings/${tab}`]}>
        <Routes>
          <Route path="/settings/:tab" element={<Routed />} />
        </Routes>
      </MemoryRouter>
    </Theme>,
  );
  return { deps, written };
}

async function open(name: "LAUNCHER" | "GAMEPLAY" | "AUDIO" | "VIDEO" | "KEYBOARD") {
  await userEvent.click(screen.getByRole("link", { name }));
}

async function gameplay() {
  await open("GAMEPLAY");
  await screen.findByRole("switch", { name: "Auto scroll" });
}

describe("SettingsScreen", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("marks the open section", async () => {
    setup();
    expect(screen.getByRole("link", { name: "LAUNCHER" })).toHaveAttribute("aria-current", "page");
    await open("AUDIO");
    expect(screen.getByRole("link", { name: "AUDIO" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "LAUNCHER" })).not.toHaveAttribute("aria-current");
  });

  it("ends the sections with About, which shows the launcher's version", async () => {
    setup();
    const links = within(screen.getByRole("navigation", { name: "Settings" })).getAllByRole("link");
    expect(links.at(-1)).toHaveTextContent("ABOUT");
    await userEvent.click(screen.getByRole("link", { name: "ABOUT" }));
    const version = await screen.findByRole("region", { name: "Version" });
    expect(version).toHaveTextContent(__APP_VERSION__);
  });

  it("shows About with no game installed, where the other sections ask for the game", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <SettingsEmpty tab="about" />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("region", { name: "Version" })).toHaveTextContent(
      __APP_VERSION__,
    );
    expect(screen.queryByText("Install the game to change its settings.")).toBeNull();
    unmount();
    render(
      <MemoryRouter>
        <SettingsEmpty tab="audio" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Install the game to change its settings.")).toBeInTheDocument();
  });

  it("has no scope badge beside the title", () => {
    setup({ editions: [ra2, yr] });
    expect(screen.queryByText("ALL GAMES")).toBeNull();
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

  it("a Gameplay change writes both INI files", async () => {
    const { written } = setup({ editions: [ra2, yr] });
    await gameplay();
    await userEvent.click(screen.getByRole("switch", { name: "Auto scroll" }));
    await waitFor(() => expect(written).toHaveLength(2));
    expect(written.map((w) => [w.storage, w.name.toLowerCase()])).toEqual([
      ["slot-1-ra2", "ra2.ini"],
      ["slot-1-ra2md", "ra2md.ini"],
    ]);
    for (const w of written) expect(w.text).toContain("AutoScroll=no");
  });

  it("writes a choice to the game's own INI", async () => {
    const { written } = setup();
    await gameplay();
    await userEvent.click(
      within(screen.getByRole("radiogroup", { name: "Difficulty" })).getByRole("radio", {
        name: "Hard",
      }),
    );
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.text).toContain("Difficulty=2");
  });

  it("campaign difficulty is written only to Yuri's Revenge", async () => {
    const { written } = setup({ editions: [ra2, yr] });
    await gameplay();
    const group = screen.getByRole("radiogroup", { name: "Campaign difficulty" });
    await userEvent.click(group.querySelectorAll("[role=radio]")[0] as HTMLElement);
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.map((w) => w.storage)).toEqual(["slot-1-ra2md"]);
    expect(written[0]?.text).toContain("CampDifficulty=0");
  });

  it("campaign difficulty is offered only while Yuri's Revenge is shown", async () => {
    setup({ editions: [ra2, yr], shown: ra2 });
    await gameplay();
    expect(screen.queryByRole("radiogroup", { name: "Campaign difficulty" })).toBeNull();
  });

  it("offers the fastest scroll rate the game has", async () => {
    const { written } = setup();
    await gameplay();
    fireEvent.keyDown(screen.getByRole("slider", { name: "Scroll speed" }), { key: "End" });
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.text).toContain("ScrollRate=0");
  });

  it("writes the match speed to every mode, keeping the global options speed", async () => {
    const { written } = setup();
    await gameplay();
    fireEvent.keyDown(screen.getByRole("slider", { name: "Game speed" }), { key: "ArrowRight" });
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    const text = written.at(-1)?.text ?? "";
    expect(text).toContain("[Options]\nGameSpeed=1");
    expect(text).toContain("[Skirmish]\nGameSpeed=0");
    expect(text).toContain("[LAN]\nGameSpeed=0");
    expect(text).toContain("[WonlinePref]\nGameSpeed=0");
  });

  it("shows the match speed when it differs from the global options speed", async () => {
    setup({
      mainIni:
        "[Options]\nGameSpeed=2\nDifficulty=1\n[Skirmish]\nGameSpeed=1\n[LAN]\nGameSpeed=4\n[WonlinePref]\nGameSpeed=3\n",
    });
    await gameplay();
    expect(screen.getByRole("slider", { name: "Game speed" })).toHaveAttribute(
      "aria-valuenow",
      "5",
    );
  });

  it("defaults the match speed to 5 when the file has no match section", async () => {
    setup({ mainIni: "[Options]\nGameSpeed=2\nDifficulty=1\n" });
    await gameplay();
    expect(screen.getByRole("slider", { name: "Game speed" })).toHaveAttribute(
      "aria-valuenow",
      "5",
    );
  });

  it("resets the match speed to the default 5", async () => {
    const { written } = setup();
    await gameplay();
    fireEvent.keyDown(screen.getByRole("slider", { name: "Game speed" }), { key: "ArrowRight" });
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole("button", { name: "RESET DEFAULTS" }));
    await waitFor(() => expect(written.at(-1)?.text).toContain("[Skirmish]\nGameSpeed=1"));
    expect(written.at(-1)?.text).toContain("[LAN]\nGameSpeed=1");
    expect(written.at(-1)?.text).toContain("[WonlinePref]\nGameSpeed=1");
  });

  it("RESET DEFAULTS resets the open tab only", async () => {
    const { written } = setup({
      mainIni: YR_INI.replace("SoundVolume=0.700000", "SoundVolume=0.200000"),
    });
    await gameplay();
    await userEvent.click(screen.getByRole("button", { name: "RESET DEFAULTS" }));
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.text).toContain("Difficulty=");
    expect(written.at(-1)?.text).toContain("SoundVolume=0.200000");
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
    expect(await screen.findByText(/no settings file yet/i)).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Game speed" })).toHaveAttribute(
      "aria-valuenow",
      "5",
    );
    expect(screen.getByRole("switch", { name: "Show hidden objects" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "Player name" })).toHaveValue("");
    await open("AUDIO");
    expect(await screen.findByRole("slider", { name: "Sound" })).toHaveAttribute(
      "aria-valuenow",
      "70",
    );
  });

  it("stores the campaign speed-control choice for the next launch", async () => {
    setup();
    await gameplay();
    const toggle = screen.getByRole("switch", { name: "Speed control in campaign" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(localStorage.getItem("ra2.speed-control.slot-1-ra2md")).toBe("1");
  });

  it("writes the presentation settings to the host file", async () => {
    const { written } = setup();
    expect(screen.getByRole("radio", { name: "Smooth" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "CRT" }));
    await waitFor(() =>
      expect(
        written.some(
          (entry) => entry.name === ".host/ra2md.ini" && entry.text.includes("scale=crt"),
        ),
      ).toBe(true),
    );
    await userEvent.click(screen.getByRole("radio", { name: "Black" }));
    await waitFor(() => expect(written.at(-1)?.text).toContain("bars=black"));
    await userEvent.click(screen.getByRole("switch", { name: "HD vehicles" }));
    await waitFor(() => expect(written.at(-1)?.text).toContain("hdvox=1"));
    expect(written.at(-1)?.text).toContain("scale=crt");
    expect(written.at(-1)?.text).toContain("bars=black");
  });

  it("stores the software-cursor choice for the next launch", async () => {
    setup();
    const cursor = screen.getByRole("radiogroup", { name: "Cursor" });
    expect(screen.getByRole("radio", { name: "Smooth cursor" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(screen.getByRole("radio", { name: "Classic" }));
    expect(localStorage.getItem("ra2.software-cursor.slot-1-ra2md")).toBe("1");
    await userEvent.click(screen.getByRole("radio", { name: "Smooth cursor" }));
    expect(localStorage.getItem("ra2.software-cursor.slot-1-ra2md")).toBeNull();
    expect(cursor).toBeInTheDocument();
  });

  it("hints are tooltips", () => {
    setup();
    const tip = screen.getByRole("button", {
      name: /draws the game's cursor at the display's rate/,
    });
    expect(tip).toHaveAttribute("title", tip.getAttribute("aria-label"));
    expect(screen.queryByText(/draws the game's cursor at the display's rate/)).toBeNull();
  });

  it("a Launcher toggle writes both storages", async () => {
    setup({ editions: [ra2, yr] });
    await userEvent.click(screen.getByRole("switch", { name: "Skip intro" }));
    expect(localStorage.getItem("ra2.skip-intro.slot-1-ra2")).not.toBeNull();
    expect(localStorage.getItem("ra2.skip-intro.slot-1-ra2md")).toBe(
      localStorage.getItem("ra2.skip-intro.slot-1-ra2"),
    );
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
    await userEvent.click(screen.getByRole("switch", { name: "Speed control in campaign" }));
    await userEvent.click(screen.getByRole("switch", { name: "MOBA style" }));
    await waitFor(() => expect(localStorage.getItem("ra2.speed-control.slot-1-ra2md")).toBe("1"));
    await waitFor(() =>
      expect(
        written.some(
          (entry) => entry.name === ".host/ra2md.ini" && entry.text.includes("controls=modern"),
        ),
      ).toBe(true),
    );
    await userEvent.click(screen.getByRole("button", { name: "RESET DEFAULTS" }));
    await waitFor(() => {
      expect(localStorage.getItem("ra2.speed-control.slot-1-ra2md")).toBeNull();
      expect(screen.getByRole("switch", { name: "Speed control in campaign" })).toHaveAttribute(
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
    await open("AUDIO");
    await userEvent.click(await screen.findByRole("button", { name: "RESET DEFAULTS" }));
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.text).toContain("SoundVolume=0.700000");
    expect(written.at(-1)?.text).toContain("ScoreVolume=0.400000");
    expect(written.at(-1)?.text).toContain("SoundLatency=9");
  });

  it("volume is a 10-pip bar the arrow keys move by one pip", async () => {
    const { written } = setup();
    await open("AUDIO");
    const sound = await screen.findByRole("slider", { name: "Sound" });
    expect(sound).toHaveAttribute("aria-valuetext", "70%");
    expect(sound.querySelectorAll("span")).toHaveLength(10);
    fireEvent.keyDown(sound, { key: "ArrowRight" });
    await waitFor(() => expect(written.at(-1)?.text).toContain("SoundVolume=0.800000"));
  });

  it("stores the menu-music choice the in-game speaker popover shares", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    setup();
    await open("AUDIO");
    const music = await screen.findByRole("switch", { name: "Menu music" });
    expect(music).toHaveAttribute("aria-checked", "true");
    await userEvent.click(music);
    expect(music).toHaveAttribute("aria-checked", "false");
    const manifest = await Manifest.open();
    await waitFor(() => expect(manifest.getSetting("menuMusic")).resolves.toBe(false));
    manifest.close();
  });

  it("assigns a captured hotkey from the keyboard editor", async () => {
    const { written } = setup();
    await open("KEYBOARD");
    await userEvent.click(await screen.findByRole("button", { name: "Team" }));
    await userEvent.click(screen.getByRole("button", { name: /^Team Create 1/ }));
    const capture = screen.getByRole("button", { name: "CHANGE KEY" });
    await userEvent.click(capture);
    expect(capture).toHaveTextContent("PRESS A KEY…");
    fireEvent.keyDown(capture, { code: "Escape", key: "Escape" });
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.name).toBe("keyboardmd.ini");
    expect(written.at(-1)?.text).toContain("TeamCreate_1=27");
  });

  it("says when the new key is also used by another command", async () => {
    setup();
    await open("KEYBOARD");
    await userEvent.click(await screen.findByRole("button", { name: "Team" }));
    await userEvent.click(screen.getByRole("button", { name: /^Team Create 1/ }));
    const capture = screen.getByRole("button", { name: "CHANGE KEY" });
    await userEvent.click(capture);
    fireEvent.keyDown(capture, { code: "Digit1", key: "1", keyCode: 49 });
    expect(await screen.findByText(/Also used by Team Select 1/)).toBeInTheDocument();
  });

  it("shows and writes the built-in bindings when the game has no keyboard file", async () => {
    const { written } = setup({ keyboard: false });
    await open("KEYBOARD");
    expect(await screen.findByText(/no keyboard file yet/i)).toBeInTheDocument();
    const capture = await screen.findByRole("button", { name: "CHANGE KEY" });
    await userEvent.click(capture);
    fireEvent.keyDown(capture, { code: "F5", key: "F5" });
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.name).toBe("keyboardmd.ini");
    expect(written.at(-1)?.text).toContain("ToggleAlliance=116");
    expect(written.at(-1)?.text).toContain("Options=27");
    expect(written.at(-1)?.text).toContain("CursorCheat=222");
  });

  it("resets every binding to the game's defaults", async () => {
    const { written } = setup();
    await open("KEYBOARD");
    await userEvent.click(await screen.findByRole("button", { name: "RESET ALL KEYS" }));
    await waitFor(() => expect(written.length).toBeGreaterThan(0));
    expect(written.at(-1)?.name).toBe("keyboardmd.ini");
    expect(written.at(-1)?.text).toContain("Options=27");
    expect(written.at(-1)?.text).toContain("CursorCheat=222");
    expect(written.at(-1)?.text).toContain("TeamSelect_1=49");
  });

  it("stores Match browser as the launcher's resolution choice", async () => {
    setup();
    await open("VIDEO");
    expect(screen.getByRole("radio", { name: "Fixed" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("combobox", { name: "Size" })).toHaveDisplayValue("1920 × 1080");
    await userEvent.click(screen.getByRole("radio", { name: "Match browser" }));
    expect(localStorage.getItem("ra2.video.slot-1-ra2md")).toBe('"browser"');
    expect(screen.queryByRole("combobox", { name: "Size" })).toBeNull();
  });

  it("shows a write error and keeps the rest of the screen usable", async () => {
    const { deps } = setup();
    deps.writeSave.mockRejectedValueOnce(new Error("disk full"));
    await gameplay();
    await userEvent.click(screen.getByRole("switch", { name: "Auto scroll" }));
    expect(
      await screen.findByText(/Could not save the game settings: disk full/),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Auto scroll" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await open("AUDIO");
    expect(await screen.findByRole("slider", { name: "Sound" })).toBeInTheDocument();
  });
});
