import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { account, useAccount, type AccountStore } from "../../account/store";
import { KeyArt } from "../../components/KeyArt";
import {
  CLAN_MAX_MEMBERS,
  ClanClient,
  NAME_MAX,
  NAME_MIN,
  TAG_MAX,
  TAG_MIN,
  describeClanError,
  nameProblem,
  tagProblem,
  type ClanDetail,
  type ClanMember,
  type ClanRole,
  type ClanSummary,
  type Invite,
  type MemberAction,
  type MyClan,
} from "../../clan/api";
import type { GameId } from "../../storage/install";
import type { GameRecord } from "../../storage/manifest";
import c from "./ClanScreen.module.css";
import ladder from "./LadderScreen.module.css";
import page from "./Page.module.css";

/** A search page is this many clans (the server allows up to 50). */
const PAGE_SIZE = 20;

type Loader<T> = (signal: AbortSignal) => Promise<T>;
type Load<T> =
  { status: "loading" } | { status: "error"; error: unknown } | { status: "ready"; data: T };

/**
 * Runs `load` when its identity changes and gives the answer for the current `key` only. `reload`
 * runs it again and keeps what is shown until the new answer arrives; `retry` shows "loading"
 * again. `null` runs nothing.
 */
function useFetched<T>(load: Loader<T> | null, key: string) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ key: string; value: Load<T> } | null>(null);
  useEffect(() => {
    if (!load) return;
    const controller = new AbortController();
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ key, value: { status: "ready", data } });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ key, value: { status: "error", error } });
      },
    );
    return () => controller.abort();
  }, [load, key, tick]);
  const value: Load<T> | null = !load
    ? null
    : state?.key === key
      ? state.value
      : { status: "loading" };
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const retry = useCallback(() => {
    setState(null);
    setTick((n) => n + 1);
  }, []);
  return { value, reload, retry };
}

/** One change at a time: `run` shows the server's refusal and lets `then` refresh what is on screen. */
function useAction(then: () => void) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const run = useCallback(
    async (change: () => Promise<unknown>) => {
      setBusy(true);
      setFailure(null);
      try {
        await change();
        then();
      } catch (error) {
        setFailure(describeClanError(error));
        // the clan may have changed under us (a kick, a disband): show what is true now
        then();
      } finally {
        setBusy(false);
      }
    },
    [then],
  );
  return { busy, failure, run, clear: () => setFailure(null) };
}

const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const when = (ms: number) => date.format(new Date(ms));

const ROLE_LABEL: Record<ClanRole, string> = {
  owner: "OWNER",
  officer: "OFFICER",
  member: "MEMBER",
};
const ROLE_ORDER: Record<ClanRole, number> = { owner: 0, officer: 1, member: 2 };

function sorted(members: ClanMember[]): ClanMember[] {
  return [...members].sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      a.nick.toLowerCase().localeCompare(b.nick.toLowerCase()),
  );
}

/** What a player of `role` may do to `target` (never to themselves or to the owner). */
function allowed(role: ClanRole, target: ClanMember, me: string): MemberAction[] {
  if (target.role === "owner" || target.nick.toLowerCase() === me.toLowerCase()) return [];
  if (role === "owner") {
    return target.role === "member"
      ? ["promote", "kick", "transfer"]
      : ["demote", "kick", "transfer"];
  }
  return role === "officer" && target.role === "member" ? ["kick"] : [];
}

const ACTION_LABEL: Record<MemberAction, string> = {
  promote: "PROMOTE",
  demote: "DEMOTE",
  kick: "KICK",
  transfer: "TRANSFER",
};
const verb = (action: string) => action[0]!.toUpperCase() + action.slice(1);
/** Changes that are not quietly undone ask first. */
const CONFIRMED: ReadonlySet<MemberAction> = new Set(["kick", "transfer"]);

