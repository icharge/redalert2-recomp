import { Manifest } from "../storage/manifest";

const KEY = "volume";

/** The player's volume, 0 to 1: what they last set, or full. Never throws; no storage means full. */
export async function loadVolume(
  open: () => Promise<Manifest> = () => Manifest.open(),
): Promise<number> {
  try {
    const value = await (await open()).getSetting<number>(KEY);
    return typeof value === "number" && value >= 0 && value <= 1 ? value : 1;
  } catch {
    return 1;
  }
}

export async function saveVolume(
  volume: number,
  open: () => Promise<Manifest> = () => Manifest.open(),
): Promise<void> {
  try {
    await (await open()).setSetting(KEY, volume);
  } catch {
    // the volume is just not remembered
  }
}
