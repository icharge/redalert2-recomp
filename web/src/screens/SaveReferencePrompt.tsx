import { Dialog } from "@radix-ui/themes";
import styles from "./ExitConfirm.module.css";

/** The save loader found an object reference this build cannot match. */
export function SaveReferencePrompt({
  open,
  onAnswer,
  returnFocus,
}: {
  open: boolean;
  onAnswer(ignore: boolean): void;
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
        <Dialog.Title className={styles.title}>UNRESOLVED SAVE OBJECT</Dialog.Title>
        <p>
          This saved game contains an object reference this build cannot load. Ignore unresolved
          references and continue loading?
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => onAnswer(false)}>
            CANCEL LOAD
          </button>
          <button type="button" className={styles.primary} onClick={() => onAnswer(true)}>
            IGNORE &amp; CONTINUE
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
