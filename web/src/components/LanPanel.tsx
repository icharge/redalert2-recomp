import { Dialog } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GameHandle } from "../game/loader";
import { LanIpXBridge, LanPeer, type LanStatus } from "../game/lan";
import styles from "./LanPanel.module.css";
import { gameStore } from "../game/store";

const BADGE: Record<LanStatus, string> = {
  idle: "NOT CONNECTED",
  preparing: "PREPARING",
  waiting: "WAITING",
  connecting: "CONNECTING",
  connected: "CONNECTED",
  failed: "FAILED: START AGAIN",
};

/** Manual offer/answer exchange keeps LAN pairing independent of a hosted signaling service. */
export function LanPanel({ game, className }: { game: GameHandle; className?: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LanStatus>("idle");
  const [mode, setMode] = useState<"none" | "offer" | "answer">("none");
  const [role, setRole] = useState<"host" | "join">("host");
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

  const hosting = role === "host";
  const connected = status === "connected";
  // which of the three steps the player is on: 0, 1 or 2
  const current = connected ? 2 : outgoing ? 1 : 0;
  const badge =
    status === "waiting" ? (hosting ? "WAITING FOR ANSWER" : "SENDING ANSWER") : BADGE[status];

  const outgoingBox = (label: string) => (
    <div className={styles.box}>
      <textarea
        className={styles.code}
        aria-label={label}
        readOnly
        value={outgoing}
        placeholder={hosting ? "Press CREATE" : "Your answer shows here"}
        rows={3}
      />
      {hosting && !outgoing ? (
        <button
          type="button"
          className={styles.boxButton}
          disabled={busy}
          onClick={() => void createInvitation()}
        >
          CREATE
        </button>
      ) : (
        <button
          type="button"
          className={styles.boxButton}
          disabled={!outgoing}
          onClick={() => void copyOutgoing()}
        >
          COPY
        </button>
      )}
    </div>
  );
  const incomingBox = (label: string) => (
    <div className={styles.box}>
      <textarea
        className={styles.code}
        aria-label={label}
        value={incoming}
        placeholder="Paste here"
        onChange={(event) => setIncoming(event.target.value)}
        rows={3}
        spellCheck={false}
      />
      <button type="button" className={styles.boxButton} onClick={() => void pasteFromClipboard()}>
        PASTE
      </button>
    </div>
  );

  const steps = hosting
    ? [
        {
          text: "Copy the invitation and send it to your friend",
          box: outgoingBox("LAN invitation"),
        },
        { text: "Paste the answer they send back", box: incomingBox("LAN answer to connect") },
        { text: "Connect, then open Network in the game", box: null },
      ]
    : [
        { text: "Paste the invitation from the host", box: incomingBox("LAN invitation to join") },
        { text: "Copy your answer and send it back", box: outgoingBox("LAN answer") },
        { text: "Wait for the host, then open Network in the game", box: null },
      ];

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <button type="button" className={className ?? styles.trigger}>
          <span className={styles.dot} data-status={status} aria-hidden="true" />
          LAN
        </button>
      </Dialog.Trigger>
      <Dialog.Content className={styles.panel} aria-describedby={undefined}>
        <div className={styles.head}>
          <Dialog.Title className={styles.title}>LAN GAME</Dialog.Title>
          <span className={styles.badge} data-status={status} role="status" aria-live="polite">
            <span className={styles.dot} data-status={status} aria-hidden="true" />
            {badge}
          </span>
        </div>
        <div role="radiogroup" aria-label="Role" className={styles.roles}>
          {(["host", "join"] as const).map((each) => (
            <button
              key={each}
              type="button"
              role="radio"
              aria-checked={role === each}
              className={styles.role}
              disabled={mode !== "none" && role !== each}
              onClick={() => setRole(each)}
            >
              {each.toUpperCase()}
            </button>
          ))}
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <li
              key={step.text}
              aria-current={index === current ? "step" : undefined}
              data-state={index < current ? "done" : index === current ? "current" : "next"}
            >
              <span className={styles.number} aria-hidden={index < current || undefined}>
                {index < current ? "✓" : index + 1}
              </span>
              <div className={styles.stepBody}>
                <span>{step.text}</span>
                {step.box}
              </div>
            </li>
          ))}
        </ol>
        <div className={styles.actions}>
          {hosting ? (
            <button
              type="button"
              className={styles.primary}
              disabled={busy || mode !== "offer" || !incoming.trim()}
              onClick={() => void connectWithAnswer()}
            >
              CONNECT
            </button>
          ) : (
            <button
              type="button"
              className={styles.primary}
              disabled={busy || mode !== "none" || !incoming.trim()}
              onClick={() => void joinInvitation()}
            >
              JOIN
            </button>
          )}
          {status !== "idle" && (
            <button type="button" className={styles.secondary} onClick={disconnect}>
              DISCONNECT
            </button>
          )}
          <Dialog.Close>
            <button type="button" className={styles.secondary}>
              CLOSE
            </button>
          </Dialog.Close>
        </div>
        <p className={styles.note}>Same network only. Nothing goes through a server.</p>
      </Dialog.Content>
    </Dialog.Root>
  );
}