function Field({
  label,
  hint,
  problem,
  ...input
}: {
  label: string;
  hint?: string;
  problem?: string | null;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={c.field}>
      <label htmlFor={id} className={c.fieldLabel}>
        {label}
      </label>
      <input
        id={id}
        className={c.input}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-invalid={problem ? true : undefined}
        aria-describedby={`${id}-note`}
        {...input}
      />
      <span id={`${id}-note`} className={problem ? c.problem : c.hint}>
        {problem ?? hint}
      </span>
    </div>
  );
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`${ladder.stat} ${wide ? c.wide : ""}`}>
      <span className={ladder.statLabel}>{label}</span>
      <span className={`${ladder.statValue} ${c.value}`}>{value}</span>
    </div>
  );
}

/** The clan's tag, name and facts: the left panel of a clan, yours or a public one. */
function ClanCard({
  clan,
  role,
  children,
}: {
  clan: ClanDetail;
  role?: ClanRole;
  children?: React.ReactNode;
}) {
  return (
    <section className={`${ladder.profile} ${c.card}`} aria-label="Clan">
      <div className={ladder.whoText}>
        <h2 className={c.tag}>[{clan.tag}]</h2>
        <span className={c.clanName}>{clan.name}</span>
        {role && <span className={ladder.title}>{ROLE_LABEL[role]}</span>}
      </div>
      <div className={ladder.stats}>
        <Stat label="MEMBERS" value={`${clan.memberCount} / ${CLAN_MAX_MEMBERS}`} />
        <Stat label="CREATED" value={when(clan.createdAt)} />
      </div>
      {children}
    </section>
  );
}

