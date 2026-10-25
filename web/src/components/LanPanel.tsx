import { Button, Callout, Dialog, Flex, Text, TextArea } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GameHandle } from "../game/loader";
import { LanIpXBridge, LanPeer, type LanStatus } from "../game/lan";
import styles from "./LanPanel.module.css";
import { gameStore } from "../game/store";

const statusText: Record<LanStatus, string> = {
  idle: "Not connected",
  preparing: "Gathering LAN candidates…",
  waiting: "Invitation ready; waiting for the other player",
  connecting: "Connecting…",
  connected: "Connected. Open the game's Network lobby on both clients.",
  failed: "The peer connection failed. Start a new invitation and try again on the same LAN.",
};

/** Manual offer/answer exchange keeps LAN pairing independent of a hosted signaling service. */
export function LanPanel({ game }: { game: GameHandle }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LanStatus>("idle");
  const [mode, setMode] = useState<"none" | "offer" | "answer">("none");
  const [incoming, setIncoming] = useState("");
  const [outgoing, setOutgoing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bridgeRef = useRef<LanIpXBridge | null>(null);
  const peer = useMemo(
    () => new LanPeer(setStatus, (packet) => bridgeRef.current?.receive(packet)),
    [],
  );
  const bridge = useMemo(
    () =>
      new LanIpXBridge(
        game.exports,
        () => game.memory().HEAPU8,
        peer,
        (message) => setError(message),
      ),
    [game, peer],
  );
  bridgeRef.current = bridge;

  useEffect(() => {
    bridgeRef.current = bridge;
    bridge.start();
    const stop = () => {
      bridgeRef.current = null;
      bridge.stop();
      peer.close();
    };
    const check = () => {
      const phase = gameStore.getSnapshot().phase;
      if (phase === "exited" || phase === "crashed") stop();
    };
    const unsubscribe = gameStore.subscribe(check);
    check();
    return () => {
      unsubscribe();
      stop();
    };
  }, [bridge, peer]);

  const createInvitation = async () => {
    setBusy(true);
    setError("");
    setIncoming("");
    try {
      setOutgoing(await peer.createOffer());
      setMode("offer");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const joinInvitation = async () => {
    setBusy(true);
    setError("");
    try {
      setOutgoing(await peer.answerOffer(incoming.trim()));
      setMode("answer");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const connectWithAnswer = async () => {
    setBusy(true);
    setError("");
    try {
      await peer.acceptAnswer(incoming.trim());
      setIncoming("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const copyOutgoing = async () => {
    try {
      await navigator.clipboard.writeText(outgoing);
    } catch {
      setError("Clipboard access is unavailable. Select and copy the text instead.");
    }
  };

  const pasteFromClipboard = async () => {
    setError("");
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setError("The clipboard is empty. Copy the invitation or answer first.");
        return;
      }
      setIncoming(text);
    } catch {
      setError(
        "Clipboard access was blocked. Click the field and press Ctrl+V, or paste the text manually.",
      );
    }
  };

  const disconnect = () => {
    peer.close();
    setMode("none");
    setIncoming("");
    setOutgoing("");
    setError("");
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <Button className={styles.trigger} size="1" variant="soft">
          LAN
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="680px">
        <Dialog.Title>LAN multiplayer</Dialog.Title>
        <Dialog.Description mb="3">
          Pair two browser clients on the same local network. No relay or online service is used.
        </Dialog.Description>
        <Flex direction="column" gap="3">
          <Callout.Root>
            <Callout.Text>
              Host: create and copy an invitation. Joiner: paste it, join, then copy and send the
              answer back. Host: paste the answer and connect.
            </Callout.Text>
          </Callout.Root>
          <Text size="2" role="status" aria-live="polite">
            {statusText[status]}
          </Text>
          {error && (
            <Callout.Root color="red" role="alert">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          {outgoing && (
            <div className={styles.field}>
              <Text as="label" htmlFor="lan-outgoing" size="2">
                {mode === "offer" ? "Invitation to send" : "Answer to send"}
              </Text>
              <TextArea
                id="lan-outgoing"
                className={styles.textarea}
                aria-label={mode === "offer" ? "LAN invitation" : "LAN answer"}
                readOnly
                value={outgoing}
                rows={7}
              />
              <Button type="button" variant="soft" onClick={() => void copyOutgoing()}>
                Copy {mode === "offer" ? "invitation" : "answer"}
              </Button>
            </div>
          )}
          {(mode === "none" || mode === "offer") && (
            <div className={styles.field}>
              <Text as="label" htmlFor="lan-incoming" size="2">
                {mode === "offer" ? "Paste the other player's answer" : "Paste an invitation"}
              </Text>
              <TextArea
                id="lan-incoming"
                className={styles.textarea}
                aria-label={mode === "offer" ? "LAN answer to connect" : "LAN invitation to join"}
                value={incoming}
                onChange={(event) => setIncoming(event.target.value)}
                rows={6}
                spellCheck={false}
              />
              <Button type="button" variant="soft" onClick={() => void pasteFromClipboard()}>
                Paste from clipboard
              </Button>
            </div>
          )}
          <Flex justify="between" gap="2" wrap="wrap">
            <Flex gap="2" wrap="wrap">
              <Button disabled={busy} onClick={() => void createInvitation()}>
                Create invitation
              </Button>
              {mode === "none" && (
                <Button disabled={busy || !incoming.trim()} onClick={() => void joinInvitation()}>
                  Join with invitation
                </Button>
              )}
              {mode === "offer" && (
                <Button
                  disabled={busy || !incoming.trim()}
                  onClick={() => void connectWithAnswer()}
                >
                  Connect with answer
                </Button>
              )}
            </Flex>
            <Flex gap="2">
              <Button variant="soft" color="gray" onClick={disconnect}>
                Disconnect
              </Button>
              <Dialog.Close>
                <Button variant="soft">Done</Button>
              </Dialog.Close>
            </Flex>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
