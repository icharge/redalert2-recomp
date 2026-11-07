import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { MapList } from "../game/protocol";
import styles from "./MapSearch.module.css";

/** Where a point of the game's picture is on the page, and how much the picture is scaled. */
export type Place = (x: number, y: number) => { left: number; top: number; scale: number };

const PLAYERS = [2, 3, 4, 5, 6, 7, 8];
/** the row's height on the page, in CSS pixels */
const ROW = 30;

/**
 * The map search: a box over the game's map list (Customize Battle, and the network game's map
 * screen). Words narrow the list to the maps whose names hold them all; Players keeps the maps made
 * for that many. The game does the narrowing (src/web/map_search.c): it sees the shorter list as the
 * whole list, so the map it starts is the one the player picked.
 */
export function MapSearch({
  list,
  place,
  onSearch,
}: {
  list: MapList | null;
  place: Place;
  onSearch: (text: string, players: number, seq: number) => void;
}) {
  const [text, setText] = useState("");
  const [players, setPlayers] = useState(0);
  const [sent, setSent] = useState(0);
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const open = list !== null;
  const send = (nextText: string, nextPlayers: number) => {
    seq.current += 1;
    setSent(seq.current);
    onSearch(nextText, nextPlayers, seq.current);
  };

  // A list that comes up starts unfiltered, whatever was searched the last time it was up.
  useEffect(() => {
    if (!open) return;
    setText("");
    setPlayers(0);
    send("", 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once each time the list comes up
  }, [open]);

  // The picture moves with the window: place the box again.
  const [, setResized] = useState(0);
  useEffect(() => {
    const onResize = () => setResized((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!list) return null;
  const at = place(list.x, list.y);
  const searching = text.trim() !== "" || players > 0;
  const answered = list.seq === sent;
  const status = !searching
    ? null
    : answered && list.matched === 0
      ? "No maps match"
      : answered
        ? `${list.shown} of ${list.total} maps`
        : null;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setText("");
    send("", players);
    input.current?.blur();
  };

  return (
    <div
      role="search"
      aria-label="Map search"
      className={styles.box}
      style={{
        left: `${at.left}px`,
        top: `${at.top - ROW - 4}px`,
        width: `${list.w * at.scale}px`,
      }}
    >
      <div className={styles.row} style={{ height: `${ROW}px` }}>
        <input
          ref={input}
          type="search"
          className={styles.text}
          aria-label="Search maps"
          placeholder="Search maps"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            send(event.target.value, players);
          }}
          onKeyDown={onKeyDown}
        />
        <select
          className={styles.players}
          aria-label="Players"
          value={players}
          onChange={(event) => {
            const next = Number(event.target.value);
            setPlayers(next);
            send(text, next);
          }}
        >
          <option value={0}>Any</option>
          {PLAYERS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {status && (
        <p className={styles.status} role="status">
          {status}
        </p>
      )}
    </div>
  );
}