function MembersTable({
  clan,
  me,
  role,
  pending,
  busy,
  onAsk,
  onCancel,
  onDo,
}: {
  clan: ClanDetail;
  /** the signed-in game name when it is in this clan (it is the clan view of a member) */
  me?: string;
  role?: ClanRole;
  pending?: { action: MemberAction; nick: string } | null;
  busy?: boolean;
  onAsk?: (action: MemberAction, nick: string) => void;
  onCancel?: () => void;
  onDo?: (action: MemberAction, nick: string) => void;
}) {
  const managing = !!role && !!me && role !== "member";
  return (
    <div className={ladder.tableBox}>
      <table className={ladder.table}>
        <caption className={page.visuallyHidden}>
          Members of [{clan.tag}] {clan.name}
        </caption>
        <thead>
          <tr>
            <th scope="col">PLAYER</th>
            <th scope="col">ROLE</th>
            <th scope="col">JOINED</th>
            {managing && <th scope="col">ACTIONS</th>}
          </tr>
        </thead>
        <tbody>
          {sorted(clan.members).map((member) => {
            const mine = !!me && member.nick.toLowerCase() === me.toLowerCase();
            const actions = managing ? allowed(role, member, me) : [];
            const asked = pending && pending.nick === member.nick ? pending.action : null;
            return (
              <tr key={member.nick} data-me={mine || undefined}>
                <td className={c.nickCell}>
                  <span className={ladder.commanderName}>{member.nick}</span>
                  {mine && <span className={page.visuallyHidden}> (you)</span>}
                </td>
                <td>
                  <span className={c.role} data-role={member.role}>
                    {ROLE_LABEL[member.role]}
                  </span>
                </td>
                <td className={ladder.muted}>{when(member.joinedAt)}</td>
                {managing && (
                  <td>
                    {asked ? (
                      <span className={c.ask} role="group" aria-label={`Confirm ${asked}`}>
                        <span>
                          {verb(asked)} {member.nick}?
                        </span>
                        <button
                          type="button"
                          className={`${c.small} ${c.danger}`}
                          disabled={busy}
                          onClick={() => onDo?.(asked, member.nick)}
                        >
                          YES, {ACTION_LABEL[asked]}
                        </button>
                        <button type="button" className={c.small} onClick={onCancel}>
                          CANCEL
                        </button>
                      </span>
                    ) : (
                      <span className={c.rowActions}>
                        {actions.map((action) => (
                          <button
                            key={action}
                            type="button"
                            className={c.small}
                            disabled={busy}
                            aria-label={`${verb(action)} ${member.nick}`}
                            onClick={() =>
                              CONFIRMED.has(action)
                                ? onAsk?.(action, member.nick)
                                : onDo?.(action, member.nick)
                            }
                          >
                            {ACTION_LABEL[action]}
                          </button>
                        ))}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The public clan list: a search box over every clan, newest first. */
function Finder({ client }: { client: ClanClient }) {
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  // the box is searched a moment after the last key
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(text.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [text]);
  const load = useMemo<Loader<{ clans: ClanSummary[]; total: number }>>(
    () => (signal) => client.search(search, PAGE_SIZE, offset, signal),
    [client, search, offset],
  );
  const { value, retry } = useFetched(load, `${search}\n${offset}`);
  const total = value?.status === "ready" ? value.data.total : 0;
  const shown = value?.status === "ready" ? value.data.clans.length : 0;
  return (
    <section className={page.panel} aria-label="Find a clan">
      <h2 className={page.label}>FIND A CLAN</h2>
      <input
        type="search"
        className={c.input}
        aria-label="Search clans by tag or name"
        placeholder="Tag or name"
        autoComplete="off"
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {(!value || value.status === "loading") && (
        <p className={page.status} role="status">
          Searching…
        </p>
      )}
      {value?.status === "error" && (
        <>
          <p className={page.failure} role="alert">
            The clans cannot be reached. Check your connection and try again.
          </p>
          <div>
            <button type="button" className={page.outline} onClick={retry}>
              TRY AGAIN
            </button>
          </div>
        </>
      )}
      {value?.status === "ready" &&
        (shown === 0 ? (
          <p className={page.status}>
            {search ? `No clan matches “${search}”.` : "No clans yet. Found the first one."}
          </p>
        ) : (
          <>
            <div className={ladder.tableBox}>
              <table className={ladder.table}>
                <caption className={page.visuallyHidden}>Clans, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">TAG</th>
                    <th scope="col">NAME</th>
                    <th scope="col" className={ladder.num}>
                      MEMBERS
                    </th>
                    <th scope="col">CREATED</th>
                  </tr>
                </thead>
                <tbody>
                  {value.data.clans.map((clan) => (
                    <tr key={clan.id}>
                      <td className={c.nickCell}>
                        <Link to={`/clan/${encodeURIComponent(clan.tag)}`} className={c.link}>
                          [{clan.tag}]
                        </Link>
                      </td>
                      <td>
                        <span className={ladder.commanderName}>{clan.name}</span>
                      </td>
                      <td className={ladder.num}>{clan.memberCount}</td>
                      <td className={ladder.muted}>{when(clan.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={c.pager}>
              <span className={page.status}>
                {offset + 1}–{offset + shown} of {total}
              </span>
              <button
                type="button"
                className={c.small}
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                PREVIOUS
              </button>
              <button
                type="button"
                className={c.small}
                disabled={offset + shown >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                NEXT
              </button>
            </div>
          </>
        ))}
    </section>
  );
}

function CreateForm({
  client,
  account: nick,
  onDone,
  picker,
}: {
  client: ClanClient;
  account: string | undefined;
  onDone: () => void;
  picker: React.ReactNode;
}) {
  const [tag, setTag] = useState("");
  const [name, setName] = useState("");
  const { busy, failure, run, clear } = useAction(onDone);
  const tagIssue = tagProblem(tag);
  const nameIssue = nameProblem(name);
  const ready = tag !== "" && name !== "" && !tagIssue && !nameIssue;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) void run(() => client.create(tag, name, nick));
  };
  return (
    <section className={ladder.profile} aria-label="Found a clan">
      <h2 className={ladder.label}>FOUND A CLAN</h2>
      {picker}
      <form className={c.form} onSubmit={submit} noValidate>
        <Field
          label="TAG"
          value={tag}
          problem={tagIssue}
          hint={`${TAG_MIN} to ${TAG_MAX} letters, digits, dashes or underscores.`}
          onChange={(event) => {
            setTag(event.target.value);
            clear();
          }}
        />
        <Field
          label="NAME"
          value={name}
          problem={nameIssue}
          hint={`${NAME_MIN} to ${NAME_MAX} characters, plain ASCII.`}
          onChange={(event) => {
            setName(event.target.value);
            clear();
          }}
        />
        {failure && (
          <p className={page.failure} role="alert">
            {failure}
          </p>
        )}
        <button type="submit" className={page.primary} disabled={!ready || busy}>
          {busy ? "CREATING…" : "CREATE CLAN"}
        </button>
      </form>
    </section>
  );
}

function Invitations({
  invites,
  busy,
  failure,
  onAccept,
  onDecline,
}: {
  invites: Load<Invite[]> | null;
  busy: boolean;
  failure: string | null;
  onAccept: (invite: Invite) => void;
  onDecline: (invite: Invite) => void;
}) {
  return (
    <section className={page.panel} aria-label="Invitations">
      <h2 className={page.label}>YOUR INVITATIONS</h2>
      {failure && (
        <p className={page.failure} role="alert">
          {failure}
        </p>
      )}
      {(!invites || invites.status === "loading") && (
        <p className={page.status} role="status">
          Loading your invitations…
        </p>
      )}
      {invites?.status === "error" && (
        <p className={page.failure} role="alert">
          {describeClanError(invites.error)}
        </p>
      )}
      {invites?.status === "ready" &&
        (invites.data.length === 0 ? (
          <p className={page.status}>
            No invitations. The owner or an officer of a clan can invite you by your game name.
          </p>
        ) : (
          <ul className={c.list}>
            {invites.data.map((invite) => (
              <li key={invite.clan.id} className={c.item}>
                <div className={c.itemText}>
                  <span className={c.itemTitle}>
                    <span className={c.tagInline}>[{invite.clan.tag}]</span> {invite.clan.name}
                  </span>
                  <span className={page.status}>
                    Invited by {invite.invitedBy} · expires {when(invite.expiresAt)}
                  </span>
                </div>
                <div className={c.itemActions}>
                  <button
                    type="button"
                    className={c.small}
                    disabled={busy}
                    aria-label={`Accept the invitation to ${invite.clan.tag}`}
                    onClick={() => onAccept(invite)}
                  >
                    ACCEPT
                  </button>
                  <button
                    type="button"
                    className={c.small}
                    disabled={busy}
                    aria-label={`Decline the invitation to ${invite.clan.tag}`}
                    onClick={() => onDecline(invite)}
                  >
                    DECLINE
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function NoClan({
  client,
  nick,
  passAccount,
  reload,
  picker,
}: {
  client: ClanClient;
  nick: string;
  passAccount: string | undefined;
  reload: () => void;
  picker: React.ReactNode;
}) {
  const loadInvites = useMemo<Loader<Invite[]>>(
    () => () => client.invites(passAccount),
    [client, passAccount],
  );
  const invites = useFetched(loadInvites, nick);
  const { busy, failure, run } = useAction(() => {
    invites.reload();
    reload();
  });
  return (
    <>
      <CreateForm client={client} account={passAccount} onDone={reload} picker={picker} />
      <section className={ladder.ladder} aria-label="Clans">
        <div className={ladder.head}>
          <h1 className={page.title}>CLAN</h1>
        </div>
        <Invitations
          invites={invites.value}
          busy={busy}
          failure={failure}
          onAccept={(invite) => void run(() => client.accept(invite.clan.id, passAccount))}
          onDecline={(invite) => void run(() => client.decline(invite.clan.id, passAccount))}
        />
        <Finder client={client} />
      </section>
    </>
  );
}

type Asked = { action: MemberAction | "leave" | "disband"; nick: string } | null;

function InClan({
  client,
  clan,
  nick,
  passAccount,
  reload,
  picker,
}: {
  client: ClanClient;
  clan: MyClan;
  nick: string;
  passAccount: string | undefined;
  reload: () => void;
  picker: React.ReactNode;
}) {
  const changes = useAction(reload);
  const invites = useAction(reload);
  const { failure, run, clear } = changes;
  const busy = changes.busy || invites.busy;
  const [asked, setAsked] = useState<Asked>(null);
  const [invitee, setInvitee] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const role = clan.role;
  const manager = role === "owner" || role === "officer";
  const ask = asked && asked.action !== "leave" && asked.action !== "disband" ? asked : null;
  const askedClan = asked?.action === "leave" || asked?.action === "disband" ? asked.action : null;

  const doMember = (action: MemberAction, target: string) => {
    setAsked(null);
    void run(() => client.member(clan.id, target, action, passAccount));
  };
  const invite = (event: FormEvent) => {
    event.preventDefault();
    const target = invitee.trim();
    if (!target) return;
    setSent(null);
    void invites.run(async () => {
      const result = await client.invite(clan.id, target, passAccount);
      setInvitee("");
      setSent(`Invited ${result.nick}. The invitation lasts until ${when(result.expiresAt)}.`);
    });
  };

  return (
    <>
      <ClanCard clan={clan} role={role}>
        {picker}
        {askedClan ? (
          <div className={c.confirm} role="group" aria-label={`Confirm ${askedClan}`}>
            <p className={page.status}>
              {askedClan === "leave"
                ? `Leave [${clan.tag}]? You can join another clan later.`
                : `Disband [${clan.tag}]? Every member is removed and the clan is gone for good.`}
            </p>
            <div className={ladder.actions}>
              <button
                type="button"
                className={`${page.outline} ${c.danger}`}
                disabled={busy}
                onClick={() => {
                  setAsked(null);
                  void run(() =>
                    askedClan === "leave"
                      ? client.leave(clan.id, passAccount)
                      : client.disband(clan.id, passAccount),
                  );
                }}
              >
                YES, {askedClan.toUpperCase()}
              </button>
              <button type="button" className={page.quiet} onClick={() => setAsked(null)}>
                CANCEL
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={ladder.actions}>
              <button
                type="button"
                className={page.quiet}
                disabled={busy || role === "owner"}
                aria-describedby={role === "owner" ? "leave-reason" : undefined}
                onClick={() => setAsked({ action: "leave", nick })}
              >
                LEAVE
              </button>
              {role === "owner" && (
                <button
                  type="button"
                  className={page.quiet}
                  disabled={busy}
                  onClick={() => setAsked({ action: "disband", nick })}
                >
                  DISBAND
                </button>
              )}
            </div>
            {role === "owner" && (
              <p id="leave-reason" className={page.status}>
                You are the owner, so you cannot leave. Transfer the clan to another member first,
                or disband it.
              </p>
            )}
          </>
        )}
      </ClanCard>

      <section className={ladder.ladder} aria-label="Clan members">
        <div className={ladder.head}>
          <h1 className={page.title}>CLAN</h1>
        </div>
        {failure && (
          <p className={page.failure} role="alert">
            {failure}
          </p>
        )}
        <MembersTable
          clan={clan}
          me={nick}
          role={role}
          pending={ask as { action: MemberAction; nick: string } | null}
          busy={busy}
          onAsk={(action, target) => {
            clear();
            setAsked({ action, nick: target });
          }}
          onCancel={() => setAsked(null)}
          onDo={doMember}
        />
        {manager && (
          <section className={page.panel} aria-label="Invite a player">
            <h2 className={page.label}>INVITE A PLAYER</h2>
            <form className={c.inviteRow} onSubmit={invite}>
              <input
                className={c.input}
                aria-label="Game name to invite"
                placeholder="Game name"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={invitee}
                onChange={(event) => {
                  setInvitee(event.target.value);
                  setSent(null);
                  invites.clear();
                }}
              />
              <button
                type="submit"
                className={page.outline}
                disabled={busy || invitee.trim() === ""}
              >
                INVITE
              </button>
            </form>
            {invites.failure && (
              <p className={page.failure} role="alert">
                {invites.failure}
              </p>
            )}
            {sent && (
              <p className={`${page.status} ${page.ok}`} role="status">
                {sent}
              </p>
            )}
            {clan.invites && clan.invites.length > 0 && (
              <>
                <h3 className={ladder.statLabel}>WAITING FOR AN ANSWER</h3>
                <ul className={c.list}>
                  {clan.invites.map((waiting) => (
                    <li key={waiting.nick} className={c.item}>
                      <span className={c.itemTitle}>{waiting.nick}</span>
                      <span className={page.status}>expires {when(waiting.expiresAt)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </section>
    </>
  );
}

function useClient(store: AccountStore, fetcher?: typeof fetch, baseUrl?: string) {
  return useMemo(
    () =>
      new ClanClient(store.client, {
        ...(fetcher ? { fetch: fetcher } : {}),
        ...(baseUrl ? { baseUrl } : {}),
      }),
    [store, fetcher, baseUrl],
  );
}

type ScreenProps = {
  /** the edition chosen in the rail: its art is the background */
  edition: GameRecord | null;
  store?: AccountStore;
  fetch?: typeof fetch;
  baseUrl?: string;
};

function Backdrop({
  edition,
  children,
}: {
  edition: GameRecord | null;
  children: React.ReactNode;
}) {
  const game: GameId = edition?.id ?? "ra2md";
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <KeyArt edition={game} dim={0.82} />
      <div className={`${page.page} ${ladder.page}`}>{children}</div>
    </div>
  );
}

/** The left panel of someone who cannot manage a clan yet: why, and where to fix it. */
function Notice({
  checking,
  picker,
  children,
}: {
  checking?: boolean;
  picker?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className={ladder.profile} aria-label="Your clan">
      <h2 className={ladder.label}>YOUR CLAN</h2>
      {picker}
      {checking ? (
        <p className={page.status} role="status">
          Checking your session…
        </p>
      ) : (
        children
      )}
    </section>
  );
}

/**
 * `/clan`: the signed-in player's clan, or how to get one. A member acts as one of their game
 * names (the clan belongs to the name, not to the member). A guest reads the explanation; the
 * public clan list is open to everyone.
 */
export function ClanScreen({ edition, store = account, fetch: fetcher, baseUrl }: ScreenProps) {
  const state = useAccount(store);
  const client = useClient(store, fetcher, baseUrl);
  const names = useMemo(
    () => (state.status === "member" ? state.gameAccounts.map((entry) => entry.username) : []),
    [state],
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const nick = names.find((name) => name === chosen) ?? names[0];
  // with several game names the server wants to be told which one
  const passAccount = names.length > 1 ? nick : undefined;

  const loadMine = useMemo<Loader<Awaited<ReturnType<ClanClient["mine"]>>> | null>(
    () => (nick ? () => client.mine(passAccount) : null),
    [client, nick, passAccount],
  );
  const mine = useFetched(loadMine, nick ?? "");

  const picker =
    names.length > 1 && nick ? (
      <label className={c.picker}>
        <span className={ladder.statLabel}>PLAYING AS</span>
        <select value={nick} onChange={(event) => setChosen(event.target.value)}>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  let left: React.ReactNode = null;
  let right: React.ReactNode = null;
  if (state.status !== "member") {
    left = (
      <Notice checking={state.status === "unknown"}>
        {state.status === "offline" ? (
          <p className={page.failure} role="alert">
            The online service cannot be reached, so clans are not available right now.
          </p>
        ) : (
          <>
            <p className={page.status}>
              A clan is a team of players with a short tag. Sign in with your member account to
              found one, accept an invitation, or manage yours. Guests can look at the clans below.
            </p>
            <Link to="/account" className={page.outline}>
              SIGN IN
            </Link>
          </>
        )}
      </Notice>
    );
    right = <PublicList client={client} />;
  } else if (!nick) {
    left = (
      <Notice>
        <p className={page.status}>
          A clan belongs to a game name. Add a game name to your account first.
        </p>
        <Link to="/account" className={page.outline}>
          ADD A GAME NAME
        </Link>
      </Notice>
    );
    right = <PublicList client={client} />;
  } else if (!mine.value || mine.value.status === "loading") {
    left = (
      <Notice>
        <p className={page.status} role="status">
          Loading your clan…
        </p>
      </Notice>
    );
    right = <PublicList />;
  } else if (mine.value.status === "error") {
    left = (
      <Notice picker={picker}>
        <p className={page.failure} role="alert">
          {describeClanError(mine.value.error)}
        </p>
        <div className={ladder.actions}>
          <button type="button" className={page.outline} onClick={mine.retry}>
            TRY AGAIN
          </button>
          <Link to="/account" className={page.quiet}>
            ACCOUNT
          </Link>
        </div>
      </Notice>
    );
    right = <PublicList />;
  }

  const ready = mine.value?.status === "ready" ? mine.value.data : null;
  return (
    <Backdrop edition={edition}>
      {ready && nick ? (
        ready.clan ? (
          <InClan
            key={`${nick}:${ready.clan.id}`}
            client={client}
            clan={ready.clan}
            nick={nick}
            passAccount={passAccount}
            reload={mine.reload}
            picker={picker}
          />
        ) : (
          <NoClan
            key={nick}
            client={client}
            nick={nick}
            passAccount={passAccount}
            reload={mine.reload}
            picker={picker}
          />
        )
      ) : (
        <>
          {left}
          {right}
        </>
      )}
    </Backdrop>
  );
}

/** The right column of a player with no clan to show yet: the clan list, or just the title. */
function PublicList({ client }: { client?: ClanClient }) {
  return (
    <section className={ladder.ladder} aria-label="Clans">
      <div className={ladder.head}>
        <h1 className={page.title}>CLAN</h1>
      </div>
      {client && <Finder client={client} />}
    </section>
  );
}

/** `/clan/{tag}`: one clan and its members, read only. */
export function PublicClanScreen({
  edition,
  store = account,
  fetch: fetcher,
  baseUrl,
}: ScreenProps) {
  const { tag = "" } = useParams();
  const client = useClient(store, fetcher, baseUrl);
  const load = useMemo<Loader<ClanDetail | null>>(
    () => (signal) => client.publicClan(tag, signal),
    [client, tag],
  );
  const { value, retry } = useFetched(load, tag);
  const clan = value?.status === "ready" ? value.data : null;
  return (
    <Backdrop edition={edition}>
      {clan ? (
        <ClanCard clan={clan}>
          <Link to="/clan" className={page.quiet}>
            ALL CLANS
          </Link>
        </ClanCard>
      ) : (
        <section className={`${ladder.profile} ${c.card}`} aria-label="Clan">
          <h2 className={c.tag}>[{tag}]</h2>
          <Link to="/clan" className={page.quiet}>
            ALL CLANS
          </Link>
        </section>
      )}
      <section className={ladder.ladder} aria-label="Clan members">
        <div className={ladder.head}>
          <h1 className={page.title}>CLAN</h1>
        </div>
        {(!value || value.status === "loading") && (
          <p className={page.status} role="status">
            Loading the clan…
          </p>
        )}
        {value?.status === "error" && (
          <div className={page.panel}>
            <p className={page.failure} role="alert">
              The clan cannot be reached. Check your connection and try again.
            </p>
            <div>
              <button type="button" className={page.outline} onClick={retry}>
                TRY AGAIN
              </button>
            </div>
          </div>
        )}
        {value?.status === "ready" &&
          (clan ? (
            <MembersTable clan={clan} />
          ) : (
            <div className={page.panel}>
              <p className={page.status}>
                No clan has the tag [{tag}]. It may have been disbanded.
              </p>
            </div>
          ))}
      </section>
    </Backdrop>
  );
}
