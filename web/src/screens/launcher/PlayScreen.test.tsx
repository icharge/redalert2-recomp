import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ActiveInstall } from "../../storage/active-install";
import type { BuildInfo, GameId } from "../../storage/install";
import type { GameRecord } from "../../storage/manifest";
import type { ModRecord } from "../../storage/mods";
import { PlayScreen } from "./PlayScreen";

const g = (id: GameId, extra: Partial<GameRecord> = {}): GameRecord => ({
  id,
  slot: 1,
  storage: id,
  title: id,
  exeStamp: 0,
  importedAt: 0,
  bytes: 0,
  complete: true,
  files: {},
  ...extra,
});
const ra2 = g("ra2");
const yr = g("ra2md");
const install = (
  editions: GameRecord[],
  extra: Partial<ActiveInstall["installation"]> = {},
): ActiveInstall => ({
  installation: { slot: 1, name: "Game", importedAt: 0, ...extra },
  editions,
});
const mod = (name: string): ModRecord => ({ name, files: [], bytes: 0 });

// a build whose runtimes exist and need ra2.mix (and ra2md.mix for YR)
const build = {
  games: {
    ra2: {
      title: "Red Alert 2",
      exe: "",
      ini: "",
      build: "b",
      runtime: { edition: "ra2", build: "b" },
    },
    ra2md: {
      title: "Yuri's Revenge",
      exe: "",
      ini: "",
      build: "b",
      runtime: { edition: "ra2md", build: "b" },
    },
  },
} as unknown as BuildInfo;

function renderPlay(props: Partial<Parameters<typeof PlayScreen>[0]> = {}) {
  const handlers = {
    onActiveMod: vi.fn(async () => {}),
    onPlay: vi.fn(),
    onInstall: vi.fn(),
    onResume: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={
            <PlayScreen
              install={install([ra2, yr])}
              edition={yr}
              mods={[]}
              activeMod=""
              {...handlers}
              {...props}
            />
          }
        />
        <Route path="/mods" element={<p>mods page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return handlers;
}

describe("PlayScreen", () => {
  it("nothing installed shows one INSTALL THE GAME button", async () => {
    const { onInstall } = renderPlay({ install: null, edition: null });
    expect(screen.queryByRole("button", { name: "PLAY" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "INSTALL THE GAME" }));
    expect(onInstall).toHaveBeenCalled();
  });

  it("YR shows EXPANSION and YURI’S REVENGE", () => {
    renderPlay();
    expect(screen.getByText("EXPANSION")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("YURI’S REVENGE");
  });

  it("RA2 shows RED ALERT 2 without a kicker", () => {
    renderPlay({ edition: ra2 });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("RED ALERT 2");
    expect(screen.queryByText("EXPANSION")).toBeNull();
  });

  it("PLAY calls onPlay with the edition", async () => {
    const { onPlay } = renderPlay();
    expect(screen.getByRole("status")).toHaveTextContent("Ready");
    await userEvent.click(screen.getByRole("button", { name: "PLAY" }));
    expect(onPlay).toHaveBeenCalledWith(yr);
  });

  it("PLAY is disabled with the readiness reason as the status", () => {
    renderPlay({ build });
    expect(screen.getByRole("button", { name: "PLAY" })).toBeDisabled();
    expect(screen.getByRole("status").textContent).toMatch(/^Missing/);
  });

  it("an unfinished import shows RESUME INSTALL", async () => {
    const { onResume, onPlay } = renderPlay({
      install: install([g("ra2md", { complete: false })]),
      edition: g("ra2md", { complete: false }),
    });
    expect(screen.queryByRole("button", { name: "PLAY" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "RESUME INSTALL" }));
    expect(onResume).toHaveBeenCalledWith(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("an edition still to import offers RESUME INSTALL beside PLAY", async () => {
    const { onResume } = renderPlay({ install: install([yr], { editions: ["ra2", "ra2md"] }) });
    expect(screen.getByRole("button", { name: "PLAY" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "RESUME INSTALL" }));
    expect(onResume).toHaveBeenCalledWith(1);
  });

  it("the profile menu lists Vanilla and each mod, and picking one calls onActiveMod(name)", async () => {
    const { onActiveMod } = renderPlay({ mods: [mod("Mental Omega"), mod("Rise")], activeMod: "" });
    const profile = screen.getByRole("button", { name: /PROFILE/ });
    expect(profile).toHaveTextContent("Vanilla");
    await userEvent.click(profile);
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Vanilla", "Mental Omega", "Rise"]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("option", { name: "Rise" }));
    expect(onActiveMod).toHaveBeenCalledWith("Rise");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape closes the profile menu", async () => {
    renderPlay({ mods: [mod("Rise")] });
    await userEvent.click(screen.getByRole("button", { name: /PROFILE/ }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("MANAGE MODS goes to /mods", async () => {
    renderPlay({ mods: [mod("Rise")] });
    await userEvent.click(screen.getByRole("button", { name: /PROFILE/ }));
    await userEvent.click(screen.getByRole("link", { name: "MANAGE MODS" }));
    expect(screen.getByText("mods page")).toBeInTheDocument();
  });
});
