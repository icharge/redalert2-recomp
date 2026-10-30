const KEY = "ra2-stats";

export function readStatsPreference(storage?: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeStatsPreference(on: boolean, storage?: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(KEY, on ? "1" : "0");
  } catch {
    // Storage may be unavailable, such as in a private window.
  }
}

export function statsWanted(search: string, storage?: Pick<Storage, "getItem"> | null): boolean {
  if (new URLSearchParams(search).has("stats")) return true;
  return readStatsPreference(storage);
}
