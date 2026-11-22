import { useSyncExternalStore } from "react";
import {
  AccountClient,
  AccountError,
  OfflineError,
  SESSION_ENDED,
  describeAccountError,
  type GameAccount,
  type GameAccountPasswordResult,
  type GameAccountResult,
  type Member,
  type TicketEdition,
  type TicketResult,
} from "./api";

/**
 * What the launcher knows about who is playing.
 * - `unknown`: the first refresh is still running.
 * - `guest`: no member signed in (no cookie, a refused one, or signed out).
 * - `offline`: the server could not be reached, or answered with something other than "this session
 *   is over" (rate limited, an origin it refuses, a server error); the cookie may still be good, so
 *   the launcher works as a guest and offers a retry.
 * - `member`: signed in.
 */
export type AccountState =
  | { status: "unknown" | "guest" | "offline"; notice?: string }
  | {
      status: "member";
      member: Member;
      gameAccounts: GameAccount[];
      maxGameAccounts: number;
    };

const GUEST: AccountState = { status: "guest" };

function memberState(session: {
  member: Member;
  gameAccounts: GameAccount[];
  maxGameAccounts: number;
}): AccountState {
  return {
    status: "member",
    member: session.member,
    gameAccounts: session.gameAccounts,
    maxGameAccounts: session.maxGameAccounts,
  };
}

/** The member's state, the actions that change it, and a subscription for React. */
export class AccountStore {
  private state: AccountState = { status: "unknown" };
  private readonly listeners = new Set<() => void>();
  private restoring: Promise<void> | null = null;

  constructor(readonly client: AccountClient) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): AccountState => this.state;

  private set(state: AccountState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  /** A refused session (an `unauthorized` that survived the refresh) ends the member's state. */
  private ended(error: unknown): void {
    if (error instanceof AccountError && SESSION_ENDED.has(error.code)) {
      this.set({
        status: "guest",
        notice:
          error.code === "refresh_reused"
            ? "You were signed out on every device. Sign in again."
            : "Your session ended. Sign in again.",
      });
    }
  }

  /**
   * On page load: one refresh restores the session. Only an answer that ends the session (no or a
   * refused cookie, a suspended member) is a guest; anything else is offline, to retry.
   */
  restore(): Promise<void> {
    this.restoring ??= this.client.refresh().then(
      (session) => this.set(memberState(session)),
      (error: unknown) => {
        if (error instanceof OfflineError) this.set({ status: "offline" });
        else if (error instanceof AccountError && error.code === "refresh_reused")
          this.set({
            status: "guest",
            notice: "You were signed out on every device. Sign in again.",
          });
        else if (error instanceof AccountError && SESSION_ENDED.has(error.code)) this.set(GUEST);
        else this.set({ status: "offline", notice: describeAccountError(error) });
      },
    );
    return this.restoring;
  }

  /** Try the server again (after "offline"). */
  retry(): Promise<void> {
    this.restoring = null;
    this.set({ status: "unknown" });
    return this.restore();
  }

  async signIn(login: string, password: string): Promise<void> {
    this.set(memberState(await this.client.login(login, password)));
  }

  async register(login: string, password: string, email?: string): Promise<void> {
    this.set(memberState(await this.client.register(login, password, email)));
  }

  /** Create or claim a game account; resolves with what happened. */
  async addGameAccount(username: string, password = ""): Promise<GameAccountResult> {
    try {
      const result = await this.client.addGameAccount(username, password);
      const current = this.state;
      if (current.status === "member") {
        this.set({
          ...current,
          gameAccounts: result.gameAccounts,
          maxGameAccounts: result.maxGameAccounts,
        });
      }
      return result;
    } catch (error) {
      this.ended(error);
      throw error;
    }
  }

  /** Set or change the game password of one of the member's game accounts. */
  async setGameAccountPassword(nick: string, password: string): Promise<GameAccountPasswordResult> {
    try {
      const result = await this.client.setGameAccountPassword(nick, password);
      const current = this.state;
      if (current.status === "member") {
        this.set({
          ...current,
          gameAccounts: result.gameAccounts,
          maxGameAccounts: result.maxGameAccounts,
        });
      }
      return result;
    } catch (error) {
      this.ended(error);
      throw error;
    }
  }

  /** A launch ticket for the member's game account; a refused session ends the member's state. */
  async launchTicket(gameAccount: string, edition: TicketEdition): Promise<TicketResult> {
    try {
      return await this.client.launchTicket(gameAccount, edition);
    } catch (error) {
      this.ended(error);
      throw error;
    }
  }

  /** A guest ticket for `nick`. */
  guestTicket(nick: string, edition: TicketEdition): Promise<TicketResult> {
    return this.client.guestTicket(nick, edition);
  }

  /** End this browser's session. The page is a guest even when the server cannot be reached. */
  async signOut(): Promise<void> {
    try {
      await this.client.logout();
    } finally {
      this.set(GUEST);
    }
  }

  async signOutEverywhere(): Promise<void> {
    try {
      await this.client.logoutEverywhere();
    } catch (error) {
      this.ended(error);
      throw error;
    }
    this.set(GUEST);
  }
}

/** The launcher's one store. `main.tsx` restores it on load; tests build their own. */
export const account = new AccountStore(new AccountClient());

export function useAccount(store: AccountStore = account): AccountState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
