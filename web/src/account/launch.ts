import { ticketEdition } from "../game/wol";
import type { GameId } from "../storage/install";
import { AccountError, describeAccountError, OfflineError } from "./api";
import type { AccountStore } from "./store";

/**
 * What PLAY does about online play:
 * - `go`: open the game now, with `ticket` in the address when there is one. No ticket means the
 *   game's own login dialog, as without the launcher.
 * - `refused`: stay on the launcher and show `message`. `skippable` says the player can press PLAY
 *   again to play without a ticket (a refusal of their member, not of a name they chose).
 */
export type LaunchPlan =
  { kind: "go"; ticket?: string } | { kind: "refused"; message: string; skippable: boolean };

/**
 * Mint the ticket for a PLAY, at the moment of PLAY (a ticket lives 60 s and is single use).
 * A member with a game account gets a launch ticket; a guest who gave a name gets a guest ticket;
 * everyone else, an unreachable server and a server with guests off play with no ticket.
 */
export async function prepareLaunch(
  store: AccountStore,
  game: GameId,
  guestName: string,
): Promise<LaunchPlan> {
  if (store.getState().status === "unknown") await store.restore();
  const state = store.getState();
  const edition = ticketEdition(game);
  try {
    if (state.status === "member") {
      const gameAccount = state.gameAccounts[0];
      if (!gameAccount) return { kind: "go" };
      const result = await store.launchTicket(gameAccount.username, edition);
      return { kind: "go", ticket: result.ticket };
    }
    const nick = guestName.trim();
    if (state.status === "offline" || !nick) return { kind: "go" };
    const result = await store.guestTicket(nick, edition);
    return { kind: "go", ticket: result.ticket };
  } catch (error) {
    if (error instanceof OfflineError) return { kind: "go" };
    if (error instanceof AccountError && error.code === "guests_disabled") return { kind: "go" };
    return {
      kind: "refused",
      message: describeAccountError(error),
      skippable: state.status === "member",
    };
  }
}
