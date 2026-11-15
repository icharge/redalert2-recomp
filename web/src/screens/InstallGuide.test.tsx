import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { classify, REQUIRED_CONTENT, REQUIRED_MOVIE_ARCHIVES } from "../storage/install";
import { COPIED, InstallGuide, NOT_COPIED, SOURCES } from "./InstallGuide";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function show() {
  render(
    <MemoryRouter initialEntries={["/install/guide"]}>
      <Routes>
        <Route path="/install/guide" element={<InstallGuide />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** a file name a pattern of the guide stands for: `*.mix` → `x.mix`, `Saved Games/` → a save in it */
const example = (pattern: string) =>
  pattern.endsWith("/") ? `${pattern}SAVE0001.SAV` : pattern.replace("*", "x");

describe("InstallGuide", () => {
  it("has a section for every source, with its folder and what to pick", () => {
    show();
    expect(SOURCES.map((source) => source.name)).toEqual([
      "Original CDs",
      "The First Decade",
      "EA App or Origin",
      "Steam",
    ]);
    for (const source of SOURCES) {
      const section = within(screen.getByRole("article", { name: source.name }));
      for (const folder of source.folders) expect(section.getByText(folder)).toBeInTheDocument();
      expect(section.getByText(source.pick)).toBeInTheDocument();
    }
  });

  it("covers the archive or installer option", () => {
    show();
    const how = screen.getByRole("region", { name: "THE FOLDER, OR AN ARCHIVE OR INSTALLER" });
    expect(how).toHaveTextContent(".7z, .zip, .rar, .exe");
    expect(how).toHaveTextContent(/Setup\.exe and some installers cannot be opened/);
  });

  it("lists each game's required files from the import's own list", () => {
    show();
    const copied = within(screen.getByRole("region", { name: "WHAT IS COPIED" }));
    for (const name of [...REQUIRED_CONTENT.ra2md, ...REQUIRED_MOVIE_ARCHIVES.ra2md])
      expect(copied.getAllByText(name).length).toBeGreaterThan(0);
  });

  it("says copied only for what the import copies, and never copied for what it leaves", () => {
    for (const row of COPIED)
      for (const pattern of row.files) expect(classify(example(pattern)), pattern).not.toBeNull();
    for (const name of NOT_COPIED) expect(classify(name), name).toBeNull();
  });

  it("says where the copy stays and what is never uploaded", () => {
    show();
    expect(screen.getByRole("region", { name: "WHERE IT STAYS" })).toHaveTextContent(
      /this browser’s own storage/,
    );
    expect(screen.getByRole("region", { name: "WHAT IS NEVER UPLOADED" })).toHaveTextContent(
      /none of them is sent/,
    );
  });

  it("ends with a button to the install screen", async () => {
    show();
    const install = screen.getByRole("link", { name: "INSTALL THE GAME" });
    expect(install).toHaveAttribute("href", "/import");
    await userEvent.setup().click(install);
    expect(screen.getByTestId("where")).toHaveTextContent("/import");
  });
});
