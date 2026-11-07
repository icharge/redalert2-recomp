// Reads web/CHANGELOG.md (Keep a Changelog) for the About tab: the newest section, its groups and their
// entries, as plain text for players. The commit refs after each entry stay in the file.

export interface ChangelogEntry {
  /** the bold lead-in, when the entry has one */
  title?: string;
  text: string;
}

export interface ChangelogGroup {
  /** "Added", "Changed", "Fixed" and the like, as the file names them */
  kind: string;
  entries: ChangelogEntry[];
}

export interface Release {
  /** "0.1.0", or "Unreleased" */
  version: string;
  /** YYYY-MM-DD, or null for an unreleased section */
  date: string | null;
  groups: ChangelogGroup[];
}

const SECTION = /^## \[([^\]]+)\](?:\s+-\s+(\d{4}-\d{2}-\d{2}))?/;

/** Markdown marks out, commit refs off the end. */
function plain(text: string): string {
  return text
    .replace(/\s*\((?:[0-9a-f]{7,40}(?:,\s*)?)+\)\s*$/, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function entry(raw: string): ChangelogEntry {
  const titled = /^\*\*([^*]+)\*\*:\s*([\s\S]*)$/.exec(raw);
  if (!titled) return { text: plain(raw) };
  const text = plain(titled[2] ?? "");
  return { title: titled[1]!.trim(), text: text.charAt(0).toUpperCase() + text.slice(1) };
}

/** The newest `## [version] - date` section, or null when the file has none. */
export function newestRelease(markdown: string): Release | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => SECTION.test(line));
  if (start < 0) return null;
  const [, version = "", date] = SECTION.exec(lines[start]!)!;
  const release: Release = { version, date: date ?? null, groups: [] };

  let group: ChangelogGroup | null = null;
  let item: string[] | null = null;
  const close = () => {
    if (group && item) group.entries.push(entry(item.join(" ")));
    item = null;
  };
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (line.startsWith("### ")) {
      close();
      group = { kind: line.slice(4).trim(), entries: [] };
      release.groups.push(group);
    } else if (line.startsWith("- ")) {
      close();
      item = [line.slice(2).trim()];
    } else if (item && /^\s+\S/.test(line)) {
      item.push(line.trim());
    } else if (!line.trim()) {
      close();
    }
  }
  close();
  return release;
}
