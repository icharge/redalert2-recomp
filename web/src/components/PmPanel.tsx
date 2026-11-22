import { ChatBubbleIcon, Cross2Icon } from "@radix-ui/react-icons";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { PmStore } from "../game/pm";
import { FriendsTab } from "./FriendsTab";
import { PlayerProfile } from "./PlayerProfile";
import styles from "./PmPanel.module.css";

/** HH:MM in the viewer's own time. */
function clock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** The tray's button: shown while online, with the number of unread private messages. */
export function PmTrayButton({
  pm,
  open,
  onToggle,
  className,
}: {
  pm: PmStore;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { online, unread } = useSyncExternalStore(pm.subscribe, pm.getSnapshot);
  if (!online) return null;
  return (
    <button
      type="button"
      className={className}
      aria-pressed={open}
      aria-label={unread > 0 ? `Messages, ${unread} unread` : "Messages"}
      onClick={onToggle}
    >
      <ChatBubbleIcon aria-hidden="true" />
      MESSAGES
      {unread > 0 && (
        <span className={styles.badge} aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

/**
 * Private messages, a panel over the game's corner. It does not stop the game and does not
 * take the pointer from the canvas outside its own box; while focus is inside it, its keys stay
 * out of the game (the game's key handler also skips text fields).
 */
export function PmPanel({
  pm,
  onClose,
  sku,
  focus,
  onJoin,
}: {
  pm: PmStore;
  onClose: () => void;
  /** join a game room (a friend's, or an invitation's): the lobby's Join, through the game */
  onJoin?: (room: string) => void;
  /** open on this player (the lobby's player menu): their conversation, or their profile; seq counts the asks */
  focus?: { seq: number; name?: string; profile?: boolean; tab?: "messages" | "friends" } | null;
  /** the game's ladder (LADDER_SKU): profiles are shown for it; without it there are none */
  sku?: number;
}) {
  const snapshot = useSyncExternalStore(pm.subscribe, pm.getSnapshot);
  // opening shows the conversation with something new, else the latest one; it then stays put
  const [picked, setPicked] = useState<string | null>(() => {
    const now = pm.getSnapshot().conversations;
    return (now.find((c) => c.unread > 0) ?? now[0])?.nick.toLowerCase() ?? null;
  });
  const [draft, setDraft] = useState("");
  const [recipient, setRecipient] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"messages" | "friends">("messages");
  /** whose profile is on show (over either tab), or nobody */
  const [profile, setProfile] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLDivElement>(null);

  const { conversations } = snapshot;
  const selectedKey =
    picked && conversations.some((c) => c.nick.toLowerCase() === picked)
      ? picked
      : conversations[0]?.nick.toLowerCase();
  const selected = conversations.find((c) => c.nick.toLowerCase() === selectedKey);
  const count = selected?.messages.length ?? 0;
  const unreadHere = selected?.unread ?? 0;

  // a first conversation that appears while the panel is open stays selected
  useEffect(() => {
    if (picked === null && selectedKey) setPicked(selectedKey);
  }, [picked, selectedKey]);
  // what is on screen is read
  useEffect(() => {
    if (selected && unreadHere > 0) pm.markRead(selected.nick);
  }, [pm, selected, unreadHere]);
  useEffect(() => {
    const box = thread.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [selectedKey, count]);
  useEffect(() => {
    input.current?.focus();
  }, [selectedKey]);

  const pick = (nick: string) => {
    setPicked(nick.toLowerCase());
    setError("");
  };

  const focusSeq = focus?.seq;
  useEffect(() => {
    if (!focus) return;
    if (!focus.name) {
      // a tab on its own (the game's Page and Buddy List buttons open FRIENDS)
      setTab(focus.tab ?? "messages");
      setProfile(null);
    } else if (focus.profile) setProfile(focus.name);
    else {
      pm.open(focus.name);
      setPicked(focus.name.toLowerCase());
      setTab("messages");
      setProfile(null);
    }
    // a new ask (seq), not a new object, moves the panel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const result = pm.send(selected.nick, draft);
    if (result.ok) {
      setDraft("");
      setError("");
    } else setError(result.reason);
  };

  const startConversation = (event: FormEvent) => {
    event.preventDefault();
    const result = pm.open(recipient);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError("");
    setRecipient("");
    pick(recipient.trim());
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // the panel owns the keyboard while focus is in it: nothing here reaches the game
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <section
      className={styles.panel}
      aria-label="Private messages"
      onKeyDown={onKeyDown}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <header className={styles.head}>
        <div className={styles.tabs} role="tablist" aria-label="Messages and friends">
          {(["messages", "friends"] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              className={styles.tab}
              aria-selected={tab === name && !profile}
              onClick={() => {
                setTab(name);
                setProfile(null);
              }}
            >
              {name.toUpperCase()}
            </button>
          ))}
        </div>
        {!snapshot.online && <span className={styles.offline}>NOT CONNECTED</span>}
        <button
          type="button"
          className={styles.close}
          aria-label="Close messages"
          onClick={onClose}
        >
          <Cross2Icon aria-hidden="true" />
        </button>
      </header>
      {profile && sku !== undefined ? (
        <div className={styles.profileView}>
          <button type="button" className={styles.back} onClick={() => setProfile(null)}>
            ← BACK
          </button>
          <PlayerProfile name={profile} sku={sku} />
        </div>
      ) : tab === "friends" ? (
        <FriendsTab
          nick={snapshot.nick}
          onMessage={(name) => {
            pm.open(name);
            pick(name);
            setTab("messages");
          }}
          onProfile={(name) => setProfile(name)}
          room={snapshot.room}
          onJoin={onJoin}
          onInvite={(name) => {
            const result = pm.sendInvite(name);
            pick(name);
            setTab("messages");
            setError(result.ok ? "" : result.reason);
          }}
        />
      ) : (
        <div className={styles.body}>
          <nav className={styles.side} aria-label="Conversations">
            <form className={styles.newMessage} onSubmit={startConversation}>
              <input
                className={styles.field}
                aria-label="New message to"
                placeholder="Nick"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              />
              <button type="submit" className={styles.small} disabled={!recipient.trim()}>
                NEW
              </button>
            </form>
            <ul className={styles.list}>
              {conversations.map((conversation) => {
                const key = conversation.nick.toLowerCase();
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className={styles.person}
                      aria-current={key === selectedKey || undefined}
                      onClick={() => pick(conversation.nick)}
                    >
                      <span className={styles.name} dir="auto">
                        {conversation.nick}
                      </span>
                      {conversation.unread > 0 && (
                        <span className={styles.badge} aria-label={`${conversation.unread} unread`}>
                          {conversation.unread}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className={styles.main}>
            {selected ? (
              <>
                {sku !== undefined && (
                  <div className={styles.with}>
                    <span dir="auto">{selected.nick}</span>
                    <button
                      type="button"
                      className={styles.small}
                      onClick={() => setProfile(selected.nick)}
                    >
                      PROFILE
                    </button>
                  </div>
                )}
                <div
                  ref={thread}
                  className={styles.thread}
                  role="log"
                  aria-label={`Conversation with ${selected.nick}`}
                >
                  {selected.messages.length === 0 && (
                    <p className={styles.empty}>Say something to {selected.nick}.</p>
                  )}
                  {selected.messages.map((message, index) => (
                    <p key={index} className={styles.line} data-from={message.from}>
                      <time className={styles.time}>{clock(message.at)}</time>
                      <span className={styles.who}>
                        {message.from === "me" ? "You" : selected.nick}
                      </span>
                      <span className={styles.text} dir="auto">
                        {message.text}
                        {message.invite && message.from === "them" && onJoin && (
                          <button
                            type="button"
                            className={styles.small}
                            onClick={() => onJoin(message.invite!)}
                          >
                            JOIN
                          </button>
                        )}
                      </span>
                    </p>
                  ))}
                </div>
                <form className={styles.compose} onSubmit={submit}>
                  <input
                    ref={input}
                    className={styles.field}
                    aria-label={`Message to ${selected.nick}`}
                    placeholder="Write a message"
                    autoComplete="off"
                    spellCheck={false}
                    enterKeyHint="send"
                    value={draft}
                    disabled={!snapshot.online}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <button
                    type="submit"
                    className={styles.send}
                    disabled={!snapshot.online || !draft.trim()}
                  >
                    SEND
                  </button>
                </form>
              </>
            ) : (
              <p className={styles.empty}>
                No messages yet. Type a nick and press NEW to start one.
              </p>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
