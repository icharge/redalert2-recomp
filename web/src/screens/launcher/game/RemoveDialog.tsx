import { Dialog } from "@radix-ui/themes";
import { Cross2Icon } from "@radix-ui/react-icons";
import { useEffect, useState } from "react";
import { formatBytes } from "../../../components/format";
import type { InstallPart, PartCounts, PartSizes } from "../../../storage/install-parts";
import pageStyles from "../Page.module.css";
import styles from "./RemoveDialog.module.css";

export interface RemoveDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** the titles of the editions the install holds, in rail order */
  editions: string[];
  /** bytes of each part; null while they are measured */
  sizes: PartSizes | null;
  /** how many mods, maps and saves there are; null while they are counted */
  counts: PartCounts | null;
  onRemove(parts: InstallPart[]): Promise<void>;
}

/** Every part, in the order they are removed. */
const ALL_PARTS: InstallPart[] = ["game", "mods", "maps", "saves", "settings"];
/** The parts ticked when the dialog opens. */
const STARTS_TICKED: InstallPart[] = ["mods", "maps"];

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * Removes some or all of an install's parts from this browser. Presentational: the removal goes out
 * through onRemove, and REMOVE EVERYTHING asks inline first (no nested dialog, and no undo).
 */
export function RemoveDialog({
  open,
  onOpenChange,
  editions,
  sizes,
  counts,
  onRemove,
}: RemoveDialogProps) {
  const [ticked, setTicked] = useState<InstallPart[]>(STARTS_TICKED);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // each opening starts from the defaults, whatever the last one left
  useEffect(() => {
    if (!open) return;
    setTicked(STARTS_TICKED);
    setConfirmingAll(false);
    setError(null);
  }, [open]);

  const sizeOf = (part: InstallPart) => sizes?.[part] ?? 0;
  // a part with nothing in it cannot be ticked
  const chosen = ALL_PARTS.filter((part) => ticked.includes(part) && sizeOf(part) > 0);
  const chosenBytes = chosen.reduce((sum, part) => sum + sizeOf(part), 0);
  const everyBytes = ALL_PARTS.reduce((sum, part) => sum + sizeOf(part), 0);
  const ready = sizes !== null && !busy;

  const toggle = (part: InstallPart, on: boolean) =>
    setTicked((now) =>
      on ? [...now.filter((p) => p !== part), part] : now.filter((p) => p !== part),
    );

  async function attempt(parts: InstallPart[]) {
    setBusy(true);
    setError(null);
    try {
      await onRemove(parts);
      onOpenChange(false);
    } catch (cause) {
      setError(messageOf(cause, "The parts could not be removed."));
    } finally {
      setBusy(false);
    }
  }

  const editionText = editions.join(" and ");
  const gameHint =
    editions.length === 1
      ? "Without game content, the game needs installing again. The parts you keep stay here."
      : "Without game content, both games need installing again. The parts you keep stay here.";

  const rows: { part: InstallPart; name: string; hint?: string }[] = [
    { part: "game", name: editionText },
    {
      part: "mods",
      name: "Mods",
      hint: counts
        ? `${counts.mods} ${plural(counts.mods, "mod", "mods")}, and their slots on the MODS tab`
        : "",
    },
    {
      part: "maps",
      name: "Custom maps",
      hint: counts
        ? `${counts.maps} ${plural(counts.maps, "map", "maps")} you added or downloaded`
        : "",
    },
    {
      part: "saves",
      name: "Saved games",
      hint: counts ? `${counts.saves} ${plural(counts.saves, "save", "saves")}` : "",
    },
    { part: "settings", name: "Settings and hotkeys", hint: "Back to the game's defaults" },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="560px" className={`${pageStyles.dialog} ${styles.content}`}>
        <div className={styles.body}>
          <div className={styles.header}>
            <div className={styles.headText}>
              <Dialog.Title className={pageStyles.dialogTitle}>
                REMOVE FROM THIS BROWSER
              </Dialog.Title>
              <Dialog.Description size="2" className={styles.lede}>
                Pick what to remove. Your own game folder isn't touched.
              </Dialog.Description>
            </div>
            <Dialog.Close>
              <button type="button" className={styles.close} aria-label="Close">
                <Cross2Icon />
              </button>
            </Dialog.Close>
          </div>

          <div className={styles.rows}>
            {rows.map(({ part, name, hint }) => {
              const size = sizeOf(part);
              const disabled = !ready || size === 0;
              const isOn = chosen.includes(part);
              return (
                <label key={part} className={styles.kind} data-off={!isOn || undefined}>
                  <input
                    type="checkbox"
                    aria-label={name}
                    checked={isOn}
                    disabled={disabled}
                    onChange={(event) => toggle(part, event.target.checked)}
                  />
                  <span className={styles.kindText}>
                    <span className={styles.kindName}>{name}</span>
                    {hint && <span className={styles.kindHint}>{hint}</span>}
                  </span>
                  <span className={styles.size}>{sizes ? formatBytes(size) : ""}</span>
                </label>
              );
            })}
          </div>

          {chosen.includes("game") && <p className={styles.warn}>{gameHint}</p>}
          {chosen.includes("saves") && (
            <p className={styles.warn}>
              Removed saves can't be brought back. Download them first to keep them.
            </p>
          )}

          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}

          {confirmingAll ? (
            <div role="group" aria-label="Confirm remove everything" className={styles.allAsk}>
              <span className={styles.allQuestion}>
                Remove everything, {formatBytes(everyBytes)}?
              </span>
              <button
                type="button"
                className={pageStyles.primary}
                disabled={busy}
                onClick={() => void attempt(ALL_PARTS)}
              >
                {busy ? "REMOVING…" : "REMOVE EVERYTHING"}
              </button>
              <button
                type="button"
                className={pageStyles.outline}
                disabled={busy}
                onClick={() => setConfirmingAll(false)}
              >
                CANCEL
              </button>
            </div>
          ) : (
            <div className={styles.footer}>
              <button
                type="button"
                className={styles.everything}
                disabled={!ready}
                onClick={() => setConfirmingAll(true)}
              >
                REMOVE EVERYTHING · {formatBytes(everyBytes)}
              </button>
              <div className={styles.right}>
                <Dialog.Close>
                  <button type="button" className={pageStyles.outline} disabled={busy}>
                    CANCEL
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  className={pageStyles.primary}
                  disabled={!ready || chosen.length === 0}
                  onClick={() => void attempt(chosen)}
                >
                  {busy
                    ? "REMOVING…"
                    : chosen.length > 0
                      ? `REMOVE ${formatBytes(chosenBytes)}`
                      : "REMOVE"}
                </button>
              </div>
            </div>
          )}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
