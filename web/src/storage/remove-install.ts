// REMOVE GAME: the installation's files out of OPFS, then its records out of the manifest.

import type { Manifest } from "./manifest";
import { gamePath, type CopyTarget } from "./opfs";

/**
 * Deletes an installation: every file it alone has in OPFS, then its records. The records go only
 * once the files have, so a file that will not delete (the game open in another tab holds its
 * files) leaves the installation listed, and REMOVE GAME can be tried again; forgetting it first
 * would leave the files in the browser with nothing pointing at them.
 */
export async function removeInstall(
  manifest: Manifest,
  target: CopyTarget,
  slot: number,
): Promise<void> {
  const failed = await deleteInstallFiles(manifest, target, slot);
  if (failed.length) throw new Error(notRemoved(failed));
  await manifest.removeInstallation(slot);
}

/**
 * Deletes every file the installation alone has in OPFS, and keeps the records. Returns the errors of
 * the files that would not go, for a caller that reports them with others.
 */
export async function deleteInstallFiles(
  manifest: Manifest,
  target: CopyTarget,
  slot: number,
): Promise<unknown[]> {
  const failed: unknown[] = [];
  for (const file of await manifest.installationFiles(slot)) {
    try {
      await target.remove(gamePath(file.home, file.name));
    } catch (error) {
      failed.push(error);
    }
  }
  return failed;
}

export function notRemoved(errors: unknown[]): string {
  const count = errors.length === 1 ? "A file" : `${errors.length} files`;
  // Chromium's error for a file another tab has open
  if (
    errors.some(
      (error) => error instanceof DOMException && error.name === "NoModificationAllowedError",
    )
  )
    return `${count} of the game could not be deleted: in use, most likely by the game open in another tab. Close that tab, then REMOVE GAME again.`;
  const first = errors[0];
  return `${count} of the game could not be deleted (${first instanceof Error ? first.message : String(first)}). REMOVE GAME again to retry.`;
}
