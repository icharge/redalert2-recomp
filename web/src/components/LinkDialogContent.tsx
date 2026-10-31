import { Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { linkCopy, sitePageUrl, type LinkTarget } from "../game/link-targets";
import styles from "./LinkDialogContent.module.css";

/**
 * What the game asked the browser to open, shown in our dialog.
 *
 * An embeddable target (a page we control) is framed; every other target shows
 * the confirmation with the URL the game asked for. "Open in browser" is a
 * plain `target="_blank"` anchor: the browser picks a tab or a window, and the
 * game page never navigates away. Framing is best-effort (X-Frame-Options, CSP
 * and COEP can refuse it), so the outbound link stays visible either way.
 */
export function LinkDialogContent({ target, onClose }: { target: LinkTarget; onClose(): void }) {
  const copy = linkCopy(target);
  const siteUrl = sitePageUrl(target);
  const frameUrl = target.embed ? siteUrl : null;
  // The embedded page, else the original URL when it is safe to offer.
  const outbound = frameUrl ?? (target.external ? target.url : null);

  return (
    <>
      <Dialog.Title>{copy.title}</Dialog.Title>
      <Dialog.Description size="2" mb="3">
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
      <Text as="p" size="1" color="gray" mt="3" mb="1">
        The game asked for:
      </Text>
      <Text as="p" size="1" className={styles.url}>
        {target.url || "(no URL)"}
      </Text>
      <Flex justify="end" gap="2" mt="4">
        {outbound && (
          <Button asChild color="red">
            <a href={outbound} target="_blank" rel="noopener noreferrer">
              Open in browser
            </a>
          </Button>
        )}
        <Button variant="soft" onClick={onClose}>
          {target.embed ? "Close" : "Cancel"}
        </Button>
      </Flex>
    </>
  );
}
