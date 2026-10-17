// What of a game folder the browser build keeps (docs/web/storage.md): the same
// list the import uses (W6.1 builds on this), the dev server serves, and the
// host's --memfs copies. Matched without regard to case, at the folder's top level.

const EXTENSIONS = [
  ".mix",
  ".bag",
  ".idx",
  ".ini",
  ".csf",
  ".mmx",
  ".map",
  ".mpr",
  ".yrm",
  ".exe",
  ".dll",
];

export function isAllowlisted(fileName: string): boolean {
  const name = fileName.toLowerCase();
  return EXTENSIONS.some((extension) => name.endsWith(extension));
}
