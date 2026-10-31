import { Dialog } from "@radix-ui/themes";
import type { LinkTarget } from "../game/link-targets";
import { LinkDialogContent } from "./LinkDialogContent";

/**
 * The game asked for a URL: show it over the running game. Mounted by
 * Play.tsx; closing only dismisses the dialog, the game keeps running.
 */
export function LinkDialog({
  target,
  onClose,
  returnFocusTo,
}: {
  target: LinkTarget | null;
  onClose(): void;
  /** where focus goes when the dialog closes (the game canvas) */
  returnFocusTo?: HTMLElement | null;
}) {
  return (
    <Dialog.Root
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content
        maxWidth="760px"
        onCloseAutoFocus={(event) => {
          if (!returnFocusTo) return;
          event.preventDefault();
          returnFocusTo.focus();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        {target && <LinkDialogContent target={target} onClose={onClose} />}
      </Dialog.Content>
    </Dialog.Root>
  );
}
