import { Dialog } from "@radix-ui/themes";
import styles from "./ExitConfirm.module.css";

/** The game asked to quit (its own Exit button, or Alt+F4): confirm before the page goes back. */
export function ExitConfirm({
  open,
  onAnswer,
  returnFocus,
}: {
  open: boolean;
  onAnswer(leave: boolean): void;
  /** where the keyboard goes when the question closes: the game */
  returnFocus(): void;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && open) onAnswer(false);
      }}
    >
      <Dialog.Content
        className={styles.card}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <Dialog.Title className={styles.title}>LEAVE THE GAME?</Dialog.Title>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => onAnswer(false)}>
            STAY
          </button>
          <button type="button" className={styles.primary} onClick={() => onAnswer(true)}>
            EXIT GAME
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
