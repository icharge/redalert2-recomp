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
  connected: "Connection ready. Continue to the game's LAN lobby.",
  failed: "The peer connection failed. Start a new invitation and try again on the same LAN.",
};
type Mode = "choose" | "join" | "offer" | "answer";
type PanelProps = {
  game: GameHandle;
  request?: number | null;
  activeRequest?: number | null;
  onContinue?(request: number): boolean | void;
  onCancel?(request: number): boolean | void;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  showTrigger?: boolean;
  /** the trigger's class: the game tray styles it as one of its items */
  className?: string;
  onCloseAutoFocus?(event: Event): void;
};

/** Owns the transport for one native LAN session; request controls only the modal prompt. */
export function LanPanel({
  game,
  request = null,
  activeRequest = null,
  onContinue,
  onCancel,
  open: openProp,
  onOpenChange,
  showTrigger = true,
  className,
  onCloseAutoFocus,
}: PanelProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const modalOpen = request !== null || (openProp ?? ownOpen);
  const setOpen = (next: boolean) => {
    if (request !== null && !next) {
      cancelRequest();
      return;
    }
    if (openProp === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [status, setStatus] = useState<LanStatus>("idle");
  const [mode, setMode] = useState<Mode>("choose");
  const [incoming, setIncoming] = useState("");
  const [outgoing, setOutgoing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [acknowledging, setAcknowledging] = useState(false);
  const latestRequest = useRef(request);
  const operationGeneration = useRef(0);
  const mounted = useRef(false);
  const everConnected = useRef(false);
  const activeRequestRef = useRef(activeRequest);
  activeRequestRef.current = activeRequest;
  const attemptRequestRef = useRef<number | null>(null);
  const sessionRequest = activeRequest ?? request;
  const sessionActive = sessionRequest !== null;
  const recoveryOpenRef = useRef({ openProp, onOpenChange });
  recoveryOpenRef.current = { openProp, onOpenChange };
  if (latestRequest.current !== request) {
    latestRequest.current = request;
    operationGeneration.current++;
  }
  const cancelSent = useRef<number | null>(null);
  const acknowledgementInFlight = useRef(false);
  const previousActiveRequest = useRef<number | null>(activeRequest);
  const bridgeRef = useRef<LanIpXBridge | null>(null);
  const peer = useMemo(
    () =>
      new LanPeer(
        (nextStatus) => {
          if (!mounted.current) return;
          const currentSession = latestRequest.current ?? activeRequestRef.current;
          if (attemptRequestRef.current !== currentSession) return;
          setStatus(nextStatus);
          if (nextStatus === "preparing") everConnected.current = false;
          else if (nextStatus === "connected") everConnected.current = true;
          else if (
            everConnected.current &&
            activeRequestRef.current !== null &&
            (nextStatus === "waiting" || nextStatus === "failed")
          ) {
            setError("The LAN connection was lost. Leave and re-enter Network to pair again.");
            if (recoveryOpenRef.current.openProp === undefined) setOwnOpen(true);
            recoveryOpenRef.current.onOpenChange?.(true);
          } else if (nextStatus === "failed" && latestRequest.current !== null) {
            setError("The pending LAN connection failed. Retry pairing or choose Disconnect.");
          }
        },
        (packet) => bridgeRef.current?.receive(packet),
      ),
    [],
  );
  const bridge = useMemo(
    () => new LanIpXBridge(game.exports, () => game.memory().HEAPU8, peer, setError),
    [game, peer],
  );
  bridgeRef.current = bridge;

  useEffect(() => {
    mounted.current = true;
    bridgeRef.current = sessionActive ? bridge : null;
    if (sessionActive) bridge.start();
    else bridge.stop();
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
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
      mounted.current = false;
      unsubscribe();
      stop();
    };
  }, [bridge, peer, sessionActive, sessionRequest]);

  const startBridge = () => {
    bridgeRef.current = bridge;
    bridge.start();
  };

  const beginOperation = () => {
    const generation = ++operationGeneration.current;
    const requestAtStart = request;
    return () =>
      mounted.current && generation === operationGeneration.current && request === requestAtStart;
  };

  useEffect(() => {
    if (request === null) {
      cancelSent.current = null;
      acknowledgementInFlight.current = false;
      setAcknowledging(false);
      return;
    }
    peer.close();
    attemptRequestRef.current = null;
    setStatus("idle");
    setBusy(false);
    setMode("choose");
    setIncoming("");
    setOutgoing("");
    setError("");
    setAcknowledging(false);
    acknowledgementInFlight.current = false;
    cancelSent.current = null;
  }, [request, peer]);

  const createInvitation = async () => {
    startBridge();
    attemptRequestRef.current = request;
    const current = beginOperation();
    setBusy(true);
    setError("");
    setIncoming("");
    try {
      const result = await peer.createOffer();
      if (!current()) return;
      setOutgoing(result);
      setMode("offer");
    } catch (reason) {
      if (!current()) return;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (current()) setBusy(false);
    }
  };
  const joinInvitation = async () => {
    startBridge();
    attemptRequestRef.current = request;
    const current = beginOperation();
    setBusy(true);
    setError("");
    try {
      const result = await peer.answerOffer(incoming.trim());
      if (!current()) return;
      setOutgoing(result);
      setMode("answer");
    } catch (reason) {
      if (!current()) return;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (current()) setBusy(false);
    }
  };
  const connectWithAnswer = async () => {
    startBridge();
    attemptRequestRef.current = request;
    const current = beginOperation();
    setBusy(true);
    setError("");
    try {
      await peer.acceptAnswer(incoming.trim());
      if (!current()) return;
      setIncoming("");
    } catch (reason) {
      if (!current()) return;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (current()) setBusy(false);
    }
  };
  const copyOutgoing = async () => {
    const current = beginOperation();
    try {
      await navigator.clipboard.writeText(outgoing);
    } catch {
      if (current()) setError("Clipboard access is unavailable. Select and copy the text instead.");
    }
  };
  const pasteFromClipboard = async () => {
    const current = beginOperation();
    setError("");
    try {
      const text = await navigator.clipboard.readText();
      if (!current()) return;
      if (!text.trim()) {
        setError("The clipboard is empty. Copy the invitation or answer first.");
        return;
      }
      setIncoming(text);
    } catch {
      if (!current()) return;
      setError(
        "Clipboard access was blocked. Click the field and press Ctrl+V, or paste the text manually.",
      );
    }
  };
  const acknowledge = (connected: boolean) => {
    if (request === null || acknowledgementInFlight.current) return;
    acknowledgementInFlight.current = true;
    setAcknowledging(true);
    const accepted = connected ? onContinue?.(request) : onCancel?.(request);
    if (accepted === false) {
      if (!connected) cancelSent.current = null;
      acknowledgementInFlight.current = false;
      setAcknowledging(false);
      setError("The game's LAN prompt is no longer open. The prompt remains available.");
      return;
    }
    if (!connected) cancelSent.current = request;
    if (openProp === undefined) setOwnOpen(false);
    onOpenChange?.(false);
  };
  const cancelRequest = () => {
    if (request === null || cancelSent.current === request) return;
    acknowledge(false);
  };
  const disconnect = () => {
    operationGeneration.current++;
    attemptRequestRef.current = request;
    bridgeRef.current = null;
    bridge.stop();
    peer.close();
    setMode("choose");
    setIncoming("");
    setOutgoing("");
    setError("");
  };
  const retry = () => {
    operationGeneration.current++;
    attemptRequestRef.current = request;
    bridgeRef.current = null;
    bridge.stop();
    peer.close();
    if (outgoing) setMode("choose");
    setOutgoing("");
    setError("");
    setBusy(false);
  };
  useEffect(() => {
    if (previousActiveRequest.current !== null && activeRequest !== previousActiveRequest.current) {
      operationGeneration.current++;
      peer.close();
      attemptRequestRef.current = null;
      setStatus("idle");
      setMode("choose");
      setIncoming("");
      setOutgoing("");
      setError("");
    }
    previousActiveRequest.current = activeRequest;
  }, [activeRequest, peer]);

  return (
    <Dialog.Root open={modalOpen} onOpenChange={setOpen}>
      {showTrigger && (
        <Dialog.Trigger>
          <button type="button" className={className ?? styles.trigger}>
            <span className={styles.dot} data-status={status} aria-hidden="true" />
            LAN
          </button>
        </Dialog.Trigger>
      )}
      <Dialog.Content
        maxWidth="680px"
        onCloseAutoFocus={onCloseAutoFocus}
        onPointerDownOutside={(event) => {
          if (request !== null) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (request !== null) {
            event.preventDefault();
            cancelRequest();
          }
        }}
      >
        <Dialog.Title>LAN multiplayer</Dialog.Title>
        <Dialog.Description mb="3">
          Pair two browser clients on the same local network. No relay or online service is used.
        </Dialog.Description>
        <Flex direction="column" gap="3">
          {mode === "choose" && request !== null ? (
            <Flex direction="column" gap="2">
              <Button disabled={busy || acknowledging} onClick={() => void createInvitation()}>
                Create WebRTC session
              </Button>
              <Button disabled={busy || acknowledging} onClick={() => setMode("join")}>
                Join WebRTC session
              </Button>
              <Button
                variant="soft"
                color="gray"
                disabled={busy || acknowledging}
                onClick={cancelRequest}
              >
                Cancel
              </Button>
            </Flex>
          ) : mode === "choose" ? (
            <Callout.Root>
              <Callout.Text>Choose Network in the game to start LAN pairing.</Callout.Text>
            </Callout.Root>
          ) : null}
          {mode === "choose" && request === null && (
            <Dialog.Close>
              <Button variant="soft">Done</Button>
            </Dialog.Close>
          )}
          {mode !== "choose" && (
            <>
              <Callout.Root>
                <Callout.Text>
                  Host: create and copy an invitation. Joiner: paste it, join, then copy and send
                  the answer back. Host: paste the answer and connect.
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
              {error && request !== null && (
                <Button type="button" variant="soft" onClick={retry}>
                  Retry
                </Button>
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
              {(mode === "join" || mode === "offer") && (
                <div className={styles.field}>
                  <Text as="label" htmlFor="lan-incoming" size="2">
                    {mode === "offer" ? "Paste the other player's answer" : "Paste an invitation"}
                  </Text>
                  <TextArea
                    id="lan-incoming"
                    className={styles.textarea}
                    aria-label={
                      mode === "offer" ? "LAN answer to connect" : "LAN invitation to join"
                    }
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
                  {mode === "join" && (
                    <Button
                      disabled={busy || !incoming.trim()}
                      onClick={() => void joinInvitation()}
                    >
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
                  {request !== null && (
                    <Button
                      disabled={
                        busy ||
                        acknowledging ||
                        status !== "connected" ||
                        attemptRequestRef.current !== request
                      }
                      onClick={() => acknowledge(true)}
                    >
                      Continue to LAN lobby
                    </Button>
                  )}
                </Flex>
                <Flex gap="2">
                  <Button variant="soft" color="gray" disabled={busy} onClick={disconnect}>
                    Disconnect
                  </Button>
                  {request !== null ? (
                    <Button variant="soft" onClick={cancelRequest}>
                      Cancel
                    </Button>
                  ) : (
                    <Dialog.Close>
                      <Button variant="soft">Done</Button>
                    </Dialog.Close>
                  )}
                </Flex>
              </Flex>
            </>
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
