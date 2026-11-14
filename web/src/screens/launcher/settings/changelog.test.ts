import { describe, expect, it } from "vitest";
import changelogText from "../../../../CHANGELOG.md?raw";
import { newestRelease } from "./changelog";
import { APP_VERSION } from "../../../version";

const SAMPLE = `# Changelog

Intro text.

## [0.2.0] - 2026-12-01

The second release.

### Added

- **Bring your own game**: point the page at your folder once. The files
  are copied in. (7f91eaa2, f313d27e)
- **Thai typing**: text arrives as \`Windows-874\` Thai. (64125f31)

### Fixed

- Escape in full screen opens the game's pause menu. (afc28106)
- See [the docs](docs/x.md) for more.

## [0.1.0] - 2026-11-07

### Added

- **Old**: not shown. (aaaaaaa)
`;

describe("newestRelease", () => {
  it("reads the newest section's version and date", () => {
    const release = newestRelease(SAMPLE);
    expect(release?.version).toBe("0.2.0");
    expect(release?.date).toBe("2026-12-01");
  });

  it("keeps the groups in order and only the newest section's entries", () => {
    const release = newestRelease(SAMPLE);
    expect(release?.groups.map((g) => g.kind)).toEqual(["Added", "Fixed"]);
    expect(release?.groups.flatMap((g) => g.entries).length).toBe(4);
  });

  it("splits a bold title from its text and joins wrapped lines", () => {
    const [first] = newestRelease(SAMPLE)!.groups[0]!.entries;
    expect(first).toEqual({
      title: "Bring your own game",
      text: "Point the page at your folder once. The files are copied in.",
    });
  });

  it("drops the commit refs and the markdown marks", () => {
    const entries = newestRelease(SAMPLE)!.groups.flatMap((g) => g.entries);
    expect(entries[1]?.text).toBe("Text arrives as Windows-874 Thai.");
    expect(entries[2]).toEqual({ text: "Escape in full screen opens the game's pause menu." });
    expect(entries[3]?.text).toBe("See the docs for more.");
  });

  it("calls an unreleased section unreleased, with no date", () => {
    const release = newestRelease("## [Unreleased]\n\n### Fixed\n\n- A fix. (abc1234)\n");
    expect(release).toMatchObject({ version: "Unreleased", date: null });
  });

  it("has nothing to show for a file with no section", () => {
    expect(newestRelease("# Changelog\n\nNothing yet.\n")).toBeNull();
  });

  it("reads the browser build's own changelog, at package.json's version", () => {
    const release = newestRelease(changelogText);
    expect(release?.version).toBe(APP_VERSION);
    expect(release?.groups.flatMap((g) => g.entries).length).toBeGreaterThan(0);
    for (const entry of release!.groups.flatMap((g) => g.entries))
      expect(entry.text).not.toMatch(/\(([0-9a-f]{7,}(, )?)+\)|\*\*|`/);
  });
});
