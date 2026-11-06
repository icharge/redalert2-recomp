import { Dialog, Flex, Text } from "@radix-ui/themes";
import { linkCopy, outboundUrl, sitePageUrl, type LinkTarget } from "../game/link-targets";
import { gameDialogButtonClass, GameDialogChrome } from "./GameDialogChrome";
import styles from "./LinkDialogContent.module.css";

/**
 * What the game asked the browser to open, shown in our dialog.
 *
 * The game wants an external page; the player decides. "Open" is a plain
 * `target="_blank"` anchor (never `window.open`, never the same tab), so the
 * game page never navigates away. An embeddable target (a page we control) is
 * framed above the same buttons, and Open goes to that page; otherwise Open is
 * the URL the game asked for, unchanged.
 */
export function LinkDialogContent({ target, onClose }: { target: LinkTarget; onClose(): void }) {
  const copy = linkCopy(target);
  const frameUrl = target.embed ? sitePageUrl(target) : null;
  const open = outboundUrl(target);

  return (
    <GameDialogChrome title={copy.title}>
      <Dialog.Description size="2" className={styles.body}>
        {copy.body}
      </Dialog.Description>
      {frameUrl && (
        <iframe
          className={styles.frame}
          src={frameUrl}
          title={copy.title}
          sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
        />
      )}
      <Text as="p" size="1" className={styles.label}>
        {target.seeded ? "This build's registry target:" : "The game asked for:"}
      </Text>
      <Text as="p" size="1" className={styles.url}>
        {target.page ? `${target.page} page` : target.url || "(no URL)"}
      </Text>
      <Flex justify="end" gap="2" mt="4">
        {open && (
          <a
            className={gameDialogButtonClass}
            href={open}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open
          </a>
        )}
        <button type="button" className={gameDialogButtonClass} onClick={onClose}>
          Cancel
        </button>
      </Flex>
    </GameDialogChrome>
  );
}
