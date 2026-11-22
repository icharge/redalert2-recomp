/**
 * A cross-tab lock in `localStorage`, for a page without Web Locks (`navigator.locks` exists only
 * in a secure context: an http page on a LAN address has none). Two tabs that refresh the member's
 * session together would send the same cookie, and the server takes the second use as theft.
 *
 * A lease: `{owner, until}` under the lock's name. To take it a tab waits until there is none (or
 * it expired: the tab that held it was closed), writes its own, waits `settleMs` and reads it back.
 * Two tabs that wrote at once both read back the one that was written last, so only that one goes
 * on; the other waits again. The holder renews the lease while it runs and removes it at the end.
 */

interface Lease {
  owner: string;
  until: number;
}

export interface StorageLockOptions {
  /** How long a lease lasts without renewal: a closed tab blocks the others this long at most. */
  leaseMs?: number;
  /** How long to wait after writing a lease before reading it back. */
  settleMs?: number;
  /** How often a waiting tab looks again. */
  pollMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function read(storage: Storage, name: string): Lease | null {
  try {
    const value = JSON.parse(storage.getItem(name) ?? "null") as Lease | null;
    return value && typeof value.owner === "string" && typeof value.until === "number"
      ? value
      : null;
  } catch {
    return null;
  }
}

export function storageLocks(
  storage: Storage,
  { leaseMs = 10_000, settleMs = 30, pollMs = 50 }: StorageLockOptions = {},
): <T>(name: string, run: () => Promise<T>) => Promise<T> {
  return async (name, run) => {
    const owner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const write = () =>
      storage.setItem(name, JSON.stringify({ owner, until: Date.now() + leaseMs }));
    for (;;) {
      const held = read(storage, name);
      if (held && held.until > Date.now()) {
        await sleep(pollMs);
        continue;
      }
      write();
      await sleep(settleMs);
      if (read(storage, name)?.owner === owner) break;
    }
    const renew = setInterval(() => {
      if (read(storage, name)?.owner === owner) write();
    }, leaseMs / 3);
    try {
      return await run();
    } finally {
      clearInterval(renew);
      if (read(storage, name)?.owner === owner) storage.removeItem(name);
    }
  };
}
